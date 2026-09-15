#!/usr/bin/env bun

import { createCliRenderer } from "@opentui/core"

import { AppleAuthManager } from "./services/apple-auth"
import { restoreAppleAuthOnStartup } from "./services/apple-auth/startup"
import { AppleAuthorizationBrowserLauncher } from "./services/apple-authorization-browser"
import { AppleCatalogProvider } from "./services/apple-catalog"
import {
  AppleDeveloperTokenProvider,
  DEFAULT_APPLE_SIGNER_URL,
} from "./services/apple-developer-token-provider"
import {
  startAppleLoopbackServer,
  type AppleLoopbackServer,
} from "./services/apple-loopback-server"
import { ApplePlaybackController } from "./services/apple-playback"
import { createAuthLogger } from "./services/auth-log"
import { createCredentialStore } from "./services/credentials"
import { createFavoriteStationStore } from "./services/favorite-stations"
import { createPlaybackLogger } from "./services/playback-log"
import { createNutkaApp } from "./ui/app"
import { theme } from "./ui/theme"
import {
  loadVisualizerSettings,
  saveVisualizerSettings,
} from "./ui/visualizer/preferences"

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  backgroundColor: theme.background,
})

const signerUrl = process.env.NUTKA_APPLE_SIGNER_URL ?? DEFAULT_APPLE_SIGNER_URL
let tokenProvider: AppleDeveloperTokenProvider | undefined
let loopbackServer: AppleLoopbackServer | undefined
let tokenServiceUrl: string | undefined
let authManager: AppleAuthManager | undefined
let setupError: "credential_load_failed" | "service_unavailable" | undefined
if (signerUrl) {
  try {
    tokenProvider = new AppleDeveloperTokenProvider(signerUrl)
    loopbackServer = startAppleLoopbackServer({
      issuer: tokenProvider,
      logger: createAuthLogger("service"),
    })
    tokenServiceUrl = loopbackServer.origin
  } catch {
    tokenProvider?.dispose()
    loopbackServer?.stop()
    tokenProvider = undefined
    loopbackServer = undefined
    setupError = "service_unavailable"
  }

  try {
    if (!tokenServiceUrl) throw new Error("Loopback service unavailable")
    const authorizationBrowser = new AppleAuthorizationBrowserLauncher({
      executablePath: process.env.NUTKA_CHROMIUM_PATH,
    })
    authManager = new AppleAuthManager({
      serviceUrl: tokenServiceUrl,
      credentialStore: createCredentialStore(),
      openBrowser: authorizationBrowser.openBrowser.bind(authorizationBrowser),
    })
  } catch {
    loopbackServer?.stop()
    tokenProvider?.dispose()
    loopbackServer = undefined
    tokenProvider = undefined
    tokenServiceUrl = undefined
    setupError ??= "credential_load_failed"
  }
} else {
  setupError = "service_unavailable"
}

let unsubscribeAuth: (() => void) | undefined
let catalogProvider: AppleCatalogProvider | undefined
const playbackLogger = createPlaybackLogger()
const playbackController = authManager && tokenServiceUrl
  ? new ApplePlaybackController({
      serviceUrl: tokenServiceUrl,
      executablePath: process.env.NUTKA_CHROMIUM_PATH,
      useMusicUserToken: (use) => authManager!.useMusicUserToken(use),
      logger: playbackLogger,
    })
  : undefined
let shuttingDown = false
const favoriteStationStore = createFavoriteStationStore()

