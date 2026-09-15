import type { CliRenderer } from "@opentui/core"

import type { AppleCatalogStation, Station } from "../../core/types"
import { theme } from "../theme"
import {
  appleStationResourceId,
  artistDisplayRows,
  artistPageStatusLine,
  artistRowContent,
  artistRowId,
  artistSelectableRows,
  browseAlbumEmptyMessage,
  browsePageHasError,
  formatDuration,
  getRowStart,
  homeDisplayRows,
  isSelectableArtistRow,
  playlistDisplayRows,
  playlistLandingUnavailable,
  playlistLoading,
  playlistLoadingMore,
} from "./browse"
import {
  albumEmptyMessage,
  destinationLabel,
  emptyMessage,
  playlistEmptyMessage,
  playlistTrackEmptyMessage,
  pluralize,
  searchEmptyMessage,
} from "./copy"
import {
  maxQueueRows,
  maxTrackRows,
  setTrackRowColor,
  setTrackRowContent,
} from "./renderables"
import type { AppRenderables, AppViewModel } from "./view-contracts"

export function renderWorkspace(
  renderer: CliRenderer,
  view: AppRenderables,
  model: AppViewModel,
): void {
  const {
    state,
    baseTracks,
    browsePage: activeBrowsePage,
    albumView: activeAlbumView,
    playlistView: activePlaylistView,
    visualizerSettingsDialog,
  } = model
  const browseArtistRows = activeBrowsePage?.kind === "artist"
    ? artistDisplayRows(activeBrowsePage)
    : []
  const visibleTracks = activeBrowsePage?.kind === "album"
    ? activeBrowsePage.album?.tracks ?? []
    : model.visibleTracks
  const homeLanding = !activeBrowsePage && state.destination === "home" && !activePlaylistView
  const playlistLanding = !activeBrowsePage && state.destination === "playlists" && !activePlaylistView
  const visibleHomeItems = homeLanding ? model.visibleHomeItems : []
  const homeRows = homeLanding
    ? homeDisplayRows(model.favoriteStations, model.homeSections, visibleHomeItems)
    : []
  const visiblePlaylists = playlistLanding ? model.visiblePlaylists : []
  const playlistRows = playlistLanding
    ? playlistDisplayRows(state.destination, visiblePlaylists, model.homeSections)
    : []
  const radioLanding = !activeBrowsePage && state.destination === "radio"
  const radioRows = radioLanding ? model.radioRows : []
  const visibleStations = radioLanding ? model.visibleStations : []
  const landingState = model.landingState
  const selectedId = activeBrowsePage?.selectedId ??
    state.lists[state.destination].selectedTrackId
  const selectedIndex = activeBrowsePage?.kind === "artist"
    ? browseArtistRows.findIndex(
        (row) => isSelectableArtistRow(row) && artistRowId(row) === selectedId,
      )
    : radioLanding
      ? radioRows.findIndex(
          (row) => (row.kind === "station" && row.station.id === selectedId) ||
            (row.kind === "genre" && row.genre.id === selectedId),
        )
    : homeLanding
      ? homeRows.findIndex((row) =>
          (row.kind === "playlist" && row.playlist.id === selectedId) ||
          (row.kind === "station" && row.station.id === selectedId)
        )
    : playlistLanding
      ? playlistRows.findIndex(
        (row) => row.kind === "playlist" && row.playlist.id === selectedId,
      )
      : visibleTracks.findIndex((track) => track.id === selectedId)
  const activeFilter = state.mode.type === "filter"
    ? state.mode.draft
    : state.lists[state.destination].filter
  const showFilter = Boolean(activeBrowsePage) ||
    Boolean(model.library) ||
    state.destination === "search" ||
    state.destination === "home" ||
    state.destination === "playlists" ||
    state.destination === "radio" ||
    state.mode.type === "search" ||
    Boolean(activeFilter)
  const compactHeight = renderer.terminalHeight < 23
  const activeVisualizerSettings = visualizerSettingsDialog?.draft ?? model.visualizerSettings
  const normalReservedRows = (showFilter ? 18 : 16) + (
    model.visualizerEnabled ? activeVisualizerSettings.height : 0
  )
  const destinationName = destinationLabel(state.destination)
  const showingAlbum = activeAlbumView !== undefined
  const showingPlaylist = activePlaylistView !== undefined

  view.breadcrumb.content = model.library
    ? renderer.terminalWidth < 50
      ? "nutka / library"
      : `nutka  /  library  /  ${model.library.section}${model.library.nested ? `  /  ${model.library.page.section}` : ""}`
    : activeBrowsePage
    ? `nutka  /  ${activeBrowsePage.kind}`
    : showingPlaylist
    ? `nutka  /  ${activePlaylistView.sourceDestination}  /  playlist`
    : showingAlbum
    ? "nutka  /  search  /  album"
    : `nutka  /  ${destinationName.toLowerCase()}`
  view.workspaceTitle.content = model.library
    ? model.library.page.title
    : activeBrowsePage
    ? activeBrowsePage.kind === "artist"
      ? activeBrowsePage.artist.name
      : activeBrowsePage.album?.title ?? activeBrowsePage.summary.title
    : activePlaylistView
      ? activePlaylistView.playlist.title
      : activeAlbumView
        ? activeAlbumView.title
        : state.destination === "search"
          ? "Search music"
          : destinationName
  view.workspaceCount.content = model.library
    ? `${visibleTracks.length} ${pluralize(model.library.page.section.slice(0, -1), visibleTracks.length)} loaded`
    : activeBrowsePage?.kind === "artist"
    ? `${artistSelectableRows(activeBrowsePage).length} items`
    : activeBrowsePage?.kind === "album"
      ? activeBrowsePage.status === "loading"
        ? "loading album..."
        : activeBrowsePage.status === "error"
          ? "unavailable"
          : `${visibleTracks.length} ${pluralize("track", visibleTracks.length)}`
    : activePlaylistView?.status === "loading"
      ? "loading playlist..."
      : activePlaylistView?.status === "loadingMore"
        ? `${visibleTracks.length} tracks · loading more...`
      : activePlaylistView?.status === "error"
        ? "unavailable"
    : activeAlbumView?.status === "loading"
      ? "loading album..."
      : activeAlbumView?.status === "error"
        ? "unavailable"
    : radioLanding
      ? `${visibleStations.length} ${pluralize("station", visibleStations.length)}`
    : state.destination === "search" && model.searchState.status === "loading"
      ? "searching..."
      : state.destination === "search" && model.searchState.status === "loadingMore"
        ? `${visibleTracks.length} tracks · loading more...`
      : homeLanding
        ? `${visibleHomeItems.length} ${pluralize("item", visibleHomeItems.length)}`
      : playlistLanding
        ? `${visiblePlaylists.length} ${pluralize("playlist", visiblePlaylists.length)}`
      : state.destination === "queue" && state.playback.dynamicQueue
        ? `${visibleTracks.length} ${pluralize("track", visibleTracks.length)} · radio continues`
        : `${visibleTracks.length} ${pluralize("track", visibleTracks.length)}`
  view.filterLine.visible = showFilter
  view.filterLine.content = activeBrowsePage?.kind === "artist"
    ? artistPageStatusLine(activeBrowsePage)
    : activeBrowsePage?.kind === "album"
      ? activeBrowsePage.status === "loading"
        ? `◌  loading “${activeBrowsePage.summary.title}”`
        : activeBrowsePage.status === "error"
          ? "×  album unavailable · esc back"
          : activeBrowsePage.album?.artist ?? activeBrowsePage.summary.artist
    : state.mode.type === "search"
      ? `›  ${state.mode.draft}_`
      : state.mode.type === "filter"
      ? `›  ${state.mode.draft}_`
      : model.library
        ? model.library.statusLine
      : activePlaylistView?.status === "loading"
        ? `◌  loading “${activePlaylistView.playlist.title}”`
        : activePlaylistView?.status === "loadingMore"
          ? `◌  loading more tracks from “${activePlaylistView.playlist.title}”`
        : activePlaylistView?.status === "error"
          ? "×  playlist unavailable · esc back"
          : activePlaylistView
            ? `${activePlaylistView.playlist.curator}${activeFilter ? `  ·  / ${activeFilter}` : ""}`
      : (homeLanding || playlistLanding) && playlistLoading(landingState)
        ? state.destination === "home"
          ? "◌  loading personalized recommendations"
          : "◌  loading library playlists"
        : (homeLanding || playlistLanding) && playlistLoadingMore(landingState)
          ? "◌  loading more playlists"
        : (homeLanding || playlistLanding) && playlistLandingUnavailable(
            landingState,
            homeLanding ? visibleHomeItems.length : visiblePlaylists.length,
          )
          ? "×  playlists unavailable"
        : homeLanding || playlistLanding
          ? `${state.destination === "home" ? "Personalized for you" : "Your Library"}${
            activeFilter ? `  ·  / ${activeFilter}` : ""
          }`
      : radioLanding
        ? model.radioStatusLine
      : activeAlbumView?.status === "loading"
        ? `◌  loading “${activeAlbumView.title}”`
        : activeAlbumView?.status === "error"
          ? "×  album unavailable · esc back"
          : activeAlbumView
            ? `${activeAlbumView.album!.artist}${activeFilter ? `  ·  / ${activeFilter}` : ""}`
      : state.destination === "search"
        ? model.searchStatusLine
        : ""
  view.filterLine.fg = model.library?.page.error || (activeBrowsePage && browsePageHasError(activeBrowsePage))
    ? theme.amber
    : state.mode.type === "filter" || state.mode.type === "search"
      ? theme.text
      : activeAlbumView?.status === "error" ||
          activePlaylistView?.status === "error" ||
           ((homeLanding || playlistLanding) && playlistLandingUnavailable(
             landingState,
             homeLanding ? visibleHomeItems.length : visiblePlaylists.length,
           )) ||
          model.searchState.status === "error"
        ? theme.amber
        : theme.muted
  setTrackRowContent(
    view.tableHeader,
    model.library && model.library.page.section !== "songs"
      ? { title: model.library.page.section === "artists" ? "artist" : "album", artist: "artist", album: "", time: "" }
      : activeBrowsePage?.kind === "artist"
      ? { title: "item", artist: "artist", album: "type", year: "year", time: "time" }
      : radioLanding
        ? { title: "station", artist: "context", album: "description", time: "" }
       : homeLanding
         ? { title: "item", artist: "context", album: "description", time: "" }
       : playlistLanding
         ? { title: "playlist", artist: "curator", album: "description", time: "" }
        : { title: "track", artist: "artist", album: "album", time: "time" },
  )
  const showYearColumn = activeBrowsePage?.kind === "artist"
  view.tableHeader.year.visible = showYearColumn
  view.tableHeader.box.visible = !(compactHeight && showFilter)

  const activeRowCount = Math.max(
    1,
    Math.min(
      maxTrackRows,
      renderer.terminalHeight -
        (compactHeight ? (showFilter ? 10 : 9) : normalReservedRows),
    ),
  )
  const rowStart = getRowStart(
    Math.max(0, selectedIndex),
    activeBrowsePage?.kind === "artist"
      ? browseArtistRows.length
       : radioLanding
         ? radioRows.length
         : homeLanding
           ? homeRows.length
           : playlistLanding ? playlistRows.length : visibleTracks.length,
    activeRowCount,
  )

  view.trackRows.forEach((row, rowIndex) => {
    if (rowIndex >= activeRowCount) {
      row.box.visible = false
      return
    }

    restoreTrackRowLayout(row, renderer.terminalWidth, showYearColumn)

    const itemIndex = rowStart + rowIndex
    const artistRow = activeBrowsePage?.kind === "artist"
      ? browseArtistRows[itemIndex]
      : undefined
    const playlistRow = playlistLanding ? playlistRows[itemIndex] : undefined
    const homeRow = homeLanding ? homeRows[itemIndex] : undefined
    const radioRow = radioLanding ? radioRows[itemIndex] : undefined
    const track = homeLanding || playlistLanding || radioLanding || activeBrowsePage?.kind === "artist"
      ? undefined
      : visibleTracks[itemIndex]
    if (radioRow?.kind === "heading") {
      row.box.visible = true
      setTrackRowContent(row, { title: radioRow.title, artist: "", album: "", time: "" })
      row.box.backgroundColor = theme.background
      setTrackRowColor(row, theme.accent)
      return
    }
    if (radioRow?.kind === "message") {
      row.box.visible = true
      setTrackRowContent(row, { title: `  ${radioRow.title}`, artist: "", album: "", time: "" })
      row.box.backgroundColor = theme.background
      setTrackRowColor(row, theme.muted)
      return
    }
    if (radioRow?.kind === "station") {
      const station = radioRow.station
      const unavailable = isExternalLiveStation(station)
      const selected = station.id === selectedId
      const favorite = model.favoriteStationIds.has(appleStationResourceId(station) ?? "")
      const unavailableCopy = "unavailable in MusicKit"
      row.box.visible = true
      setTrackRowContent(row, {
        title: `${selected ? "›" : " "} ${favorite ? "★ " : ""}${station.title}${
          unavailable && renderer.terminalWidth < 100 ? ` — ${unavailableCopy}` : ""
        }`,
        artist: unavailable
          ? renderer.terminalWidth < 100 ? "" : unavailableCopy
          : station.subtitle ?? (station.isLive ? "live" : "station"),
        album: unavailable ? unavailableCopy : station.description ?? "",
        time: "",
      })
      row.box.backgroundColor = selected ? theme.selection : theme.background
      setTrackRowColor(row, selected ? theme.text : theme.muted)
      return
    }
    if (radioRow?.kind === "genre") {
      const selected = radioRow.genre.id === selectedId
      row.box.visible = true
      setTrackRowContent(row, {
        title: `${selected ? "›" : " "} ${radioRow.genre.name}`,
        artist: "genre",
        album: "enter to browse stations",
        time: "",
      })
      row.box.backgroundColor = selected ? theme.selection : theme.background
      setTrackRowColor(row, selected ? theme.text : theme.muted)
      return
    }
    if (artistRow?.kind === "heading") {
      row.box.visible = true
      setTrackRowContent(row, { title: artistRow.title, artist: "", album: "", time: "" })
      row.box.backgroundColor = theme.background
      setTrackRowColor(row, theme.accent)
      return
    }
    if (artistRow?.kind === "message") {
      row.box.visible = true
      setTrackRowContent(row, { title: `  ${artistRow.title}`, artist: "", album: "", time: "" })
      row.box.backgroundColor = theme.background
      setTrackRowColor(row, theme.muted)
      return
    }
    if (artistRow && isSelectableArtistRow(artistRow)) {
      const itemId = artistRowId(artistRow)
      const selected = itemId === selectedId
      const content = artistRowContent(artistRow, selected, renderer.terminalWidth)
      row.box.visible = true
      setTrackRowContent(row, content)
      row.box.backgroundColor = selected ? theme.selection : theme.background
      setTrackRowColor(row, selected ? theme.text : theme.muted)
      return
    }
    const landingRow = homeRow ?? playlistRow
    if (landingRow?.kind === "heading") {
      row.box.visible = true
      setTrackRowContent(row, { title: landingRow.title, artist: "", album: "", time: "" })
      row.box.backgroundColor = theme.background
      setTrackRowColor(row, theme.accent)
      return
    }
    if (landingRow?.kind === "playlist") {
      const playlist = landingRow.playlist
      const selected = playlist.id === selectedId
      row.box.visible = true
      setTrackRowContent(row, {
        title: renderer.terminalWidth < 64
          ? `${selected ? "›" : " "} ${playlist.title} — ${playlist.curator}`
          : `${selected ? "›" : " "} ${playlist.title}`,
        artist: playlist.curator,
        album: playlist.description ?? (
          playlist.apple.resourceType === "library-playlists" ? "saved" : "recommended"
        ),
        time: "",
      })
      row.box.backgroundColor = selected ? theme.selection : theme.background
      setTrackRowColor(row, selected ? theme.text : theme.muted)
      return
    }
    if (homeRow?.kind === "station") {
      const station = homeRow.station
      const unavailable = station.apple.externalLiveStream === true
      const selected = station.id === selectedId
      const favorite = model.favoriteStationIds.has(station.apple.resourceId)
      row.box.visible = true
      setTrackRowContent(row, {
        title: `${selected ? "›" : " "} ${favorite ? "★ " : ""}${station.title}`,
        artist: unavailable
          ? "unavailable in MusicKit"
          : station.subtitle ?? (station.isLive ? "live" : "station"),
        album: station.description ?? "",
        time: "",
      })
      row.box.backgroundColor = selected ? theme.selection : theme.background
      setTrackRowColor(row, selected ? theme.text : theme.muted)
      return
    }
    if (!track) {
      const empty = activeBrowsePage?.kind === "artist"
        ? browseArtistRows.length === 0
        : radioLanding
          ? radioRows.length === 0
          : homeLanding
            ? homeRows.length === 0
            : playlistLanding ? playlistRows.length === 0 : visibleTracks.length === 0
      const showEmpty = rowIndex === 0 && empty
      row.box.visible = showEmpty
      setTrackRowContent(row, {
        title: showEmpty
          ? model.library
            ? model.library.emptyMessage
          : activeBrowsePage?.kind === "album"
            ? browseAlbumEmptyMessage(activeBrowsePage.status)
            : activeBrowsePage?.kind === "artist"
              ? "No artist content found"
          : radioLanding
            ? "No radio stations found"
          : homeLanding || playlistLanding
              ? playlistEmptyMessage(
                state.destination,
                landingState,
                homeLanding ? model.homeItems.length : model.playlists.length,
              )
          : activePlaylistView
            ? playlistTrackEmptyMessage(activePlaylistView.status)
          : state.destination === "search"
            ? activeAlbumView
              ? albumEmptyMessage(activeAlbumView.status)
              : searchEmptyMessage(model.searchState)
            : emptyMessage(state.destination, baseTracks.length, state.playback.dynamicQueue)
          : "",
        artist: "",
        album: "",
        time: "",
      })
      row.box.backgroundColor = theme.background
      row.title.flexGrow = 1
      row.title.width = "auto"
      row.artist.visible = false
      row.album.visible = false
      row.year.visible = false
      row.time.visible = false
      setTrackRowColor(row, theme.muted)
      return
    }

    const selected = track.id === selectedId
    const libraryItem = model.library?.page.items.find((item) => item.id === track.id)
    const unavailable = libraryItem?.kind === "song" && !libraryItem.playback
    const title = `${track.title}${unavailable ? " [unavailable]" : ""}`
    row.box.visible = true
    setTrackRowContent(row, {
      title: renderer.terminalWidth < 64
        ? `${selected ? "›" : " "} ${title}${track.artist ? ` — ${track.artist}` : ""}`
        : `${selected ? "›" : " "} ${title}`,
      artist: track.artist,
      album: libraryItem && libraryItem.kind !== "song" ? "enter to open" : track.album,
      time: libraryItem && libraryItem.kind !== "song" ? "" : formatDuration(track.durationSeconds),
    })
    row.box.backgroundColor = selected ? theme.selection : theme.background
    setTrackRowColor(row, selected ? theme.text : theme.muted)
  })

  renderRightRail(view, model)
}

