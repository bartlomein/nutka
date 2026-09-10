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
import type { VisualizerSettings } from "../visualizer"
import type { LibraryServices } from "./library-controller"

export interface NutkaAppOptions {
  library?: LibraryServices
  tracks: readonly Track[]
  onQuit: () => void
  onSearchSongs?: (
    query: string,
    options?: SearchOptions,
  ) => Promise<SearchPage<Track>>
  onGetAlbumForSong?: (
    songResourceId: string,
    options?: Pick<SearchOptions, "signal">,
  ) => Promise<AppleCatalogAlbum>
  onGetSongContext?: (
    songResourceId: string,
    options?: Pick<SearchOptions, "signal">,
  ) => Promise<AppleSongContext>
  onGetAlbum?: (
    albumResourceId: string,
    options?: Pick<SearchOptions, "signal">,
  ) => Promise<AppleCatalogAlbum>
  onGetArtistSection?: (
    artistResourceId: string,
    section: AppleArtistSectionName,
    options?: SearchOptions,
  ) => Promise<AppleArtistSectionPage>
  onGetHomeSections?: (
    options?: SearchOptions,
  ) => Promise<SearchPage<AppleHomeSection>>
  onGetLibraryPlaylists?: (
    options?: SearchOptions,
  ) => Promise<SearchPage<AppleLibraryPlaylist>>
  onGetPlaylistTracks?: (
    playlist: ApplePlaylist,
    options?: SearchOptions,
  ) => Promise<SearchPage<AppleCatalogTrack>>
  onGetPersonalStation?: (
    options?: Pick<SearchOptions, "signal">,
  ) => Promise<AppleCatalogStation>
  onGetLiveRadioStations?: (
    options?: Pick<SearchOptions, "signal">,
  ) => Promise<SearchPage<AppleCatalogStation>>
  onGetRecentlyPlayedStations?: (
    options?: SearchOptions,
  ) => Promise<SearchPage<AppleCatalogStation>>
  onGetStationForResource?: (
    resourceType: "songs" | "artists",
    resourceId: string,
    options?: Pick<SearchOptions, "signal">,
  ) => Promise<AppleCatalogStation>
  onSearchStations?: (
    query: string,
    options?: SearchOptions,
  ) => Promise<SearchPage<AppleCatalogStation>>
  onGetStationsByIds?: (
    stationResourceIds: readonly string[],
    options?: Pick<SearchOptions, "signal">,
  ) => Promise<readonly AppleCatalogStation[]>
  onGetStationGenres?: (
    options?: Pick<SearchOptions, "signal">,
  ) => Promise<readonly AppleCatalogStationGenre[]>
  onGetStationsForGenre?: (
    stationGenreResourceId: string,
    options?: SearchOptions,
  ) => Promise<SearchPage<AppleCatalogStation>>
  onLoadFavoriteStationIds?: (storefront: string) => readonly string[]
  onSetStationFavorite?: (
    storefront: string,
    stationResourceId: string,
    favorite: boolean,
  ) => void
  onGetStationLiked?: (
    stationResourceId: string,
    options?: Pick<SearchOptions, "signal">,
  ) => Promise<boolean>
  onSetStationLiked?: (
    stationResourceId: string,
    liked: boolean,
    options?: Pick<SearchOptions, "signal">,
  ) => Promise<void>
  onGetSongLiked?: (
    songResourceId: string,
    options?: Pick<SearchOptions, "signal">,
  ) => Promise<boolean>
  onSetSongLiked?: (
    songResourceId: string,
    liked: boolean,
    options?: Pick<SearchOptions, "signal">,
  ) => Promise<void>
  onAppleSignIn?: () => void
  onAppleSignOut?: () => void
  onAppleSignInCancel?: () => void
  onAppleRestore?: () => void
  playback?: PlaybackController<AppleCatalogTrack>
  visualizerSettings?: VisualizerSettings
  onSaveVisualizerSettings?: (settings: VisualizerSettings) => void
}