const app = createNutkaApp(renderer, {
  tracks: [],
  library: {
    getSongs: (options) => requireCatalog().getLibrarySongs(options),
    getAlbums: (options) => requireCatalog().getLibraryAlbums(options),
    getArtists: (options) => requireCatalog().getLibraryArtists(options),
    getAlbumTracks: (id, options) => requireCatalog().getLibraryAlbumTracks(id, options),
    getArtistAlbums: (id, options) => requireCatalog().getLibraryArtistAlbums(id, options),
  },
  onQuit: () => void shutdown(),
  onSearchSongs: (query, options) => {
    if (!catalogProvider) return Promise.reject(new Error("Apple Music sign-in required"))
    return catalogProvider.searchSongs(query, options)
  },
  onSearchStations: (query, options) => {
    if (!catalogProvider) return Promise.reject(new Error("Apple Music sign-in required"))
    return catalogProvider.searchStations(query, options)
  },
  onGetAlbumForSong: (songResourceId, options) => {
    if (!catalogProvider) return Promise.reject(new Error("Apple Music sign-in required"))
    return catalogProvider.getAlbumForSong(songResourceId, options)
  },
  onGetSongContext: (songResourceId, options) => {
    if (!catalogProvider) return Promise.reject(new Error("Apple Music sign-in required"))
    return catalogProvider.getSongContext(songResourceId, options)
  },
  onGetAlbum: (albumResourceId, options) => {
    if (!catalogProvider) return Promise.reject(new Error("Apple Music sign-in required"))
    return catalogProvider.getAlbum(albumResourceId, options)
  },
  onGetArtistSection: (artistResourceId, section, options) => {
    if (!catalogProvider) return Promise.reject(new Error("Apple Music sign-in required"))
    return catalogProvider.getArtistSection(artistResourceId, section, options)
  },
  onGetHomeSections: (options) => {
    if (!catalogProvider) return Promise.reject(new Error("Apple Music sign-in required"))
    return catalogProvider.getHomeSections(options)
  },
  onGetLibraryPlaylists: (options) => {
    if (!catalogProvider) return Promise.reject(new Error("Apple Music sign-in required"))
    return catalogProvider.getLibraryPlaylists(options)
  },
  onGetPlaylistTracks: (playlist, options) => {
    if (!catalogProvider) return Promise.reject(new Error("Apple Music sign-in required"))
    return catalogProvider.getPlaylistTracks(playlist, options)
  },
  onGetPersonalStation: (options) => {
    if (!catalogProvider) return Promise.reject(new Error("Apple Music sign-in required"))
    return catalogProvider.getPersonalStation(options)
  },
  onGetLiveRadioStations: (options) => {
    if (!catalogProvider) return Promise.reject(new Error("Apple Music sign-in required"))
    return catalogProvider.getLiveRadioStations(options)
  },
  onGetRecentlyPlayedStations: (options) => {
    if (!catalogProvider) return Promise.reject(new Error("Apple Music sign-in required"))
    return catalogProvider.getRecentlyPlayedStations(options)
  },
  onGetStationForResource: (resourceType, resourceId, options) => {
    if (!catalogProvider) return Promise.reject(new Error("Apple Music sign-in required"))
    return catalogProvider.getStationForResource(resourceType, resourceId, options)
  },
  onGetStationsByIds: (resourceIds, options) => {
    if (!catalogProvider) return Promise.reject(new Error("Apple Music sign-in required"))
    return catalogProvider.getStationsByIds(resourceIds, options)
  },
  onGetStationGenres: (options) => {
    if (!catalogProvider) return Promise.reject(new Error("Apple Music sign-in required"))
    return catalogProvider.getStationGenres(options)
  },
  onGetStationsForGenre: (genreResourceId, options) => {
    if (!catalogProvider) return Promise.reject(new Error("Apple Music sign-in required"))
    return catalogProvider.getStationsForGenre(genreResourceId, options)
  },
  onLoadFavoriteStationIds: (storefront) => favoriteStationStore.load(storefront),
  onSetStationFavorite: (storefront, resourceId, favorite) => {
    favoriteStationStore.set(storefront, resourceId, favorite)
  },
  onGetStationLiked: async (stationResourceId, options) => {
    if (!catalogProvider) throw new Error("Apple Music sign-in required")
    return (await catalogProvider.getPersonalStationRating(stationResourceId, options)) === 1
  },
  onSetStationLiked: async (stationResourceId, liked, options) => {
    if (!catalogProvider) throw new Error("Apple Music sign-in required")
    if (liked) await catalogProvider.setPersonalStationRating(stationResourceId, 1, options)
    else await catalogProvider.deletePersonalStationRating(stationResourceId, options)
  },
  onGetSongLiked: async (songResourceId, options) => {
    if (!catalogProvider) throw new Error("Apple Music sign-in required")
    return (await catalogProvider.getPersonalSongRating(songResourceId, options)) === 1
  },
  onSetSongLiked: async (songResourceId, liked, options) => {
    if (!catalogProvider) throw new Error("Apple Music sign-in required")
    if (liked) await catalogProvider.setPersonalSongRating(songResourceId, 1, options)
    else await catalogProvider.deletePersonalSongRating(songResourceId, options)
  },
  onAppleSignIn: authManager
    ? () => void authManager.signIn().catch(() => {})
    : undefined,
  onAppleSignOut: authManager
    ? () => void signOut().catch(() => {
        app.setAppleAuthStatus({ state: "error", code: "credential_delete_failed" })
      })
    : undefined,
  onAppleSignInCancel: authManager
    ? () => void authManager.cancel().catch(() => {})
    : undefined,
  onAppleRestore: authManager
    ? () => void authManager.restore().catch(() => {})
    : undefined,
  playback: playbackController,
  visualizerSettings: loadVisualizerSettings(),
  onSaveVisualizerSettings: (settings) => saveVisualizerSettings(settings),
})

if (authManager) {
  unsubscribeAuth = authManager.subscribe((status) => {
    catalogProvider =
      status.state === "signedIn"
         ? new AppleCatalogProvider(tokenServiceUrl!, status.storefront, {
             useMusicUserToken: (use) => authManager!.useMusicUserToken(use),
             logger: playbackLogger,
           })
        : undefined
    if (status.state === "signedIn") playbackController?.enableAuthorization()
    app.setAppleAuthStatus(status)
  })
  void restoreAppleAuthOnStartup(authManager).catch(() => {})
} else {
  app.setAppleAuthStatus({
    state: "error",
    code: setupError ?? "service_unavailable",
  })
}

process.once("SIGINT", () => void shutdown())
process.once("SIGTERM", () => void shutdown())
process.once("SIGHUP", () => void shutdown())

async function signOut(): Promise<void> {
  await authManager!.logout()
  await playbackController?.clearAuthorization()
}

function requireCatalog(): AppleCatalogProvider {
  if (!catalogProvider) throw new Error("Apple Music sign-in required")
  return catalogProvider
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  try {
    await playbackController?.dispose()
    await authManager?.dispose()
  } finally {
    loopbackServer?.stop()
    tokenProvider?.dispose()
    unsubscribeAuth?.()
    app.destroy()
    renderer.destroy()
  }
}