function renderRightRail(view: AppRenderables, model: AppViewModel): void {
  const destinations = [
    ["home", "Home", "g h"],
    ["library", "Library", "g l"],
    ["playlists", "Playlists", "g p"],
    ["radio", "Radio", "g r"],
    ["search", "Search", "g s"],
    ["queue", "Queue", "g q"],
  ] as const

  destinations.forEach(([destination, label, shortcut], index) => {
    const row = view.navigationRows[index]!
    const selected = model.state.destination === destination
    row.label.content = `${selected ? "›" : " "} ${label}`
    row.shortcut.content = shortcut
    row.box.backgroundColor = selected ? theme.selection : theme.background
    row.label.fg = selected ? theme.text : theme.muted
    row.shortcut.fg = selected ? theme.text : theme.muted
  })

  const currentTrack = model.player.currentTrack
  const queue = model.player.queue
  const source = model.player.source
  const sourceLabel = source?.type === "station"
    ? `${source.isLive ? "LIVE" : "RADIO"} ${source.title}`
    : ""
  const selectedQueueTrackId = model.state.lists.queue.selectedTrackId

  view.queueNowPlaying.content = currentTrack
    ? `NOW  ${currentTrack.title}`
    : ""
  view.queueNowPlaying.fg = currentTrack ? theme.text : theme.muted
  view.queueSummary.content = queue.length > 0
    ? `${currentTrack ? `${currentTrack.artist}  ·  ` : ""}${sourceLabel ? `${sourceLabel}  ·  ` : ""}${queue.length} up next`
    : currentTrack
      ? `${currentTrack.artist}  ·  ${sourceLabel || (model.player.dynamicQueue ? "radio continues" : "end of queue")}`
      : ""
  view.queueSummary.fg = theme.muted
  view.queueEmpty.visible = !currentTrack && queue.length === 0
  view.queueEmpty.content = view.queueEmpty.visible
    ? emptyMessage("queue", 0, model.player.dynamicQueue)
    : ""

  view.queueRows.forEach((row, index) => {
    const track = queue[index]
    if (!track || index >= maxQueueRows) {
      row.box.visible = false
      return
    }
    const selected = track.id === selectedQueueTrackId
    row.box.visible = true
    row.title.content = `${selected ? "›" : " "} ${track.title}`
    row.detail.content = track.artist
    row.box.backgroundColor = selected ? theme.selection : theme.background
    row.title.fg = selected ? theme.text : theme.muted
    row.detail.fg = selected ? theme.text : theme.muted
  })
}

function isExternalLiveStation(station: Station): boolean {
  return "apple" in station &&
    (station as AppleCatalogStation).apple.externalLiveStream === true
}

function restoreTrackRowLayout(
  row: AppRenderables["trackRows"][number],
  width: number,
  showYearColumn: boolean,
): void {
  row.year.visible = showYearColumn
  row.time.visible = true
  if (width < 64) {
    row.title.flexGrow = 1
    row.title.width = "auto"
    row.artist.visible = false
    row.album.visible = false
    return
  }
  if (width < 100) {
    row.title.flexGrow = 0
    row.title.width = "44%"
    row.artist.visible = true
    row.artist.flexGrow = 1
    row.artist.width = "auto"
    row.album.visible = false
    return
  }
  row.title.flexGrow = 0
  row.title.width = "32%"
  row.artist.visible = true
  row.artist.flexGrow = 0
  row.artist.width = "24%"
  row.album.visible = true
  row.album.flexGrow = 1
}
