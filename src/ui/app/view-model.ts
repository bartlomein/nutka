import type { AppState } from "../../core/state"
import type { Track } from "../../core/types"
import type { AppleAuthStatus } from "../../services/apple-auth"
import type { AppInteractionController } from "./app-interaction-controller"
import type { createAppQueries } from "./app-queries"
import { isPlaylistLanding } from "./browse"
import type { CatalogBrowseController } from "./catalog-browse-controller"
import type { CatalogSearchController } from "./catalog-search-controller"
import { playbackErrorMessage } from "./copy"
import type { LibraryController } from "./library-controller"
import type { PlaybackSessionController } from "./playback-session-controller"
import type { PlaylistController } from "./playlist-controller"
import type { RadioController } from "./radio-controller"
import type { TrackStore } from "./track-store"
import type { AppViewModel } from "./view-contracts"

interface ViewModelSources {
  state: AppState
  appleAuthStatus: AppleAuthStatus
  interaction: AppInteractionController
  queries: ReturnType<typeof createAppQueries>
  library: LibraryController | undefined
  tracks: TrackStore
  radio: RadioController
  playlists: PlaylistController
  searchController: CatalogSearchController
  catalogBrowse: CatalogBrowseController
  playbackSession: PlaybackSessionController
}

export function buildAppViewModel(sources: ViewModelSources): AppViewModel {
  const {
    state,
    appleAuthStatus,
    interaction,
    queries,
    library,
    tracks,
    radio,
    playlists,
    searchController,
    catalogBrowse,
    playbackSession,
  } = sources
  const interactionState = interaction.snapshot()
  const activeBrowsePage = catalogBrowse.currentPage()
  const activeFilter = state.mode.type === "filter"
    ? state.mode.draft
    : state.lists[state.destination].filter
  const activeAlbumView = !activeBrowsePage && state.destination === "search"
    ? catalogBrowse.albumView
    : undefined
  const activePlaylistView = !activeBrowsePage && isPlaylistLanding(state.destination)
    ? playlists.view
    : undefined
  const currentTrack = state.playback.currentTrackId
    ? tracks.get(state.playback.currentTrackId)
    : undefined
  const currentSongLike = playbackSession.currentSongLike()
  const selected = queries.selectedStation()
  const paletteCommands = interaction.paletteCommands()

  return {
    state,
    appleAuthStatus,
    authSuccessVisible: interactionState.authSuccessVisible,
    baseTracks: queries.getBaseTracks(),
    visibleTracks: queries.getVisibleTracks(),
    ...(!activeBrowsePage && state.destination === "library" && library ? {
      library: {
        page: library.page,
        section: library.section,
        nested: library.nested,
        statusLine: library.statusLine(activeFilter),
        emptyMessage: library.emptyMessage(activeFilter),
      },
    } : {}),
    ...(activeBrowsePage ? { browsePage: activeBrowsePage } : {}),
    ...(activeAlbumView ? { albumView: activeAlbumView } : {}),
    ...(activePlaylistView ? { playlistView: activePlaylistView } : {}),
    homeSections: playlists.homeSections,
    favoriteStations: radio.favorites,
    homeItems: queries.getHomeItems(),
    visibleHomeItems: queries.getVisibleHomeItems(),
    playlists: queries.getPlaylists(),
    visiblePlaylists: queries.getVisiblePlaylists(),
    landingState: state.destination === "home" ? playlists.homeState : playlists.libraryState,
    radioRows: queries.getRadioRows(),
    visibleStations: queries.getVisibleStations(),
    favoriteStationIds: new Set(radio.favoriteResourceIds),
    ...(selected ? { selectedStation: selected } : {}),
    radioStatusLine: radio.statusLine(activeFilter),
    radioHasMore: radio.hasMore(),
    radioFavoriteSaveError: radio.favoriteSaveError,
    radioStationLikeError: radio.stationLikeError,
    searchState: searchController.state,
    searchStatusLine: searchController.statusLine(activeFilter),
    ...(catalogBrowse.contextPicker ? { contextPicker: catalogBrowse.contextPicker } : {}),
    ...(interactionState.infoTarget ? { infoTarget: interactionState.infoTarget } : {}),
    visualizerEnabled: interactionState.visualizerEnabled,
    visualizerSettings: interactionState.visualizerSettings,
    ...(interactionState.visualizerSettingsDialog
      ? { visualizerSettingsDialog: interactionState.visualizerSettingsDialog }
      : {}),
    player: {
      status: state.playback.status,
      currentTrack: currentTrack ?? null,
      queue: state.playback.queueTrackIds
        .map((trackId) => tracks.get(trackId))
        .filter((track): track is Track => Boolean(track)),
      positionSeconds: state.playback.positionSeconds,
      durationSeconds: state.playback.durationSeconds,
      errorMessage: state.playback.errorCode
        ? playbackErrorMessage(state.playback.errorCode)
        : null,
      connected: playbackSession.connected,
      shuffleMode: state.playback.shuffleMode,
      repeatMode: state.playback.repeatMode,
      canSetShuffleMode: state.playback.canSetShuffleMode,
      canSetRepeatMode: state.playback.canSetRepeatMode,
      source: state.playback.source,
      dynamicQueue: state.playback.dynamicQueue,
      canSeek: state.playback.canSeek,
      canSkipNext: state.playback.canSkipNext,
      canSkipPrevious: state.playback.canSkipPrevious,
      liked: currentSongLike.liked,
      likeStatus: currentSongLike.status,
    },
    currentSongLikeError: currentSongLike.error,
    paletteCommands,
  }
}
