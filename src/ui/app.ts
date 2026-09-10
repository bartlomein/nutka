import { CliRenderEvents, type CliRenderer, type KeyEvent } from "@opentui/core"

import {
  createInitialState,
  reduceAppState,
  type AppAction,
  type AppState,
  type Destination,
} from "../core/state"
import type { AppleCatalogStation, AppleCatalogTrack } from "../core/types"
import type { AppleAuthStatus } from "../services/apple-auth"
import { AppInteractionController } from "./app/app-interaction-controller"
import type { NutkaAppOptions } from "./app/app-options"
import { createAppQueries } from "./app/app-queries"
import {
  appleStationResourceId,
  isPlayableAppleTrack,
  isPlaylistLanding,
} from "./app/browse"
import { CatalogSearchController } from "./app/catalog-search-controller"
import { CatalogBrowseController } from "./app/catalog-browse-controller"
import { PlaybackSessionController } from "./app/playback-session-controller"
import { PlaylistController } from "./app/playlist-controller"
import { LibraryController } from "./app/library-controller"
import { RadioController } from "./app/radio-controller"
import { TrackStore } from "./app/track-store"
import { createAppView } from "./app/view"
import { buildAppViewModel } from "./app/view-model"
import { defaultVisualizerSettings } from "./visualizer/preferences"

