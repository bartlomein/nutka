import { filterTracks, type AppState } from "../../core/state"
import type {
  AppleCatalogPlaylist,
  AppleCatalogStation,
  AppleCatalogStationGenre,
  AppleCatalogTrack,
  ApplePlaylist,
  Station,
  Track,
} from "../../core/types"
import {
  appleStationResourceId,
  browsePageTracks,
  filterHomeValues,
  filterPlaylistValues,
  isAppleCatalogStation,
  isPlayableAppleTrack,
  isPlaylistLanding,
} from "./browse"
import type { CatalogBrowseController } from "./catalog-browse-controller"
import type { CatalogSearchController } from "./catalog-search-controller"
import type { InfoTarget } from "./copy"
import type { LibraryController } from "./library-controller"
import type { PlaylistController } from "./playlist-controller"
import type { RadioController } from "./radio-controller"
import type { TrackStore } from "./track-store"

interface AppQuerySources {
  getState(): AppState
  libraryTracks: readonly Track[]
  tracks: TrackStore
  library: LibraryController | undefined
  radio: RadioController
  playlists: PlaylistController
  searchController: CatalogSearchController
  catalogBrowse: CatalogBrowseController
}

export function createAppQueries(sources: AppQuerySources) {
  const { libraryTracks, tracks, library, radio, playlists, searchController, catalogBrowse } = sources

  function randomPlaybackTracks(): readonly AppleCatalogTrack[] {
    const state = sources.getState()
    const browsePage = catalogBrowse.currentPage()
    const browseTracks = browsePage
      ? browsePageTracks(browsePage).filter(isPlayableAppleTrack)
      : []
    if (browseTracks.length > 0) return browseTracks
    if (state.destination === "library" && library) {
      return library.playableTracks(state.mode.type === "filter" ? state.mode.draft : state.lists.library.filter)
    }
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

  function getBaseTracks(destination = sources.getState().destination): readonly Track[] {
    const state = sources.getState()
    if (destination === "radio") return []
    if (destination === "library") return library?.rows() ?? libraryTracks
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
    const state = sources.getState()
    const list = state.lists[state.destination]
    const query = state.mode.type === "filter" ? state.mode.draft : list.filter
    return filterTracks(getBaseTracks(), query)
  }

  function getPlaylists(destination = sources.getState().destination): readonly ApplePlaylist[] {
    return playlists.getPlaylists(destination)
  }

  function getVisiblePlaylists(): readonly ApplePlaylist[] {
    const state = sources.getState()
    const query = state.mode.type === "filter"
      ? state.mode.draft
      : state.lists[state.destination].filter
    return playlists.getVisiblePlaylists(query)
  }

  function getHomeItems(): readonly (AppleCatalogPlaylist | AppleCatalogStation)[] {
    return playlists.getHomeItems()
  }

  function getVisibleHomeItems(): readonly (AppleCatalogPlaylist | AppleCatalogStation)[] {
    const state = sources.getState()
    const query = state.mode.type === "filter"
      ? state.mode.draft
      : state.lists.home.filter
    return playlists.getVisibleHomeItems(query)
  }

  function getRadioRows(query?: string) {
    const state = sources.getState()
    return radio.rows(
      query ?? (state.mode.type === "filter" ? state.mode.draft : state.lists.radio.filter),
    )
  }

  function getVisibleRadioItems(): readonly (Station | AppleCatalogStationGenre)[] {
    const state = sources.getState()
    const query = state.mode.type === "filter" ? state.mode.draft : state.lists.radio.filter
    return radio.visibleItems(query)
  }

  function getVisibleStations(): readonly Station[] {
    const state = sources.getState()
    const query = state.mode.type === "filter" ? state.mode.draft : state.lists.radio.filter
    return radio.visibleStations(query)
  }

  function getVisibleItemIds(): readonly string[] {
    const state = sources.getState()
    if (state.destination === "radio") return getVisibleRadioItems().map((item) => item.id)
    if (state.destination === "home" && !playlists.view) {
      return getVisibleHomeItems().map((item) => item.id)
    }
    return isPlaylistLanding(state.destination) && !playlists.view
      ? getVisiblePlaylists().map((playlist) => playlist.id)
      : getVisibleTracks().map((track) => track.id)
  }

  function filteredItemIds(draft: string): readonly string[] {
    const state = sources.getState()
    return state.destination === "radio"
      ? getRadioRows(draft).flatMap((row) =>
          row.kind === "station"
            ? [row.station.id]
            : row.kind === "genre" ? [row.genre.id] : []
        )
      : state.destination === "home" && !playlists.view
      ? filterHomeValues(getHomeItems(), draft).map((item) => item.id)
      : state.destination === "playlists" && !playlists.view
      ? filterPlaylistValues(getPlaylists(), draft).map((playlist) => playlist.id)
      : filterTracks(getBaseTracks(), draft).map((track) => track.id)
  }

  function selectedInfoTarget(): InfoTarget | undefined {
    const state = sources.getState()
    const selectedId = state.lists[state.destination].selectedTrackId
    if (state.destination === "library" && library) {
      const item = library.page.items.find((item) => item.id === selectedId)
      return item?.kind === "song" ? { kind: "track", track: item.playback ?? item } : undefined
    }
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

  function selectedStation(): AppleCatalogStation | undefined {
    const state = sources.getState()
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

  return {
    randomPlaybackTracks,
    getBaseTracks,
    getVisibleTracks,
    getPlaylists,
    getVisiblePlaylists,
    getHomeItems,
    getVisibleHomeItems,
    getRadioRows,
    getVisibleRadioItems,
    getVisibleStations,
    getVisibleItemIds,
    filteredItemIds,
    selectedInfoTarget,
    selectedStation,
  }
}
