#!/usr/bin/env bun

import { createCliRenderer } from "@opentui/core"

import { AppleAuthManager } from "./services/apple-auth"
import { AppleCatalogProvider } from "./services/apple-catalog"
import { ApplePlaybackController } from "./services/apple-playback"
import { createCredentialStore } from "./services/credentials"
import { createNutaApp } from "./ui/app"
import { theme } from "./ui/theme"

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  backgroundColor: theme.background,
})

const tokenServiceUrl = process.env.NUTA_TOKEN_SERVICE_URL
let authManager: AppleAuthManager | undefined
let setupError: "credential_load_failed" | "service_unavailable" | undefined
if (tokenServiceUrl) {
  try {
    authManager = new AppleAuthManager({
      serviceUrl: tokenServiceUrl,
      credentialStore: createCredentialStore(),
    })
  } catch {
    setupError = "credential_load_failed"
  }
} else {
  setupError = "service_unavailable"
}

let unsubscribeAuth: (() => void) | undefined
let catalogProvider: AppleCatalogProvider | undefined
const playbackController = authManager && tokenServiceUrl
  ? new ApplePlaybackController({
      serviceUrl: tokenServiceUrl,
      executablePath: process.env.NUTA_CHROMIUM_PATH,
      useMusicUserToken: (use) => authManager!.useMusicUserToken(use),
    })
  : undefined
let shuttingDown = false

const app = createNutaApp(renderer, {
  tracks: [],
  onQuit: () => void shutdown(),
  onSearchSongs: (query, options) => {
    if (!catalogProvider) return Promise.reject(new Error("Apple Music sign-in required"))
    return catalogProvider.searchSongs(query, options)
  },
  onGetAlbumForSong: (songResourceId, options) => {
    if (!catalogProvider) return Promise.reject(new Error("Apple Music sign-in required"))
    return catalogProvider.getAlbumForSong(songResourceId, options)
  },
  onGetRecommendedPlaylists: (options) => {
    if (!catalogProvider) return Promise.reject(new Error("Apple Music sign-in required"))
    return catalogProvider.getRecommendedPlaylists(options)
  },
  onGetLibraryPlaylists: (options) => {
    if (!catalogProvider) return Promise.reject(new Error("Apple Music sign-in required"))
    return catalogProvider.getLibraryPlaylists(options)
  },
  onGetPlaylistTracks: (playlist, options) => {
    if (!catalogProvider) return Promise.reject(new Error("Apple Music sign-in required"))
    return catalogProvider.getPlaylistTracks(playlist, options)
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
})

if (authManager) {
  unsubscribeAuth = authManager.subscribe((status) => {
    catalogProvider =
      status.state === "signedIn"
        ? new AppleCatalogProvider(tokenServiceUrl!, status.storefront, {
            useMusicUserToken: (use) => authManager!.useMusicUserToken(use),
          })
        : undefined
    if (status.state === "signedIn") playbackController?.enableAuthorization()
    app.setAppleAuthStatus(status)
  })
  void authManager.restore().catch(() => {})
} else {
  app.setAppleAuthStatus({
    state: "error",
    code: setupError ?? "service_unavailable",
  })
}

process.once("SIGINT", () => void shutdown())
process.once("SIGTERM", () => void shutdown())

async function signOut(): Promise<void> {
  await playbackController?.clearAuthorization()
  await authManager!.logout()
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  try {
    await playbackController?.dispose()
    await authManager?.dispose()
  } finally {
    unsubscribeAuth?.()
    app.destroy()
    renderer.destroy()
  }
}
