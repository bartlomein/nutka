import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing"

import type {
  AppleArtistSectionName,
  AppleArtistSectionPage,
  AppleCatalogAlbum,
  AppleCatalogStation,
  AppleCatalogStationGenre,
  AppleCatalogTrack,
  AppleHomeSection,
  AppleLibraryPlaylist,
  ApplePlaylist,
  AppleSongContext,
  PlaybackController,
  SearchOptions,
  SearchPage,
  Track,
} from "../../core/types"
import { createNutkaApp, type NutkaApp } from "../app"
import type { VisualizerSettings } from "../visualizer"
import type { LibraryServices } from "../app/library-controller"
import { testTracks } from "./app-data"

export function createAppFixture() {
  let setup: TestRendererSetup | undefined
  let app: NutkaApp | undefined

  async function createApp(
    options: {
      library?: LibraryServices
      width?: number
      height?: number
      kittyKeyboard?: boolean
      tracks?: readonly Track[]
      searchSongs?: (
        query: string,
        options?: SearchOptions,
      ) => Promise<SearchPage<Track>>
      getAlbumForSong?: (
        songResourceId: string,
        options?: Pick<SearchOptions, "signal">,
      ) => Promise<AppleCatalogAlbum>
      getSongContext?: (
        songResourceId: string,
        options?: Pick<SearchOptions, "signal">,
      ) => Promise<AppleSongContext>
      getAlbum?: (
        albumResourceId: string,
        options?: Pick<SearchOptions, "signal">,
      ) => Promise<AppleCatalogAlbum>
      getArtistSection?: (
        artistResourceId: string,
        section: AppleArtistSectionName,
        options?: SearchOptions,
      ) => Promise<AppleArtistSectionPage>
      getHomeSections?: (
        options?: SearchOptions,
      ) => Promise<SearchPage<AppleHomeSection>>
      getLibraryPlaylists?: (
        options?: SearchOptions,
      ) => Promise<SearchPage<AppleLibraryPlaylist>>
      getPlaylistTracks?: (
        playlist: ApplePlaylist,
        options?: SearchOptions,
      ) => Promise<SearchPage<AppleCatalogTrack>>
      getPersonalStation?: (
        options?: Pick<SearchOptions, "signal">,
      ) => Promise<AppleCatalogStation>
      getLiveRadioStations?: (
        options?: SearchOptions,
      ) => Promise<SearchPage<AppleCatalogStation>>
      getRecentlyPlayedStations?: (
        options?: SearchOptions,
      ) => Promise<SearchPage<AppleCatalogStation>>
      getStationForResource?: (
        resourceType: "songs" | "artists",
        resourceId: string,
        options?: Pick<SearchOptions, "signal">,
      ) => Promise<AppleCatalogStation>
      searchStations?: (
        query: string,
        options?: SearchOptions,
      ) => Promise<SearchPage<AppleCatalogStation>>
      getStationsByIds?: (
        resourceIds: readonly string[],
        options?: Pick<SearchOptions, "signal">,
      ) => Promise<readonly AppleCatalogStation[]>
      getStationGenres?: (
        options?: Pick<SearchOptions, "signal">,
      ) => Promise<readonly AppleCatalogStationGenre[]>
      getStationsForGenre?: (
        genreResourceId: string,
        options?: SearchOptions,
      ) => Promise<SearchPage<AppleCatalogStation>>
      loadFavoriteStationIds?: (storefront: string) => readonly string[]
      setStationFavorite?: (
        storefront: string,
        resourceId: string,
        favorite: boolean,
      ) => void
      getSongLiked?: (
        songResourceId: string,
        options?: Pick<SearchOptions, "signal">,
      ) => Promise<boolean>
      setSongLiked?: (
        songResourceId: string,
        liked: boolean,
        options?: Pick<SearchOptions, "signal">,
      ) => Promise<void>
      playback?: PlaybackController<AppleCatalogTrack>
      visualizerSettings?: VisualizerSettings
      saveVisualizerSettings?: (settings: VisualizerSettings) => void
    } = {},
    onQuit = () => {},
    apple: {
      onSignIn?: () => void
      onSignOut?: () => void
      onCancel?: () => void
      onRestore?: () => void
    } = {},
  ): Promise<void> {
    setup = await createTestRenderer({
      width: options.width ?? 120,
      height: options.height ?? 32,
      kittyKeyboard: options.kittyKeyboard,
    })
    app = createNutkaApp(setup.renderer, {
      library: options.library,
      tracks: options.tracks ?? testTracks,
      onSearchSongs: options.searchSongs,
      onGetAlbumForSong: options.getAlbumForSong,
      onGetSongContext: options.getSongContext,
      onGetAlbum: options.getAlbum,
      onGetArtistSection: options.getArtistSection,
      onGetHomeSections: options.getHomeSections,
      onGetLibraryPlaylists: options.getLibraryPlaylists,
      onGetPlaylistTracks: options.getPlaylistTracks,
      onGetPersonalStation: options.getPersonalStation,
      onGetLiveRadioStations: options.getLiveRadioStations,
      onGetRecentlyPlayedStations: options.getRecentlyPlayedStations,
      onGetStationForResource: options.getStationForResource,
      onSearchStations: options.searchStations,
      onGetStationsByIds: options.getStationsByIds,
      onGetStationGenres: options.getStationGenres,
      onGetStationsForGenre: options.getStationsForGenre,
      onLoadFavoriteStationIds: options.loadFavoriteStationIds,
      onSetStationFavorite: options.setStationFavorite,
      onGetSongLiked: options.getSongLiked,
      onSetSongLiked: options.setSongLiked,
      onQuit,
      onAppleSignIn: apple.onSignIn,
      onAppleSignOut: apple.onSignOut,
      onAppleSignInCancel: apple.onCancel,
      onAppleRestore: apple.onRestore,
      playback: options.playback,
      visualizerSettings: options.visualizerSettings,
      onSaveVisualizerSettings: options.saveVisualizerSettings,
    })
  }

  return {
    createApp,
    get app(): NutkaApp {
      if (!app) throw new Error("Call createApp before accessing the app")
      return app
    },
    get setup(): TestRendererSetup {
      if (!setup) throw new Error("Call createApp before accessing the renderer")
      return setup
    },
    destroy(): void {
      app?.destroy()
      setup?.renderer.destroy()
      app = undefined
      setup = undefined
    },
  }
}
