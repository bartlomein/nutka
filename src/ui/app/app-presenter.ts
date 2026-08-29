import type { BoxRenderable, CliRenderer, TextRenderable } from "@opentui/core"

import type { AppState } from "../../core/state"
import type {
  AppleCatalogPlaylist,
  AppleCatalogStation,
  AppleHomeSection,
  ApplePlaylist,
  AudioSpectrumFrame,
  Station,
  Track,
} from "../../core/types"
import type { AppleAuthStatus } from "../../services/apple-auth"
import type { PlayerPanel, PlayerPanelState } from "../player"
import { theme } from "../theme"
import type { VisualizerSettings } from "../visualizer"
import { resolveVisualizerPalette } from "../visualizer/palettes"
import {
  visualizerPreviewBands,
  visualizerSettingRows,
  type VisualizerSettingsDialog,
} from "../visualizer/settings-view"
import { formatSpectrumFrame } from "../visualizer/spectrum"
import {
  appleStationResourceId,
  artistDisplayRows,
  artistPageStatusLine,
  artistRowContent,
  artistRowId,
  artistSelectableRows,
  browseAlbumEmptyMessage,
  browseFooterHelp,
  browsePageHasError,
  formatDuration,
  getRowStart,
  homeDisplayRows,
  isSelectableArtistRow,
  playlistDisplayRows,
  playlistLandingUnavailable,
  playlistLoading,
  playlistLoadingMore,
  type BrowsePage,
  type RadioDisplayRow,
} from "./browse"
import type { CatalogSearchState } from "./catalog-search-controller"
import type {
  ContextPickerState,
  SearchAlbumView,
} from "./catalog-browse-controller"
import type { Command } from "./commands"
import {
  albumEmptyMessage,
  albumFooterHelp,
  appleAuthProgressCopy,
  appleAuthStatusLabel,
  appleAuthSuccessCopy,
  compactAppleAuthStatusLabel,
  destinationLabel,
  emptyMessage,
  footerHelp,
  formatInfoTarget,
  homeFooterHelp,
  isAppleAuthProgress,
  playbackErrorMessage,
  playlistDetailFooterHelp,
  playlistEmptyMessage,
  playlistFooterHelp,
  playlistTrackEmptyMessage,
  pluralize,
  radioFooterHelp,
  searchEmptyMessage,
  searchFooterHelp,
  type InfoTarget,
} from "./copy"
import type { PlaylistView } from "./playlist-controller"
import {
  maxContextRows,
  maxPaletteRows,
  maxTrackRows,
  setTrackRowColor,
  setTrackRowContent,
  type PaletteRow,
  type TrackRow,
} from "./renderables"

interface LandingState {
  status: "idle" | "loading" | "loadingMore" | "ready" | "error"
  nextCursor: string | null
}

export interface AppViewModel {
  state: AppState
  appleAuthStatus: AppleAuthStatus
  authSuccessVisible: boolean
  baseTracks: readonly Track[]
  visibleTracks: readonly Track[]
  browsePage?: BrowsePage
  albumView?: SearchAlbumView
  playlistView?: PlaylistView
  homeSections: readonly AppleHomeSection[]
  favoriteStations: readonly AppleCatalogStation[]
  homeItems: readonly (AppleCatalogPlaylist | AppleCatalogStation)[]
  visibleHomeItems: readonly (AppleCatalogPlaylist | AppleCatalogStation)[]
  playlists: readonly ApplePlaylist[]
  visiblePlaylists: readonly ApplePlaylist[]
  landingState: LandingState
  radioRows: readonly RadioDisplayRow[]
  visibleStations: readonly Station[]
  favoriteStationIds: ReadonlySet<string>
  selectedStation?: AppleCatalogStation
  radioStatusLine: string
  radioHasMore: boolean
  radioFavoriteSaveError: boolean
  radioStationLikeError: boolean
  searchState: CatalogSearchState
  searchStatusLine: string
  contextPicker?: ContextPickerState
  infoTarget?: InfoTarget
  visualizerEnabled: boolean
  visualizerSettings: VisualizerSettings
  visualizerSettingsDialog?: VisualizerSettingsDialog
  player: PlayerPanelState
  currentSongLikeError: boolean
  paletteCommands: readonly Command[]
}

