import { CliRenderEvents, type CliRenderer, type KeyEvent } from "@opentui/core"

import {
  createInitialState,
  filterTracks,
  reduceAppState,
  type AppAction,
  type AppState,
  type Destination,
} from "../core/state"
import type {
  AppleArtistSectionName,
  AppleArtistSectionPage,
  AppleCatalogAlbum,
  AppleCatalogAlbumSummary,
  AppleCatalogArtist,
  AppleCatalogPlaylist,
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
  Station,
  Track,
} from "../core/types"
import type { AppleAuthStatus } from "../services/apple-auth"
import {
  appleStationResourceId,
  browsePageTracks,
  filterHomeValues,
  filterPlaylistValues,
  isAppleCatalogStation,
  isPlayableAppleTrack,
  isPlaylistLanding,
  type BrowsePage,
} from "./app/browse"
import { playbackErrorMessage, type InfoTarget } from "./app/copy"
import { AppInteractionController } from "./app/app-interaction-controller"
import { CatalogSearchController } from "./app/catalog-search-controller"
import { CatalogBrowseController } from "./app/catalog-browse-controller"
import { PlaybackSessionController } from "./app/playback-session-controller"
import { PlaylistController } from "./app/playlist-controller"
import { RadioController } from "./app/radio-controller"
import { TrackStore } from "./app/track-store"
import { createAppView } from "./app/view"
import type { VisualizerSettings } from "./visualizer"
import { defaultVisualizerSettings } from "./visualizer/preferences"

export { formatDuration } from "./app/browse"