export { formatDuration } from "./app/browse"
export type { NutkaAppOptions } from "./app/app-options"

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
  const library = options.library ? new LibraryController(options.library, {
    active: () => state.destination === "library",
    authenticated: () => appleAuthStatus.state === "signedIn",
    list: () => state.lists.library,
    query: () => state.mode.type === "filter" ? state.mode.draft : state.lists.library.filter,
    restoreList: (list) => {
      state = {
        ...state,
        lists: { ...state.lists, library: { ...list } },
      }
    },
    replaceTracks: (items) => tracks.replace("library", items),
    render: () => renderState(),
  }) : undefined
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
      if (state.destination === "home") playlists.reconcileSelection()
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
    replaceTracks: (_previous, next) => {
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
    getRandomTracks: () => queries.randomPlaybackTracks(),
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
      visibleTracks: queries.getVisibleTracks().filter(isPlayableAppleTrack),
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

  const queries = createAppQueries({
    getState: () => state,
    libraryTracks,
    tracks,
    library,
    radio,
    playlists,
    searchController,
    catalogBrowse,
  })

  const view = createAppView(renderer, {
    onSeek: (positionSeconds) => playbackSession.requestSeek(positionSeconds),
    visualizerSettings: initialVisualizerSettings,
  })
  const interaction = new AppInteractionController({
    getState: () => state,
    getAppleAuthStatus: () => appleAuthStatus,
    hasAppleAuth: () => Boolean(options.onAppleSignIn),
    hasBrowsePage: () => Boolean(catalogBrowse.currentPage()),
    hasContextPicker: () => Boolean(catalogBrowse.contextPicker),
    selectedInfoTarget: queries.selectedInfoTarget,
    visibleItemIds: queries.getVisibleItemIds,
    filteredItemIds: queries.filteredItemIds,
    canOpenAlbum: () => catalogBrowse.canOpenSelectedAlbum(),
    canOpenInfo: canOpenSelectedInfo,
    canBrowseNowPlaying: () => catalogBrowse.canBrowseNowPlaying(),
    canStartSongStation: () => catalogBrowse.canStartSongStation(),
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
    submitRadioSearch: (query) => void radio.searchStations(query),
    submitCatalogSearch: (query) => void searchController.submit(query),
    moveContextSelection: (delta) => catalogBrowse.moveContextSelection(delta),
    closeContextPicker: () => catalogBrowse.closeContextPicker(),
    chooseContextTarget: () => void catalogBrowse.chooseContextTarget(),
    openNowPlayingContext: () => void catalogBrowse.openNowPlayingContext(),
    popBrowsePage: () => void popBrowsePage(),
    moveBrowseSelection: (delta) => catalogBrowse.moveBrowseSelection(delta),
    openSelectedBrowseItem: () => catalogBrowse.openSelectedBrowseItem(),
    loadMoreSelectedBrowseSection: () => catalogBrowse.loadMoreSelectedArtistSection(),
    moveSelection: (delta) => {
      const visibleTrackIds = queries.getVisibleItemIds()
      if (state.destination === "radio" && visibleTrackIds.length > 0) radio.touchSelection()
      dispatch({ type: "move-selection", delta, visibleTrackIds })
    },
    activateSelection: () => {
      if (state.destination === "library" && library) {
        if (appleAuthStatus.state !== "signedIn") return
        const query = state.lists.library.filter
        if (library.openSelected(query)) return
        const items = library.visibleItems(query)
        const index = items.findIndex((item) => item.id === state.lists.library.selectedTrackId)
        const selected = items[index]
        if (selected?.kind === "song" && selected.playback) {
          const upcoming = items.slice(index + 1).flatMap((item) =>
            item.kind === "song" && item.playback ? [item.playback] : [])
          void playbackSession.play(selected.playback, upcoming).catch(() => {})
        }
        return
      }
      if (state.destination === "radio") {
        const selectedId = state.lists.radio.selectedTrackId
        if (radio.genres.some((genre) => genre.id === selectedId)) void radio.openSelectedGenre()
        else playSelectedStation()
        return
      }
      if (state.destination === "home" && !playlists.view && queries.selectedStation()) {
        playSelectedStation()
        return
      }
      if (isPlaylistLanding(state.destination) && !playlists.view) {
        void playlists.openSelected()
        return
      }
      const visibleTracks = queries.getVisibleTracks()
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
    toggleSelectedStationLike: () => void radio.toggleLike(queries.selectedStation()),
    cycleRepeatMode: () => playbackSession.cycleRepeatMode(),
    toggleShuffleMode: () => playbackSession.toggleShuffleMode(),
    playRandom: () => playbackSession.playRandom(),
    playNext: () => playbackSession.playNext(),
    seekBy: (seconds) => playbackSession.seekBy(seconds),
    openSearchOrFilter: () => dispatch(state.destination === "radio"
      ? { type: "open-search", query: "" }
      : { type: "open-filter" }),
    openSelectedAlbum: () => {
      if (!catalogBrowse.currentPage() && state.destination === "search") void catalogBrowse.openSelectedAlbum()
    },
    loadMore: () => {
      if (catalogBrowse.currentPage()) return
      if (state.destination === "library" && library) {
        library.loadMore()
        return
      }
      if (state.destination === "search" && !catalogBrowse.albumView) void searchController.loadMore()
      else if (state.destination === "radio") {
        if (radio.activeResultType === "search" && radio.search.nextCursor) {
          void radio.searchStations(radio.search.query, radio.search.nextCursor)
        } else if (radio.activeResultType === "genre" && radio.genreNextCursor) {
          void radio.openSelectedGenre(radio.genreNextCursor)
        }
      } else if (isPlaylistLanding(state.destination)) {
        if (playlists.view) void playlists.loadMoreTracks()
        else void playlists.loadMoreLanding()
      }
    },
    escapeNormalMode: () => {
      if (state.destination === "library" && library?.back()) return
      if (catalogBrowse.albumView) {
        catalogBrowse.leaveAlbumView()
        renderState()
      } else if (playlists.view) {
        playlists.leaveView()
        renderState()
      } else if (state.destination !== "home") navigateTo("home")
    },
    switchLibrarySection: (section) => {
      if (state.destination === "library" && !catalogBrowse.currentPage()) library?.switchSection(section)
    },
    refreshLibrary: () => {
      if (state.destination === "library" && !catalogBrowse.currentPage()) library?.refresh()
    },
    startCurrentSongStation: () => void catalogBrowse.startCurrentSongStation(),
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

  function canOpenSelectedInfo(): boolean {
    return !catalogBrowse.currentPage() && queries.selectedInfoTarget() !== undefined
  }

  function playSelectedStation(): void {
    if (!playbackSession.canPlayStation) return
    const station = queries.selectedStation()
    if (station) {
      if (station.apple.externalLiveStream) return
      if (state.destination === "radio") radio.touchSelection()
      void playbackSession.playStation(station).catch(() => {})
    }
  }

  function canToggleSelectedStationFavorite(): boolean {
    return appleAuthStatus.state === "signedIn" &&
      Boolean(options.onSetStationFavorite && appleStationResourceId(queries.selectedStation()))
  }

  function toggleSelectedStationFavorite(): void {
    radio.toggleFavorite(
      queries.selectedStation(),
      appleAuthStatus.state === "signedIn" ? appleAuthStatus.storefront : undefined,
    )
  }

  function canToggleSelectedStationLike(): boolean {
    return radio.canToggleLike(queries.selectedStation(), appleAuthStatus.state === "signedIn")
  }

  function popBrowsePage(): boolean {
    if (!catalogBrowse.currentPage() && state.destination === "library" && library?.back()) return true
    return catalogBrowse.popBrowsePage()
  }

  function navigateTo(destination: Destination): void {
    if (state.destination === "library") library?.leave()
    const reopenSearch = destination === "search" && state.destination === "search"
    catalogBrowse.closeBrowseSession(false)
    catalogBrowse.leaveAlbumView()
    playlists.leaveView()
    const baseItems = destination === "radio"
      ? queries.getVisibleRadioItems()
      : destination === "home"
      ? queries.getHomeItems()
      : destination === "playlists"
      ? queries.getPlaylists(destination)
      : queries.getBaseTracks(destination)
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
      void playlists.loadLanding(destination)
    }
    if (destination === "radio" && appleAuthStatus.state === "signedIn") radio.load()
    if (destination === "library") library?.enter()
  }

  function renderState(): void {
    view.render(buildAppViewModel({
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
    }))
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
      const shouldLoadRadio = shouldLoadHome && state.destination === "radio"
      const playbackSessionChanged =
        appleAuthStatus.state === "signedIn" &&
        (status.state !== "signedIn" ||
          status.storefront !== appleAuthStatus.storefront)
      if (playbackSessionChanged) {
        interaction.resetForAuthenticationChange()
        catalogBrowse.reset()
        playlists.leaveView()
        searchController.clear()
        playlists.reset()
        library?.reset()
        state = reduceAppState(state, { type: "reset-list", destination: "library", selectedTrackId: null })
        radio.clearFavorites()
        radio.clear()
        tracks.clear("search")
        tracks.clear("playlist")
        tracks.clear("album")
        tracks.clear("browse")
        for (const destination of ["home", "radio", "search", "playlists"] as const) {
          state = reduceAppState(state, {
            type: "reset-list",
            destination,
            selectedTrackId: null,
          })
        }
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
      if (shouldLoadHome && status.state === "signedIn") {
        radio.loadFavorites(status.storefront)
      }
      if (shouldLoadHome) {
        void playlists.loadLanding("home")
        if (state.destination === "playlists") void playlists.loadLanding("playlists")
      }
      if (shouldLoadRadio) radio.load()
      if (shouldLoadHome && state.destination === "library") library?.enter()
    },
    destroy: () => {
      searchController.clear()
      catalogBrowse.destroy()
      playlists.destroy()
      library?.reset()
      radio.clearFavorites()
      radio.clear()
      playbackSession.destroy()
      renderer.keyInput.off("keypress", handleKeypress)
      renderer.off(CliRenderEvents.RESIZE, handleResize)
      view.destroy()
    },
  }
}