export interface AppView {
  render(model: AppViewModel): void
  resize(): void
  resetInfoScroll(): void
  scrollInfo(delta: number): void
  scrollInfoPage(delta: -1 | 1): void
  scrollInfoTo(edge: "start" | "end"): void
  renderAudioAnalysis(frame: AudioSpectrumFrame | null): void
  setVisualizerEnabled(enabled: boolean): void
  setVisualizerSettings(settings: VisualizerSettings): void
  destroy(): void
}

export interface AppRenderables {
  app: BoxRenderable
  header: BoxRenderable
  breadcrumb: TextRenderable
  providerStatus: TextRenderable
  workspace: BoxRenderable
  workspaceHeader: BoxRenderable
  workspaceTitle: TextRenderable
  workspaceCount: TextRenderable
  filterLine: TextRenderable
  tableHeader: TrackRow
  trackRows: readonly TrackRow[]
  player: PlayerPanel
  footer: BoxRenderable
  mode: TextRenderable
  keyHelp: TextRenderable
  destinationHint: TextRenderable
  paletteOverlay: BoxRenderable
  palettePopup: BoxRenderable
  paletteInput: TextRenderable
  paletteSummary: TextRenderable
  paletteRows: readonly PaletteRow[]
  contextOverlay: BoxRenderable
  contextPopup: BoxRenderable
  contextSummary: TextRenderable
  contextRows: readonly PaletteRow[]
  visualizerSettingsOverlay: BoxRenderable
  visualizerSettingsPopup: BoxRenderable
  visualizerSettingsSummary: TextRenderable
  visualizerSettingsRows: readonly PaletteRow[]
  visualizerSettingsPreview: TextRenderable
  helpOverlay: BoxRenderable
  helpPopup: BoxRenderable
  helpLines: readonly (readonly [string, string])[]
  helpTexts: readonly TextRenderable[]
  infoOverlay: BoxRenderable
  infoPopup: BoxRenderable
  infoBody: TextRenderable
  appleAuthOverlay: BoxRenderable
  appleAuthPopup: BoxRenderable
  authInstructions: readonly TextRenderable[]
}