export interface NutkaAppOptions {
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

export interface NutkaApp {
  getState(): AppState
  setAppleAuthStatus(status: AppleAuthStatus): void
  destroy(): void
}

export function createNutkaApp(
  renderer: CliRenderer,
  options: NutkaAppOptions,
): NutkaApp {
  let state = createInitialState(options.tracks.map((track) => track.id))
  const libraryTracks = [...options.tracks]
  const tracks = new TrackStore(libraryTracks)
  let appleAuthStatus: AppleAuthStatus = options.onAppleSignIn
    ? { state: "signedOut" }
    : { state: "error", code: "service_unavailable" }
  const initialVisualizerSettings = options.visualizerSettings ?? defaultVisualizerSettings
  const radio = new RadioController({
    getPersonalStation: options.onGetPersonalStation,
    getLiveStations: options.onGetLiveRadioStations,
    getRecentStations: options.onGetRecentlyPlayedStations,
    searchStations: options.onSearchStations,
    getStationsByIds: options.onGetStationsByIds,
    getGenres: options.onGetStationGenres,
    getStationsForGenre: options.onGetStationsForGenre,
    loadFavoriteIds: options.onLoadFavoriteStationIds,
    setFavorite: options.onSetStationFavorite,
    getLiked: options.onGetStationLiked,
    setLiked: options.onSetStationLiked,
  }, {
    getDestination: () => state.destination,
    getSelectedId: () => state.lists.radio.selectedTrackId,
    select: (id) => {
      state = reduceAppState(state, { type: "select-track", trackId: id })
    },
    resetSelection: (id) => {
      state = reduceAppState(state, {
        type: "reset-list",
        destination: "radio",
        selectedTrackId: id,
      })
    },
    closeMode: () => {
      state = reduceAppState(state, { type: "close-mode" })
    },
    favoritesChanged: () => {
      if (state.destination === "home") reconcileLandingSelection()
      else renderState()
    },
    render: () => renderState(),
  })
  const playlists = new PlaylistController({
    getHomeSections: options.onGetHomeSections,
    getLibraryPlaylists: options.onGetLibraryPlaylists,
    getPlaylistTracks: options.onGetPlaylistTracks,
  }, {
    getDestination: () => state.destination,
    getList: (destination) => state.lists[destination],
    getFavoriteStations: () => radio.favorites,
    closeModeAndReset: (destination, selectedTrackId) => {
      state = reduceAppState(state, { type: "close-mode" })
      state = reduceAppState(state, {
        type: "reset-list",
        destination,
        selectedTrackId,
      })
    },
    select: (trackId) => {
      state = reduceAppState(state, { type: "select-track", trackId })
    },
    restoreList: (view) => {
      state = {
        ...state,
        mode: { type: "normal", pendingKey: null },
        lists: {
          ...state.lists,
          [view.sourceDestination]: {
            filter: view.sourceFilter,
            selectedTrackId: view.sourceSelectedTrackId,
          },
        },
      }
    },
    registerTracks: (newTracks) => {
      tracks.add("playlist", newTracks)
    },
    unregisterTracks: () => {
      tracks.clear("playlist")
    },
    render: () => renderState(),
  })
  const searchController = new CatalogSearchController(options.onSearchSongs, {
    replaceTracks: (previous, next) => {
      void previous
      tracks.replace("search", next)
    },
    prepareSearch: () => {
      state = reduceAppState(state, { type: "close-mode" })
      state = reduceAppState(state, {
        type: "reset-list",
        destination: "search",
        selectedTrackId: null,
      })
      renderState()
    },
    select: (id) => {
      state = reduceAppState(state, {
        type: "reset-list",
        destination: "search",
        selectedTrackId: id,
      })
      renderState()
    },
    closeMode: () => dispatch({ type: "close-mode" }),
    render: () => renderState(),
  })
  const playbackSession = new PlaybackSessionController({
    playback: options.playback,
    getSongLiked: options.onGetSongLiked,
    setSongLiked: options.onSetSongLiked,
    getPlaylistTracks: options.onGetPlaylistTracks,
  }, {
    getPlaybackState: () => state.playback,
    getTrack: (id) => tracks.get(id),
    getRandomTracks: () => randomPlaybackTracks(),
    getSelectedPlaylist: () => playlists.selectedPlaylist(),
    replacePlaybackTracks: (playbackTracks) => tracks.replace("playback", playbackTracks),
    syncPlayback: (snapshot) => {
      dispatch({
        type: "sync-playback",
        currentTrackId: snapshot.currentTrack?.id ?? null,
        status: snapshot.status,
        queueTrackIds: snapshot.queue.map((track) => track.id),
        positionSeconds: snapshot.positionSeconds,
        durationSeconds: snapshot.durationSeconds,
        errorCode: snapshot.errorCode,
        shuffleMode: snapshot.shuffleMode,
        repeatMode: snapshot.repeatMode,
        canSetShuffleMode: snapshot.canSetShuffleMode,
        canSetRepeatMode: snapshot.canSetRepeatMode,
        source: snapshot.source ?? null,
        dynamicQueue: snapshot.dynamicQueue ?? false,
        canSeek: snapshot.canSeek ?? true,
        canSkipNext: snapshot.canSkipNext ?? true,
        canSkipPrevious: snapshot.canSkipPrevious ?? true,
      })
    },
    renderAudioAnalysis: (frame) => view.renderAudioAnalysis(frame),
    render: () => renderState(),
  })
  const catalogBrowse = new CatalogBrowseController({
    getAlbumForSong: options.onGetAlbumForSong,
    getSongContext: options.onGetSongContext,
    getAlbum: options.onGetAlbum,
    getArtistSection: options.onGetArtistSection,
    getStationForResource: options.onGetStationForResource,
    ...(playbackSession.connected ? {
      playTrack: (track: AppleCatalogTrack, upcoming: readonly AppleCatalogTrack[]) =>
        playbackSession.play(track, upcoming),
      ...(playbackSession.canPlayStation
        ? { playStation: (station: AppleCatalogStation) => playbackSession.playStation(station) }
        : {}),
    } : {}),
  }, {
    getCurrentTrack: () => {
      const track = state.playback.currentTrackId
        ? tracks.get(state.playback.currentTrackId)
        : undefined
      return isPlayableAppleTrack(track) ? track : undefined
    },
    getSearchState: () => ({
      destination: state.destination,
      selectedTrackId: state.lists.search.selectedTrackId,
      filter: state.lists.search.filter,
      visibleTracks: getVisibleTracks().filter(isPlayableAppleTrack),
    }),
    prepareSearchAlbum: () => {
      state = reduceAppState(state, { type: "close-mode" })
      state = reduceAppState(state, {
        type: "reset-list",
        destination: "search",
        selectedTrackId: null,
      })
    },
    selectSearchTrack: (trackId) => {
      state = reduceAppState(state, {
        type: "reset-list",
        destination: "search",
        selectedTrackId: trackId,
      })
    },
    restoreSearch: (selectedTrackId, filter) => {
      state = {
        ...state,
        mode: { type: "normal", pendingKey: null },
        lists: {
          ...state.lists,
          search: { filter, selectedTrackId },
        },
      }
    },
    replaceBrowseTracks: (browseTracks) => tracks.replace("browse", browseTracks),
    replaceAlbumTracks: (albumTracks) => tracks.replace("album", albumTracks),
    closeMode: () => {
      state = reduceAppState(state, { type: "close-mode" })
    },
    render: () => renderState(),
  })

  const view = createAppView(renderer, {
    onSeek: (positionSeconds) => playbackSession.requestSeek(positionSeconds),
    visualizerSettings: initialVisualizerSettings,
  })
  const interaction = new AppInteractionController({
    getState: () => state,
    getAppleAuthStatus: () => appleAuthStatus,
    hasAppleAuth: () => Boolean(options.onAppleSignIn),
    hasBrowsePage: () => Boolean(currentBrowsePage()),
    hasContextPicker: () => Boolean(catalogBrowse.contextPicker),
    selectedInfoTarget,
    visibleItemIds: getVisibleItemIds,
    filteredItemIds: (draft) => state.destination === "radio"
      ? getRadioRows(draft).flatMap((row) =>
          row.kind === "station"
            ? [row.station.id]
            : row.kind === "genre" ? [row.genre.id] : []
        )
      : state.destination === "home" && !playlists.view
      ? filterHomeValues(getHomeItems(), draft).map((item) => item.id)
      : state.destination === "playlists" && !playlists.view
      ? filterPlaylistValues(getPlaylists(), draft).map((playlist) => playlist.id)
      : filterTracks(getBaseTracks(), draft).map((track) => track.id),
    canOpenAlbum: canOpenSelectedAlbum,
    canOpenInfo: canOpenSelectedInfo,
    canBrowseNowPlaying,
    canStartSongStation,
    canSetShuffleMode: () => state.playback.canSetShuffleMode,
    canSetRepeatMode: () => state.playback.canSetRepeatMode,
    canToggleCurrentSongLike: () => playbackSession.canToggleCurrentSongLike(),
    canToggleSelectedStationFavorite,
    canToggleSelectedStationLike,
    applyState: (action) => {
      state = reduceAppState(state, action)
    },
    dispatch,
    render: renderState,
    navigate: navigateTo,
    touchRadioSelection: () => radio.touchSelection(),
    submitRadioSearch: (query) => void submitRadioSearch(query),
    submitCatalogSearch: (query) => void submitCatalogSearch(query),
    moveContextSelection: (delta) => catalogBrowse.moveContextSelection(delta),
    closeContextPicker,
    chooseContextTarget: () => void chooseContextTarget(),
    openNowPlayingContext: () => void openNowPlayingContext(),
    popBrowsePage: () => void popBrowsePage(),
    moveBrowseSelection,
    openSelectedBrowseItem,
    loadMoreSelectedBrowseSection: loadMoreSelectedArtistSection,
    moveSelection: (delta) => {
      const visibleTrackIds = getVisibleItemIds()
      if (state.destination === "radio" && visibleTrackIds.length > 0) radio.touchSelection()
      dispatch({ type: "move-selection", delta, visibleTrackIds })
    },
    activateSelection: () => {
      if (state.destination === "radio") {
        const selectedId = state.lists.radio.selectedTrackId
        if (radio.genres.some((genre) => genre.id === selectedId)) void openSelectedRadioGenre()
        else playSelectedStation()
        return
      }
      if (state.destination === "home" && !playlists.view && selectedStation()) {
        playSelectedStation()
        return
      }
      if (isPlaylistLanding(state.destination) && !playlists.view) {
        void openSelectedPlaylist()
        return
      }
      const visibleTracks = getVisibleTracks()
      const selectedId = state.lists[state.destination].selectedTrackId
      const selectedIndex = visibleTracks.findIndex((track) => track.id === selectedId)
      const selectedTrack = visibleTracks[selectedIndex]
      if (playbackSession.connected && isPlayableAppleTrack(selectedTrack)) {
        const upcoming = visibleTracks.slice(selectedIndex + 1).filter(isPlayableAppleTrack)
        void playbackSession.play(selectedTrack, upcoming).catch(() => {})
      }
    },
    togglePlayback: () => playbackSession.togglePlayback(),
    playPrevious: () => playbackSession.playPrevious(),
    toggleCurrentSongLike: () => void playbackSession.toggleCurrentSongLike(),
    toggleSelectedStationFavorite,
    toggleSelectedStationLike: () => void toggleSelectedStationLiked(),
    cycleRepeatMode: () => playbackSession.cycleRepeatMode(),
    toggleShuffleMode: () => playbackSession.toggleShuffleMode(),
    playRandom: () => playbackSession.playRandom(),
    playNext: () => playbackSession.playNext(),
    seekBy: (seconds) => playbackSession.seekBy(seconds),
    openSearchOrFilter: () => dispatch(state.destination === "radio"
      ? { type: "open-search", query: "" }
      : { type: "open-filter" }),
    openSelectedAlbum: () => {
      if (!currentBrowsePage() && state.destination === "search") void openSelectedAlbum()
    },
    loadMore: () => {
      if (currentBrowsePage()) return
      if (state.destination === "search" && !catalogBrowse.albumView) void loadMoreCatalogSearch()
      else if (state.destination === "radio") {
        if (radio.activeResultType === "search" && radio.search.nextCursor) {
          void submitRadioSearch(radio.search.query, radio.search.nextCursor)
        } else if (radio.activeResultType === "genre" && radio.genreNextCursor) {
          void openSelectedRadioGenre(radio.genreNextCursor)
        }
      } else if (isPlaylistLanding(state.destination)) {
        if (playlists.view) void loadMorePlaylistTracks()
        else void loadMorePlaylists()
      }
    },
    escapeNormalMode: () => {
      if (catalogBrowse.albumView) {
        leaveAlbumView()
        renderState()
      } else if (playlists.view) {
        leavePlaylistView()
        renderState()
      } else if (state.destination !== "home") navigateTo("home")
    },
    startCurrentSongStation: () => void startCurrentSongStation(),
    signIn: () => options.onAppleSignIn?.(),
    signOut: () => options.onAppleSignOut?.(),
    cancelSignIn: () => options.onAppleSignInCancel?.(),
    restoreSignIn: () => options.onAppleRestore?.(),
    quit: options.onQuit,
    resetInfoScroll: () => view.resetInfoScroll(),
    scrollInfo: (delta) => view.scrollInfo(delta),
    scrollInfoPage: (delta) => view.scrollInfoPage(delta),
    scrollInfoTo: (edge) => view.scrollInfoTo(edge),
    setVisualizerEnabled: (enabled) => view.setVisualizerEnabled(enabled),
    setAudioAnalysisEnabled: (enabled) => playbackSession.setAudioAnalysisEnabled(enabled),
    setVisualizerSettings: (settings) => view.setVisualizerSettings(settings),
    saveVisualizerSettings: (settings) => options.onSaveVisualizerSettings?.(settings),
    resize: () => view.resize(),
  }, initialVisualizerSettings)

  function dispatch(action: AppAction): void {
    state = reduceAppState(state, action)
    renderState()
  }

  function dispatchAll(actions: readonly AppAction[]): void {
    state = actions.reduce(reduceAppState, state)
    renderState()
  }

  function randomPlaybackTracks(): readonly AppleCatalogTrack[] {
    const browsePage = currentBrowsePage()
    const browseTracks = browsePage
      ? browsePageTracks(browsePage).filter(isPlayableAppleTrack)
      : []
    if (browseTracks.length > 0) return browseTracks
    const visibleTracks = getVisibleTracks().filter(isPlayableAppleTrack)
    if (visibleTracks.length > 0) return visibleTracks

    const playbackTracks = [
      state.playback.currentTrackId
        ? tracks.get(state.playback.currentTrackId)
        : undefined,
      ...state.playback.queueTrackIds.map((trackId) => tracks.get(trackId)),
    ]
    return playbackTracks.filter(isPlayableAppleTrack)
  }

  function getBaseTracks(destination = state.destination): readonly Track[] {
    if (destination === "radio") return []
    if (destination === "library") return libraryTracks
    if (destination === "search") {
      return catalogBrowse.albumView?.status === "ready"
        ? catalogBrowse.albumView.album!.tracks
        : catalogBrowse.albumView ? [] : searchController.tracks
    }
    if (destination === "home" || destination === "playlists") {
      return playlists.view?.status === "ready" || playlists.view?.status === "loadingMore"
        ? playlists.view.tracks
        : []
    }

    return state.playback.queueTrackIds
      .map((id) => tracks.get(id))
      .filter((track): track is Track => Boolean(track))
  }

  function getVisibleTracks(): readonly Track[] {
    const list = state.lists[state.destination]
    const query = state.mode.type === "filter" ? state.mode.draft : list.filter
    return filterTracks(getBaseTracks(), query)
  }

  function getPlaylists(destination = state.destination): readonly ApplePlaylist[] {
    return playlists.getPlaylists(destination)
  }

  function getVisiblePlaylists(): readonly ApplePlaylist[] {
    const query = state.mode.type === "filter"
      ? state.mode.draft
      : state.lists[state.destination].filter
    return playlists.getVisiblePlaylists(query)
  }

  function getHomeItems(): readonly (AppleCatalogPlaylist | AppleCatalogStation)[] {
    return playlists.getHomeItems()
  }

  function getVisibleHomeItems(): readonly (AppleCatalogPlaylist | AppleCatalogStation)[] {
    const query = state.mode.type === "filter"
      ? state.mode.draft
      : state.lists.home.filter
    return playlists.getVisibleHomeItems(query)
  }

  function getRadioRows(query?: string) {
    return radio.rows(
      query ?? (state.mode.type === "filter" ? state.mode.draft : state.lists.radio.filter),
    )
  }

  function getVisibleRadioItems(): readonly (Station | AppleCatalogStationGenre)[] {
    const query = state.mode.type === "filter" ? state.mode.draft : state.lists.radio.filter
    return radio.visibleItems(query)
  }

  function getVisibleStations(): readonly Station[] {
    const query = state.mode.type === "filter" ? state.mode.draft : state.lists.radio.filter
    return radio.visibleStations(query)
  }

  function getVisibleItemIds(): readonly string[] {
    if (state.destination === "radio") return getVisibleRadioItems().map((item) => item.id)
    if (state.destination === "home" && !playlists.view) {
      return getVisibleHomeItems().map((item) => item.id)
    }
    return isPlaylistLanding(state.destination) && !playlists.view
      ? getVisiblePlaylists().map((playlist) => playlist.id)
      : getVisibleTracks().map((track) => track.id)
  }

  function selectedInfoTarget(): InfoTarget | undefined {
    const selectedId = state.lists[state.destination].selectedTrackId
    if (state.destination === "home" && !playlists.view) {
      const item = getVisibleHomeItems().find((candidate) => candidate.id === selectedId)
      return item && !isAppleCatalogStation(item)
        ? { kind: "playlist", playlist: item }
        : undefined
    }
    if (state.destination === "playlists" && !playlists.view) {
      const playlist = getVisiblePlaylists().find((item) => item.id === selectedId)
      return playlist ? { kind: "playlist", playlist } : undefined
    }

    const track = getVisibleTracks().find((item) => item.id === selectedId)
    if (track) {
      return {
        kind: "track",
        track,
        ...(catalogBrowse.albumView?.album ? { album: catalogBrowse.albumView.album } : {}),
        ...(playlists.view ? { playlist: playlists.view.playlist } : {}),
      }
    }
    if (catalogBrowse.albumView?.album) {
      return { kind: "album", album: catalogBrowse.albumView.album }
    }
    if (playlists.view) return { kind: "playlist", playlist: playlists.view.playlist }
    return undefined
  }

  function canOpenSelectedInfo(): boolean {
    return !currentBrowsePage() && selectedInfoTarget() !== undefined
  }

  function currentBrowsePage(): BrowsePage | undefined {
    return catalogBrowse.currentPage()
  }

  function canBrowseNowPlaying(): boolean {
    return catalogBrowse.canBrowseNowPlaying()
  }

  async function openNowPlayingContext(): Promise<void> {
    await catalogBrowse.openNowPlayingContext()
  }

  function closeContextPicker(): void {
    catalogBrowse.closeContextPicker()
  }

  async function chooseContextTarget(): Promise<void> {
    await catalogBrowse.chooseContextTarget()
  }

  function clearRadio(): void {
    radio.clear()
  }

  function clearFavoriteStations(): void {
    radio.clearFavorites()
  }

  function loadFavoriteStations(storefront: string): void {
    radio.loadFavorites(storefront)
  }

  function loadRadio(): void {
    radio.load()
  }

  function playSelectedStation(): void {
    if (!playbackSession.canPlayStation) return
    const station = selectedStation()
    if (station) {
      if (station.apple.externalLiveStream) return
      if (state.destination === "radio") radio.touchSelection()
      void playbackSession.playStation(station).catch(() => {})
    }
  }

  function selectedStation(): AppleCatalogStation | undefined {
    const selectedId = state.lists[state.destination].selectedTrackId
    if (state.destination === "radio") {
      const station = getVisibleStations().find((item) => item.id === selectedId)
      return appleStationResourceId(station) ? station as AppleCatalogStation : undefined
    }
    if (state.destination === "home" && !playlists.view) {
      const item = getVisibleHomeItems().find((candidate) => candidate.id === selectedId)
      return item && isAppleCatalogStation(item) ? item : undefined
    }
    return undefined
  }

  function isExternalLiveStation(station: Station): boolean {
    return "apple" in station &&
      (station as AppleCatalogStation).apple.externalLiveStream === true
  }

  function canToggleSelectedStationFavorite(): boolean {
    return appleAuthStatus.state === "signedIn" &&
      Boolean(options.onSetStationFavorite && appleStationResourceId(selectedStation()))
  }

  function toggleSelectedStationFavorite(): void {
    radio.toggleFavorite(
      selectedStation(),
      appleAuthStatus.state === "signedIn" ? appleAuthStatus.storefront : undefined,
    )
  }

  function canToggleSelectedStationLike(): boolean {
    return radio.canToggleLike(selectedStation(), appleAuthStatus.state === "signedIn")
  }

  async function toggleSelectedStationLiked(): Promise<void> {
    await radio.toggleLike(selectedStation())
  }

  async function submitRadioSearch(query: string, cursor?: string): Promise<void> {
    await radio.searchStations(query, cursor)
  }

  async function openSelectedRadioGenre(cursor?: string): Promise<void> {
    await radio.openSelectedGenre(cursor)
  }

  function canStartSongStation(): boolean {
    return catalogBrowse.canStartSongStation()
  }

  async function startCurrentSongStation(): Promise<void> {
    await catalogBrowse.startCurrentSongStation()
  }

  function closeBrowseSession(render = true): void {
    catalogBrowse.closeBrowseSession(render)
  }

  function popBrowsePage(): boolean {
    return catalogBrowse.popBrowsePage()
  }

  function moveBrowseSelection(delta: number): void {
    catalogBrowse.moveBrowseSelection(delta)
  }

  function openSelectedBrowseItem(): void {
    catalogBrowse.openSelectedBrowseItem()
  }

  function loadMoreSelectedArtistSection(): void {
    catalogBrowse.loadMoreSelectedArtistSection()
  }

  function canOpenSelectedAlbum(): boolean {
    return catalogBrowse.canOpenSelectedAlbum()
  }

  function leaveAlbumView(): void {
    catalogBrowse.leaveAlbumView()
  }

  async function openSelectedAlbum(): Promise<void> {
    await catalogBrowse.openSelectedAlbum()
  }

  async function loadPlaylistLanding(destination = state.destination): Promise<void> {
    await playlists.loadLanding(destination)
  }

  function reconcileLandingSelection(): void {
    playlists.reconcileSelection()
  }

  async function loadMorePlaylists(): Promise<void> {
    await playlists.loadMoreLanding()
  }

  async function openSelectedPlaylist(): Promise<void> {
    await playlists.openSelected()
  }

  async function loadMorePlaylistTracks(): Promise<void> {
    await playlists.loadMoreTracks()
  }

  function leavePlaylistView(): void {
    playlists.leaveView()
  }

  function navigateTo(destination: Destination): void {
    const reopenSearch = destination === "search" && state.destination === "search"
    closeBrowseSession(false)
    leaveAlbumView()
    leavePlaylistView()
    const baseItems = destination === "radio"
      ? getVisibleRadioItems()
      : destination === "home"
      ? getHomeItems()
      : destination === "playlists"
      ? getPlaylists(destination)
      : getBaseTracks(destination)
    const rememberedId = state.lists[destination].selectedTrackId
    const selectedTrackId = baseItems.some((item) => item.id === rememberedId)
      ? rememberedId
      : (baseItems[0]?.id ?? null)
    const actions: AppAction[] = [
      { type: "navigate", destination },
      { type: "select-track", trackId: selectedTrackId },
    ]
    if (destination === "search" && (!searchController.state.query || reopenSearch)) {
      actions.push({ type: "open-search", query: searchController.state.query })
    }
    dispatchAll(actions)
    if (isPlaylistLanding(destination) && appleAuthStatus.state === "signedIn") {
      void loadPlaylistLanding(destination)
    }
    if (destination === "radio" && appleAuthStatus.state === "signedIn") loadRadio()
  }

  async function submitCatalogSearch(query: string): Promise<void> {
    await searchController.submit(query)
  }

  async function loadMoreCatalogSearch(): Promise<void> {
    await searchController.loadMore()
  }

  function renderState(): void {
    const interactionState = interaction.snapshot()
    const activeBrowsePage = currentBrowsePage()
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
    const selected = selectedStation()
    const paletteCommands = interaction.paletteCommands()

    view.render({
      state,
      appleAuthStatus,
      authSuccessVisible: interactionState.authSuccessVisible,
      baseTracks: getBaseTracks(),
      visibleTracks: getVisibleTracks(),
      ...(activeBrowsePage ? { browsePage: activeBrowsePage } : {}),
      ...(activeAlbumView ? { albumView: activeAlbumView } : {}),
      ...(activePlaylistView ? { playlistView: activePlaylistView } : {}),
      homeSections: playlists.homeSections,
      favoriteStations: radio.favorites,
      homeItems: getHomeItems(),
      visibleHomeItems: getVisibleHomeItems(),
      playlists: getPlaylists(),
      visiblePlaylists: getVisiblePlaylists(),
      landingState: state.destination === "home" ? playlists.homeState : playlists.libraryState,
      radioRows: getRadioRows(),
      visibleStations: getVisibleStations(),
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
    })
  }

  function handleResize(): void {
    view.resize()
    renderState()
  }

  const handleKeypress = (key: KeyEvent) => interaction.handleKey(key)
  renderer.keyInput.on("keypress", handleKeypress)
  renderer.on(CliRenderEvents.RESIZE, handleResize)
  playbackSession.start()
  view.resize()
  renderState()

  return {
    getState: () => ({ ...state }),
    setAppleAuthStatus: (status) => {
      const shouldLoadHome =
        status.state === "signedIn" &&
        (appleAuthStatus.state !== "signedIn" ||
          status.storefront !== appleAuthStatus.storefront)
      const shouldLoadFavorites = shouldLoadHome
      const shouldLoadRadio =
        status.state === "signedIn" &&
        state.destination === "radio" &&
        (appleAuthStatus.state !== "signedIn" ||
          status.storefront !== appleAuthStatus.storefront)
      const playbackSessionChanged =
        appleAuthStatus.state === "signedIn" &&
        (status.state !== "signedIn" ||
          status.storefront !== appleAuthStatus.storefront)
      if (
        playbackSessionChanged
      ) {
        interaction.resetForAuthenticationChange()
        catalogBrowse.reset()
        leavePlaylistView()
        searchController.clear()
        playlists.reset()
        clearFavoriteStations()
        clearRadio()
        tracks.clear("search")
        tracks.clear("playlist")
        tracks.clear("album")
        tracks.clear("browse")
        state = reduceAppState(state, {
          type: "reset-list",
          destination: "home",
          selectedTrackId: null,
        })
        state = reduceAppState(state, {
          type: "reset-list",
          destination: "radio",
          selectedTrackId: null,
        })
        state = reduceAppState(state, {
          type: "reset-list",
          destination: "search",
          selectedTrackId: null,
        })
        state = reduceAppState(state, {
          type: "reset-list",
          destination: "playlists",
          selectedTrackId: null,
        })
      }
      interaction.authenticationChanged(appleAuthStatus, status)
      appleAuthStatus = status
      playbackSession.authenticationChanged(status.state === "signedIn", playbackSessionChanged)
      if (state.mode.type === "palette") {
        state = reduceAppState(state, {
          type: "edit-palette",
          query: state.mode.query,
        })
      }
      renderState()
      if (shouldLoadFavorites && status.state === "signedIn") {
        loadFavoriteStations(status.storefront)
      }
      if (shouldLoadHome) {
        void loadPlaylistLanding("home")
        if (state.destination === "playlists") void loadPlaylistLanding("playlists")
      }
      if (shouldLoadRadio) loadRadio()
    },
    destroy: () => {
      searchController.clear()
      catalogBrowse.destroy()
      playlists.destroy()
      clearFavoriteStations()
      clearRadio()
      playbackSession.destroy()
      renderer.keyInput.off("keypress", handleKeypress)
      renderer.off(CliRenderEvents.RESIZE, handleResize)
      view.destroy()
    },
  }
}