export function createAppPresenter(
  renderer: CliRenderer,
  view: AppRenderables,
): AppView {
  function render(model: AppViewModel): void {
    const {
      state,
      appleAuthStatus,
      authSuccessVisible,
      baseTracks,
      browsePage: activeBrowsePage,
      albumView: activeAlbumView,
      playlistView: activePlaylistView,
      contextPicker,
      infoTarget,
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
      state.destination === "search" ||
      state.destination === "home" ||
      state.destination === "playlists" ||
      state.destination === "radio" ||
      state.mode.type === "search" ||
      Boolean(activeFilter)
    const compactHeight = renderer.terminalHeight < 21
    const activeVisualizerSettings = visualizerSettingsDialog?.draft ?? model.visualizerSettings
    const normalReservedRows = (showFilter ? 18 : 16) + (
      model.visualizerEnabled ? activeVisualizerSettings.height : 0
    )
    const destinationName = destinationLabel(state.destination)
    const showingAlbum = activeAlbumView !== undefined
    const showingPlaylist = activePlaylistView !== undefined

    view.breadcrumb.content = activeBrowsePage
      ? `nutka  /  ${activeBrowsePage.kind}`
      : showingPlaylist
      ? `nutka  /  ${activePlaylistView.sourceDestination}  /  playlist`
      : showingAlbum
      ? "nutka  /  search  /  album"
      : `nutka  /  ${destinationName.toLowerCase()}`
    view.workspaceTitle.content = activeBrowsePage
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
    view.workspaceCount.content = activeBrowsePage?.kind === "artist"
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
    view.filterLine.fg = activeBrowsePage && browsePageHasError(activeBrowsePage)
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
      activeBrowsePage?.kind === "artist"
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
      row.year.visible = showYearColumn
      if (rowIndex >= activeRowCount) {
        row.box.visible = false
        return
      }

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
            ? activeBrowsePage?.kind === "album"
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
        setTrackRowColor(row, theme.muted)
        return
      }

      const selected = track.id === selectedId
      row.box.visible = true
      setTrackRowContent(row, {
        title: renderer.terminalWidth < 64
          ? `${selected ? "›" : " "} ${track.title} — ${track.artist}`
          : `${selected ? "›" : " "} ${track.title}`,
        artist: track.artist,
        album: track.album,
        time: formatDuration(track.durationSeconds),
      })
      row.box.backgroundColor = selected ? theme.selection : theme.background
      setTrackRowColor(row, selected ? theme.text : theme.muted)
    })

    view.player.render(model.player)

    view.paletteOverlay.visible = state.mode.type === "palette"
    const paletteCommands = model.paletteCommands
    const paletteRowCount = Math.max(1, Math.min(maxPaletteRows, renderer.terminalHeight - 7))
    const paletteSelectedIndex = state.mode.type === "palette" ? state.mode.selectedIndex : 0
    const paletteRowStart = getRowStart(
      paletteSelectedIndex,
      paletteCommands.length,
      paletteRowCount,
    )
    view.palettePopup.height = paletteRowCount + 6
    view.paletteInput.content = `›  ${state.mode.type === "palette" ? state.mode.query : ""}_`
    view.paletteSummary.content = `${paletteCommands.length} ${pluralize("command", paletteCommands.length)}`
    view.paletteRows.forEach((row, index) => {
      if (index >= paletteRowCount) {
        row.box.visible = false
        return
      }
      const commandIndex = paletteRowStart + index
      const command = paletteCommands[commandIndex]
      if (!command) {
        row.box.visible = index === 0
        row.title.content = index === 0 ? "  no matching commands" : ""
        row.shortcut.content = ""
        row.box.backgroundColor = theme.surfaceRaised
        row.title.fg = theme.muted
        return
      }
      const selected = state.mode.type === "palette" && commandIndex === state.mode.selectedIndex
      row.box.visible = true
      row.box.backgroundColor = selected ? theme.selection : theme.surfaceRaised
      row.title.content = `${selected ? "›" : " "} ${command.title}${
        renderer.terminalWidth >= 80 ? ` · ${command.description}` : ""
      }`
      row.shortcut.content = command.shortcut
      row.title.fg = selected ? theme.text : theme.muted
      row.shortcut.fg = selected ? theme.accent : theme.muted
    })

    view.contextOverlay.visible = contextPicker !== undefined
    const contextRowCount = Math.max(
      1,
      Math.min(
        maxContextRows,
        contextPicker?.targets.length || 1,
        Math.max(1, renderer.terminalHeight - 6),
      ),
    )
    const contextRowStart = getRowStart(
      contextPicker?.selectedIndex ?? 0,
      contextPicker?.targets.length ?? 0,
      contextRowCount,
    )
    view.contextPopup.height = contextRowCount + 5
    view.contextSummary.content = contextPicker?.status === "loading"
      ? `◌  loading context for ${contextPicker.pinnedTrack.title}...`
      : contextPicker?.status === "error"
        ? "×  now-playing context is unavailable"
        : contextPicker?.targets.length
          ? `${contextPicker.pinnedTrack.title} · choose an action`
          : "No context actions found"
    view.contextSummary.fg = contextPicker?.status === "error" ? theme.amber : theme.muted
    view.contextRows.forEach((row, index) => {
      if (index >= contextRowCount) {
        row.box.visible = false
        return
      }
      const targetIndex = contextRowStart + index
      const target = contextPicker?.targets[targetIndex]
      if (!target) {
        row.box.visible = index === 0
        row.title.content = contextPicker?.status === "loading" ? "  please wait" : "  unavailable"
        row.shortcut.content = ""
        row.box.backgroundColor = theme.surfaceRaised
        row.title.fg = theme.muted
        return
      }
      const selected = targetIndex === contextPicker?.selectedIndex
      row.box.visible = true
      row.title.content = `${selected ? "›" : " "} ${
        target.kind === "album"
          ? target.album.title
          : target.kind === "artist"
            ? target.artist.name
            : target.kind === "station-song"
              ? "Start Station from This Song"
              : `Start Station from ${target.artist.name}`
      }`
      row.shortcut.content = target.kind.startsWith("station-") ? "radio" : target.kind
      row.box.backgroundColor = selected ? theme.selection : theme.surfaceRaised
      row.title.fg = selected ? theme.text : theme.muted
      row.shortcut.fg = selected ? theme.accent : theme.muted
    })

    view.visualizerSettingsOverlay.visible = visualizerSettingsDialog !== undefined
    if (visualizerSettingsDialog) {
      const draft = visualizerSettingsDialog.draft
      const controls = visualizerSettingRows(draft)
      view.visualizerSettingsSummary.content = visualizerSettingsDialog.error ??
        "←/→ change · preview updates immediately"
      view.visualizerSettingsSummary.fg = visualizerSettingsDialog.error ? theme.amber : theme.muted
      view.visualizerSettingsRows.forEach((row, index) => {
        const control = controls[index]!
        const selected = index === visualizerSettingsDialog.selectedIndex
        row.box.backgroundColor = selected ? theme.selection : theme.surfaceRaised
        row.title.content = `${selected ? "›" : " "} ${control.label}`
        row.shortcut.content = renderer.terminalWidth < 36 ? control.value : `‹ ${control.value} ›`
        row.title.fg = selected ? theme.text : theme.muted
        row.shortcut.fg = selected ? theme.accent : theme.muted
      })
      const summaryVisible = renderer.terminalHeight >= 9
      const previewVisible = renderer.terminalHeight >= 15
      const previewWidth = Math.max(8, Math.min(52, renderer.terminalWidth - 12))
      view.visualizerSettingsSummary.visible = summaryVisible
      view.visualizerSettingsPreview.visible = previewVisible
      view.visualizerSettingsPreview.height = draft.height
      view.visualizerSettingsPreview.content = previewVisible
        ? formatSpectrumFrame(
            visualizerPreviewBands,
            previewWidth,
            draft.height,
            resolveVisualizerPalette(draft.palette, theme),
            false,
            draft.style,
          )
        : ""
      view.visualizerSettingsPopup.height = Math.min(
        renderer.terminalHeight - 1,
        previewVisible ? 9 + draft.height : summaryVisible ? 9 : 6,
      )
    }

    view.helpOverlay.visible = state.mode.type === "help"
    const compactHelp = renderer.terminalHeight < 18
    const compactHelpLines = [
      "ctrl+p commands · g n now playing",
      "↑/↓ move · i info · f station favorite",
      "b/s/n previous · shuffle · next · r repeat · l like",
      "←/→ seek 5s · shift+←/→ 15s",
      "/ filter or Radio search · g s song search · m more · ? help",
    ]
    view.helpTexts.forEach((line, index) => {
      line.visible = compactHelp ? index < compactHelpLines.length : true
      line.content = compactHelp
        ? (compactHelpLines[index] ?? "")
        : (view.helpLines[index]?.[0] ?? "")
      line.fg = compactHelp
        ? index === 0
          ? theme.accent
          : theme.text
        : (view.helpLines[index]?.[1] ?? theme.text)
    })
    view.helpPopup.height = compactHelp ? 9 : 17

    view.infoOverlay.visible = infoTarget !== undefined
    if (infoTarget) {
      const content = formatInfoTarget(infoTarget)
      if (view.infoBody.plainText !== content) view.infoBody.content = content
      view.infoBody.scrollY = Math.min(view.infoBody.scrollY, view.infoBody.maxScrollY)
      view.infoPopup.title = ` ${infoTarget.kind} info `
    }

    view.appleAuthOverlay.visible = authSuccessVisible || isAppleAuthProgress(appleAuthStatus)
    view.appleAuthPopup.title = authSuccessVisible
      ? " apple music connected "
      : " apple music login "
    view.appleAuthPopup.bottomTitle = authSuccessVisible ? " enter continue " : " esc cancel "
    const authCopy = authSuccessVisible
      ? appleAuthSuccessCopy(appleAuthStatus)
      : appleAuthProgressCopy(appleAuthStatus)
    view.authInstructions.forEach((line, index) => {
      line.content = authCopy[index] ?? ""
      line.visible = Boolean(authCopy[index])
    })
    view.providerStatus.content = renderer.terminalWidth < 64
      ? compactAppleAuthStatusLabel(appleAuthStatus)
      : appleAuthStatusLabel(appleAuthStatus)

    view.mode.content = visualizerSettingsDialog
      ? "VISUAL"
      : contextPicker
      ? "CONTEXT"
      : infoTarget
      ? "INFO"
      : state.mode.type === "normal" && state.mode.pendingKey === "g"
        ? "GO TO"
        : state.mode.type.toUpperCase()
    view.keyHelp.content = authSuccessVisible
      ? renderer.terminalWidth < 64
        ? "connected  enter continue"
        : "Apple Music connected   enter continue"
      : isAppleAuthProgress(appleAuthStatus)
      ? renderer.terminalWidth < 64
        ? "apple login  esc cancel"
        : "Apple Music authorization in progress   esc cancel"
      : visualizerSettingsDialog
        ? renderer.terminalWidth < 64
          ? "j/k select  ←/→ change  enter apply"
          : "Visualizer settings   j/k select   ←/→ change   enter apply   esc cancel"
      : contextPicker
        ? renderer.terminalWidth < 64
          ? "j/k choose  enter open  esc cancel"
          : "Now playing context   j/k or ↑/↓ choose   enter open   esc cancel"
      : infoTarget
        ? renderer.terminalWidth < 64
          ? "j/k scroll  i/esc close"
          : "Item information   j/k or ↑/↓ scroll   i/esc close"
      : state.mode.type === "normal" && model.currentSongLikeError
        ? "Could not update favorite   l retry"
      : state.mode.type === "normal" && model.radioFavoriteSaveError
        ? "Could not update station favorite   f retry"
      : state.mode.type === "normal" && model.radioStationLikeError
        ? "Could not update Apple station like   ctrl+p retry"
      : activeBrowsePage && state.mode.type === "normal"
        ? browseFooterHelp(activeBrowsePage, renderer.terminalWidth)
      : showingPlaylist && state.mode.type === "normal"
        ? playlistDetailFooterHelp(activePlaylistView?.nextCursor !== null, renderer.terminalWidth)
      : homeLanding && state.mode.type === "normal"
        ? homeFooterHelp(
            landingState.nextCursor !== null,
            Boolean(model.selectedStation),
            Boolean(
              appleStationResourceId(model.selectedStation) &&
              model.favoriteStationIds.has(appleStationResourceId(model.selectedStation) ?? ""),
            ),
            model.selectedStation?.apple.externalLiveStream === true,
            renderer.terminalWidth,
          )
      : playlistLanding && state.mode.type === "normal"
        ? playlistFooterHelp(landingState.nextCursor !== null, renderer.terminalWidth, state.destination)
      : showingAlbum && state.mode.type === "normal"
        ? albumFooterHelp(renderer.terminalWidth)
      : radioLanding && state.mode.type === "normal"
        ? radioFooterHelp(
            model.radioHasMore,
            Boolean(model.selectedStation),
            Boolean(
              appleStationResourceId(model.selectedStation) &&
              model.favoriteStationIds.has(appleStationResourceId(model.selectedStation) ?? ""),
            ),
            model.selectedStation?.apple.externalLiveStream === true,
            renderer.terminalWidth,
          )
      : state.destination === "search" && state.mode.type === "normal"
        ? searchFooterHelp(model.searchState.nextCursor !== null, renderer.terminalWidth)
        : footerHelp(state, renderer.terminalWidth)
  }

  function resize(): void {
    const width = renderer.terminalWidth
    const compactHeight = renderer.terminalHeight < 21
    const compactAuth = renderer.terminalHeight < 14
    view.header.height = compactHeight ? 2 : 3
    view.header.paddingX = compactHeight ? 1 : 2
    view.workspace.padding = compactHeight ? 0 : 1
    view.workspaceHeader.height = compactHeight ? 1 : 2
    view.player.applyResponsiveLayout(width, compactHeight)
    view.footer.height = compactHeight ? 2 : 3
    view.footer.paddingX = compactHeight ? 1 : 2
    view.providerStatus.visible = width >= 40
    view.destinationHint.visible = width >= 100
    view.palettePopup.width = width >= 80 ? 72 : "94%"
    view.contextPopup.width = width >= 80 ? 72 : "94%"
    view.visualizerSettingsPopup.width = width >= 72 ? 64 : "94%"
    view.visualizerSettingsPopup.paddingY = renderer.terminalHeight >= 9 ? 1 : 0
    const visualizerValueWidth = Math.max(4, Math.min(22, Math.floor((width - 8) / 2)))
    for (const row of view.visualizerSettingsRows) row.shortcut.width = visualizerValueWidth
    view.helpPopup.width = width >= 80 ? 72 : "94%"
    view.infoPopup.width = width >= 90 ? 80 : "94%"
    view.infoPopup.height = Math.max(7, Math.min(22, renderer.terminalHeight - 1))
    view.appleAuthPopup.width = width >= 72 ? 64 : "94%"
    view.appleAuthPopup.height = compactAuth ? Math.max(7, renderer.terminalHeight - 1) : 12
    view.authInstructions[0]!.height = compactAuth ? 1 : 2
    view.authInstructions[2]!.height = compactAuth ? 1 : 2

    for (const row of [view.tableHeader, ...view.trackRows]) {
      if (width < 64) {
        row.title.flexGrow = 1
        row.title.width = "auto"
        row.artist.visible = false
        row.album.visible = false
      } else if (width < 100) {
        row.title.flexGrow = 0
        row.title.width = "44%"
        row.artist.visible = true
        row.artist.flexGrow = 1
        row.artist.width = "auto"
        row.album.visible = false
      } else {
        row.title.flexGrow = 0
        row.title.width = "32%"
        row.artist.visible = true
        row.artist.flexGrow = 0
        row.artist.width = "24%"
        row.album.visible = true
        row.album.flexGrow = 1
      }
    }
  }

  return {
    render,
    resize,
    resetInfoScroll: () => {
      view.infoBody.scrollY = 0
    },
    scrollInfo: (delta) => {
      view.infoBody.scrollY = Math.max(
        0,
        Math.min(view.infoBody.maxScrollY, view.infoBody.scrollY + delta),
      )
    },
    scrollInfoPage: (delta) => {
      const pageSize = Math.max(1, Math.min(12, renderer.terminalHeight - 8))
      view.infoBody.scrollY = Math.max(
        0,
        Math.min(view.infoBody.maxScrollY, view.infoBody.scrollY + delta * pageSize),
      )
    },
    scrollInfoTo: (edge) => {
      view.infoBody.scrollY = edge === "start" ? 0 : view.infoBody.maxScrollY
    },
    renderAudioAnalysis: (frame) => view.player.renderAudioAnalysis(frame),
    setVisualizerEnabled: (enabled) => view.player.setVisualizerEnabled(enabled),
    setVisualizerSettings: (settings) => view.player.setVisualizerSettings(settings),
    destroy: () => view.app.destroyRecursively(),
  }
}

function isExternalLiveStation(station: Station): boolean {
  return "apple" in station &&
    (station as AppleCatalogStation).apple.externalLiveStream === true
}
