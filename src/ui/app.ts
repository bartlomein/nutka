import {
  BoxRenderable,
  CliRenderEvents,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core"

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
  AppleCatalogTrack,
  AppleHomeSection,
  AppleLibraryPlaylist,
  ApplePlaylist,
  AppleSongContext,
  PlaybackController,
  PlaybackSnapshot,
  SearchOptions,
  SearchPage,
  Track,
} from "../core/types"
import type { AppleAuthStatus } from "../services/apple-auth"
import {
  appleSongResourceId,
  appendUniqueBrowseItems,
  appendUniqueHomeSections,
  appendUniquePlaylists,
  appendUniqueTracks,
  artistDisplayRows,
  artistPageStatusLine,
  artistRowContent,
  artistRowId,
  artistSections,
  artistSelectableRows,
  browseAlbumEmptyMessage,
  browseFooterHelp,
  browsePageHasError,
  browsePageTracks,
  createArtistSectionStates,
  filterPlaylistValues,
  formatDuration,
  getRowStart,
  isAppleCatalogTrack,
  isPlayableAppleTrack,
  isPlaylistLanding,
  isSelectableArtistRow,
  playlistDisplayRows,
  playlistLandingUnavailable,
  playlistLoading,
  playlistLoadingMore,
  type AlbumBrowsePage,
  type ArtistBrowsePage,
  type BrowsePage,
} from "./app/browse"
import { getPaletteCommands, type Command } from "./app/commands"
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
  isAppleAuthProgress,
  playbackErrorMessage,
  playlistDetailFooterHelp,
  playlistEmptyMessage,
  playlistFooterHelp,
  playlistTrackEmptyMessage,
  pluralize,
  searchEmptyMessage,
  searchFooterHelp,
  type InfoTarget,
} from "./app/copy"
import {
  createOverlay,
  createTrackRow,
  maxContextRows,
  maxPaletteRows,
  maxTrackRows,
  setTrackRowColor,
  setTrackRowContent,
  text,
  type PaletteRow,
  type TrackRow,
} from "./app/renderables"
import { createPlayerPanel } from "./player"
import { theme } from "./theme"
import type { VisualizerSettings } from "./visualizer"
import { resolveVisualizerPalette } from "./visualizer/palettes"
import { defaultVisualizerSettings } from "./visualizer/preferences"
import {
  cycleVisualizerSettings,
  visualizerPreviewBands,
  visualizerSettingCount,
  visualizerSettingRows,
  type VisualizerSettingsDialog,
} from "./visualizer/settings-view"
import { formatSpectrumFrame } from "./visualizer/spectrum"

export { formatDuration } from "./app/browse"

const maxPlaybackQueueTracks = 100
const maxPlaylistShufflePages = 4

interface NutkaAppOptions {
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

type ContextTarget =
  | { kind: "album"; album: AppleCatalogAlbumSummary }
  | { kind: "artist"; artist: AppleCatalogArtist }

interface ContextPickerState {
  status: "loading" | "ready" | "error"
  pinnedTrack: AppleCatalogTrack
  targets: readonly ContextTarget[]
  selectedIndex: number
}

interface SongLikeState {
  liked: boolean
  status: "loading" | "ready" | "saving" | "error"
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
  let searchTracks: readonly Track[] = []
  const trackRegistry = new Map(options.tracks.map((track) => [track.id, track]))
  let searchRequest: AbortController | undefined
  let searchGeneration = 0
  let albumRequest: AbortController | undefined
  let albumGeneration = 0
  let albumView: {
    status: "loading" | "ready" | "error"
    title: string
    sourceSelectedTrackId: string | null
    sourceFilter: string
    album?: AppleCatalogAlbum
  } | undefined
  let homeSections: readonly AppleHomeSection[] = []
  let libraryPlaylists: readonly AppleLibraryPlaylist[] = []
  let homeRequest: AbortController | undefined
  let homeGeneration = 0
  let libraryPlaylistRequest: AbortController | undefined
  let libraryPlaylistGeneration = 0
  let playlistTrackRequest: AbortController | undefined
  let playlistTrackGeneration = 0
  let randomPlaylistRequest: AbortController | undefined
  let randomPlaylistGeneration = 0
  let homeState: {
    status: "idle" | "loading" | "loadingMore" | "ready" | "error"
    nextCursor: string | null
  } = { status: "idle", nextCursor: null }
  let libraryPlaylistState: {
    status: "idle" | "loading" | "loadingMore" | "ready" | "error"
    nextCursor: string | null
  } = { status: "idle", nextCursor: null }
  let playlistView: {
    status: "loading" | "ready" | "loadingMore" | "error"
    playlist: ApplePlaylist
    tracks: readonly AppleCatalogTrack[]
    nextCursor: string | null
    sourceDestination: "home" | "playlists"
    sourceSelectedTrackId: string | null
    sourceFilter: string
  } | undefined
  let catalogSearch: {
    query: string
    status: "idle" | "loading" | "loadingMore" | "ready" | "error"
    nextCursor: string | null
  } = { query: "", status: "idle", nextCursor: null }
  let appleAuthStatus: AppleAuthStatus = options.onAppleSignIn
    ? { state: "signedOut" }
    : { state: "error", code: "service_unavailable" }
  let authSuccessVisible = false
  let pendingSeekSeconds: number | null = null
  let seekAnchorSeconds: number | null = null
  let seekRunning = false
  const songLikeStates = new Map<string, SongLikeState>()
  const songLikeRequests = new Set<AbortController>()
  let infoTarget: InfoTarget | undefined
  let visualizerEnabled = true
  let visualizerSettings = options.visualizerSettings ?? defaultVisualizerSettings
  let visualizerSettingsDialog: VisualizerSettingsDialog | undefined
  let contextGeneration = 0
  let contextRequest: AbortController | undefined
  let contextPicker: ContextPickerState | undefined
  let browseContextOrigin: ContextPickerState | undefined
  let browsePages: BrowsePage[] = []
  const browseRequests = new Set<AbortController>()

  const app = new BoxRenderable(renderer, {
    id: "app",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: theme.background,
  })

  const header = new BoxRenderable(renderer, {
    id: "header",
    width: "100%",
    height: 3,
    paddingX: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    border: ["bottom"],
    borderColor: theme.border,
    backgroundColor: theme.surface,
  })
  const breadcrumb = text(renderer, "breadcrumb", "nutka  /  home", theme.text)
  const providerStatus = text(
    renderer,
    "provider-status",
    "apple music  ○ signed out",
    theme.muted,
  )
  header.add(breadcrumb)
  header.add(providerStatus)

  const workspace = new BoxRenderable(renderer, {
    id: "workspace",
    width: "100%",
    flexGrow: 1,
    padding: 1,
    flexDirection: "column",
    overflow: "hidden",
  })

  const workspaceHeader = new BoxRenderable(renderer, {
    id: "workspace-header",
    width: "100%",
    height: 2,
    flexDirection: "row",
    justifyContent: "space-between",
  })
  const workspaceTitle = text(renderer, "workspace-title", "Home", theme.text)
  const workspaceCount = text(renderer, "workspace-count", "", theme.muted)
  workspaceHeader.add(workspaceTitle)
  workspaceHeader.add(workspaceCount)
  workspace.add(workspaceHeader)

  const filterLine = text(renderer, "filter-line", "", theme.text)
  filterLine.height = 2
  filterLine.visible = false
  workspace.add(filterLine)

  const tableHeader = createTrackRow(renderer, "table-header", theme.background)
  setTrackRowContent(tableHeader, {
    title: "track",
    artist: "artist",
    album: "album",
    time: "time",
  })
  setTrackRowColor(tableHeader, theme.muted)
  workspace.add(tableHeader.box)

  const trackRows = Array.from({ length: maxTrackRows }, (_, index) => {
    const row = createTrackRow(renderer, `track-${index}`, theme.background)
    workspace.add(row.box)
    return row
  })

  const player = createPlayerPanel(renderer, {
    onSeek: requestSeek,
    visualizer: visualizerSettings,
  })

  const footer = new BoxRenderable(renderer, {
    id: "footer",
    width: "100%",
    height: 3,
    paddingX: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    border: ["top"],
    borderColor: theme.border,
    backgroundColor: theme.surfaceRaised,
  })
  const mode = text(renderer, "mode", "NORMAL", theme.background, theme.accent)
  mode.width = 9
  const keyHelp = text(
    renderer,
    "key-help",
    "j/k move   / fuzzy filter   ctrl+p commands   ? help",
    theme.muted,
  )
  const destinationHint = text(renderer, "destination-hint", "g n/h/l/p/s/q", theme.amber)
  keyHelp.flexGrow = 1
  destinationHint.width = 13
  footer.add(mode)
  footer.add(keyHelp)
  footer.add(destinationHint)

  app.add(header)
  app.add(workspace)
  app.add(player.root)
  app.add(footer)

  const paletteOverlay = createOverlay(renderer, "palette-overlay", 20)
  const palettePopup = new BoxRenderable(renderer, {
    id: "palette-popup",
    width: 72,
    maxWidth: "94%",
    height: 14,
    paddingX: 1,
    flexDirection: "column",
    border: true,
    borderColor: theme.border,
    backgroundColor: theme.surfaceRaised,
    title: " commands ",
    titleColor: theme.accent,
    bottomTitle: " esc close ",
    bottomTitleAlignment: "right",
  })
  const paletteInput = text(renderer, "palette-input", "›  _", theme.text)
  paletteInput.height = 2
  const paletteSummary = text(
    renderer,
    "palette-summary",
    "go anywhere or run a command",
    theme.muted,
  )
  palettePopup.add(paletteInput)
  palettePopup.add(paletteSummary)
  const paletteRows: PaletteRow[] = Array.from(
    { length: maxPaletteRows },
    (_, index) => {
      const row = new BoxRenderable(renderer, {
        id: `palette-row-${index}`,
        width: "100%",
        height: 1,
        flexDirection: "row",
        justifyContent: "space-between",
        columnGap: 1,
      })
      const title = text(renderer, `palette-row-${index}-title`, "", theme.text)
      const shortcut = text(
        renderer,
        `palette-row-${index}-shortcut`,
        "",
        theme.muted,
      )
      title.flexGrow = 1
      shortcut.width = 9
      row.add(title)
      row.add(shortcut)
      palettePopup.add(row)
      return { box: row, title, shortcut }
    },
  )
  const paletteHelp = text(
    renderer,
    "palette-help",
    "↑/↓ navigate   enter run   ctrl+n/p navigate",
    theme.muted,
  )
  palettePopup.add(paletteHelp)
  paletteOverlay.add(palettePopup)
  app.add(paletteOverlay)

  const contextOverlay = createOverlay(renderer, "context-overlay", 25)
  const contextPopup = new BoxRenderable(renderer, {
    id: "context-popup",
    width: 72,
    maxWidth: "94%",
    height: 8,
    paddingX: 1,
    flexDirection: "column",
    border: true,
    borderColor: theme.border,
    backgroundColor: theme.surfaceRaised,
    title: " browse now playing ",
    titleColor: theme.accent,
    bottomTitle: " esc cancel ",
    bottomTitleAlignment: "right",
  })
  const contextSummary = text(
    renderer,
    "context-summary",
    "loading album and artists...",
    theme.muted,
  )
  contextSummary.height = 2
  contextPopup.add(contextSummary)
  const contextRows: PaletteRow[] = Array.from(
    { length: maxContextRows },
    (_, index) => {
      const row = new BoxRenderable(renderer, {
        id: `context-row-${index}`,
        width: "100%",
        height: 1,
        flexDirection: "row",
        justifyContent: "space-between",
        columnGap: 1,
      })
      const title = text(renderer, `context-row-${index}-title`, "", theme.text)
      const shortcut = text(renderer, `context-row-${index}-kind`, "", theme.muted)
      title.flexGrow = 1
      shortcut.width = 9
      row.add(title)
      row.add(shortcut)
      contextPopup.add(row)
      return { box: row, title, shortcut }
    },
  )
  contextOverlay.add(contextPopup)
  app.add(contextOverlay)

  const visualizerSettingsOverlay = createOverlay(renderer, "visualizer-settings-overlay", 30)
  const visualizerSettingsPopup = new BoxRenderable(renderer, {
    id: "visualizer-settings-popup",
    width: 64,
    maxWidth: "94%",
    height: 12,
    paddingX: 2,
    paddingY: 1,
    flexDirection: "column",
    border: true,
    borderColor: theme.border,
    backgroundColor: theme.surfaceRaised,
    title: " visualizer settings ",
    titleColor: theme.accent,
    bottomTitle: " enter apply  esc cancel ",
    bottomTitleAlignment: "right",
  })
  const visualizerSettingsSummary = text(
    renderer,
    "visualizer-settings-summary",
    "←/→ change · preview updates immediately",
    theme.muted,
  )
  visualizerSettingsPopup.add(visualizerSettingsSummary)
  const visualizerSettingsRows: PaletteRow[] = Array.from(
    { length: visualizerSettingCount },
    (_, index) => {
      const row = new BoxRenderable(renderer, {
        id: `visualizer-setting-${index}`,
        width: "100%",
        height: 1,
        flexDirection: "row",
        justifyContent: "space-between",
        columnGap: 1,
      })
      const title = text(renderer, `visualizer-setting-${index}-title`, "", theme.text)
      const shortcut = text(renderer, `visualizer-setting-${index}-value`, "", theme.accent)
      title.flexGrow = 1
      shortcut.width = 22
      row.add(title)
      row.add(shortcut)
      visualizerSettingsPopup.add(row)
      return { box: row, title, shortcut }
    },
  )
  const visualizerSettingsPreview = new TextRenderable(renderer, {
    id: "visualizer-settings-preview",
    content: "",
    width: "100%",
    height: visualizerSettings.height,
    truncate: true,
  })
  visualizerSettingsPopup.add(visualizerSettingsPreview)
  visualizerSettingsOverlay.add(visualizerSettingsPopup)
  app.add(visualizerSettingsOverlay)

  const helpOverlay = createOverlay(renderer, "help-overlay", 30)
  const helpPopup = new BoxRenderable(renderer, {
    id: "help-popup",
    width: 72,
    maxWidth: "94%",
    height: 17,
    paddingX: 2,
    flexDirection: "column",
    border: true,
    borderColor: theme.border,
    backgroundColor: theme.surfaceRaised,
    title: " keyboard help ",
    titleColor: theme.accent,
    bottomTitle: " ? or esc close ",
    bottomTitleAlignment: "right",
  })
  const helpLines = [
    ["GLOBAL", theme.accent],
    ["g n now playing   g h home   g l library", theme.text],
    ["g p playlists   g s search   g q queue", theme.text],
    ["ctrl+p commands   v visualizer   V settings   ? help   q quit", theme.text],
    ["", theme.text],
    ["LISTS", theme.accent],
    ["j/k or ↑/↓  move      enter  play or open", theme.text],
    ["b/s/n       previous / shuffle / next      r repeat   l like", theme.text],
    ["i           item info /      filter", theme.text],
    ["←/→         seek 5s   shift+←/→  seek 15s", theme.text],
    ["esc         back to Home or cancel pending g", theme.text],
    ["", theme.text],
    ["FILTER", theme.accent],
    ["type to narrow        ↑/↓  choose        enter  apply", theme.text],
    ["backspace edit        esc  cancel        ctrl+n/p  choose", theme.text],
  ] as const
  const helpTexts = helpLines.map(([content, color], index) => {
    const line = text(renderer, `help-${index}`, content, color)
    helpPopup.add(line)
    return line
  })
  helpOverlay.add(helpPopup)
  app.add(helpOverlay)

  const infoOverlay = createOverlay(renderer, "info-overlay", 35)
  const infoPopup = new BoxRenderable(renderer, {
    id: "info-popup",
    width: 80,
    maxWidth: "94%",
    height: 22,
    paddingX: 2,
    paddingY: 1,
    flexDirection: "column",
    overflow: "hidden",
    border: true,
    borderColor: theme.border,
    backgroundColor: theme.surfaceRaised,
    title: " item info ",
    titleColor: theme.accent,
    bottomTitle: " i/esc close  j/k scroll ",
    bottomTitleAlignment: "right",
  })
  const infoBody = new TextRenderable(renderer, {
    id: "info-body",
    content: "",
    width: "100%",
    flexGrow: 1,
    fg: theme.text,
    bg: theme.surfaceRaised,
    wrapMode: "word",
    truncate: false,
    selectable: true,
  })
  infoPopup.add(infoBody)
  infoOverlay.add(infoPopup)
  app.add(infoOverlay)

  const appleAuthOverlay = createOverlay(renderer, "apple-auth-overlay", 40)
  const appleAuthPopup = new BoxRenderable(renderer, {
    id: "apple-auth-popup",
    width: 64,
    maxWidth: "94%",
    height: 12,
    paddingX: 2,
    flexDirection: "column",
    border: true,
    borderColor: theme.border,
    backgroundColor: theme.surfaceRaised,
    title: " apple music login ",
    titleColor: theme.accent,
    bottomTitle: " esc cancel ",
    bottomTitleAlignment: "right",
  })
  const authInstructions = [
    text(renderer, "auth-step-1", "", theme.text),
    text(renderer, "auth-step-2", "", theme.muted),
    text(renderer, "auth-step-3", "", theme.accent),
    text(renderer, "auth-step-4", "", theme.text),
    text(renderer, "auth-step-5", "", theme.muted),
    text(renderer, "auth-step-6", "", theme.amber),
  ]
  authInstructions[0]!.height = 2
  authInstructions[2]!.height = 2
  for (const line of authInstructions) appleAuthPopup.add(line)
  appleAuthOverlay.add(appleAuthPopup)
  app.add(appleAuthOverlay)
  renderer.root.add(app)

  function dispatch(action: AppAction): void {
    state = reduceAppState(state, action)
    renderState()
  }

  function dispatchAll(actions: readonly AppAction[]): void {
    state = actions.reduce(reduceAppState, state)
    renderState()
  }

  function syncPlayback(snapshot: PlaybackSnapshot<AppleCatalogTrack>): void {
    const previousTrackId = state.playback.currentTrackId
    if (snapshot.currentTrack) trackRegistry.set(snapshot.currentTrack.id, snapshot.currentTrack)
    for (const track of snapshot.queue) trackRegistry.set(track.id, track)
    if (!snapshot.currentTrack || snapshot.currentTrack.id !== previousTrackId) {
      pendingSeekSeconds = null
      seekAnchorSeconds = null
      if (snapshot.currentTrack) void loadSongLike(snapshot.currentTrack)
    } else if (
      pendingSeekSeconds === null &&
      seekAnchorSeconds !== null &&
      Math.abs(snapshot.positionSeconds - seekAnchorSeconds) <= 2
    ) {
      seekAnchorSeconds = null
    }
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
    })
  }

  async function loadSongLike(track: AppleCatalogTrack): Promise<void> {
    const resourceId = track.apple.resourceId
    if (
      appleAuthStatus.state !== "signedIn" ||
      !options.onGetSongLiked ||
      songLikeStates.has(resourceId)
    ) {
      return
    }

    const controller = new AbortController()
    songLikeRequests.add(controller)
    songLikeStates.set(resourceId, { liked: false, status: "loading" })
    try {
      const liked = await options.onGetSongLiked(resourceId, { signal: controller.signal })
      if (controller.signal.aborted) return
      songLikeStates.set(resourceId, { liked, status: "ready" })
      renderState()
    } catch {
      if (controller.signal.aborted) {
        songLikeStates.delete(resourceId)
        return
      }
      songLikeStates.set(resourceId, { liked: false, status: "error" })
      renderState()
    } finally {
      songLikeRequests.delete(controller)
    }
  }

  async function toggleCurrentSongLiked(): Promise<void> {
    if (
      appleAuthStatus.state !== "signedIn" ||
      !options.onGetSongLiked ||
      !options.onSetSongLiked
    ) {
      return
    }
    const track = state.playback.currentTrackId
      ? trackRegistry.get(state.playback.currentTrackId)
      : undefined
    if (!isPlayableAppleTrack(track)) return

    const resourceId = track.apple.resourceId
    const current = songLikeStates.get(resourceId)
    if (!current) {
      void loadSongLike(track)
      renderState()
      return
    }
    if (current.status === "loading" || current.status === "saving") return

    const pending: SongLikeState = { liked: !current.liked, status: "saving" }
    const controller = new AbortController()
    songLikeRequests.add(controller)
    songLikeStates.set(resourceId, pending)
    renderState()
    try {
      await options.onSetSongLiked(resourceId, pending.liked, { signal: controller.signal })
      if (controller.signal.aborted || songLikeStates.get(resourceId) !== pending) return
      songLikeStates.set(resourceId, { liked: pending.liked, status: "ready" })
      renderState()
    } catch {
      if (controller.signal.aborted || songLikeStates.get(resourceId) !== pending) return
      songLikeStates.set(resourceId, { liked: current.liked, status: "error" })
      renderState()
    } finally {
      songLikeRequests.delete(controller)
    }
  }

  function canToggleCurrentSongLike(): boolean {
    if (
      appleAuthStatus.state !== "signedIn" ||
      !options.onGetSongLiked ||
      !options.onSetSongLiked
    ) {
      return false
    }
    const track = state.playback.currentTrackId
      ? trackRegistry.get(state.playback.currentTrackId)
      : undefined
    if (!isPlayableAppleTrack(track)) return false
    const like = songLikeStates.get(track.apple.resourceId)
    return like?.status === "ready" || like?.status === "error"
  }

  function seekDuration(): number | null {
    const track = state.playback.currentTrackId
      ? trackRegistry.get(state.playback.currentTrackId)
      : undefined
    const duration = state.playback.durationSeconds ?? track?.durationSeconds ?? null
    return duration !== null && Number.isFinite(duration) && duration > 0 ? duration : null
  }

  function requestSeek(positionSeconds: number): void {
    if (!options.playback || !state.playback.currentTrackId) return
    const duration = seekDuration()
    if (duration === null || !Number.isFinite(positionSeconds)) return
    const target = Math.max(0, Math.min(positionSeconds, duration))
    seekAnchorSeconds = target
    pendingSeekSeconds = target
    if (!seekRunning) void drainSeekRequests()
  }

  function seekBy(deltaSeconds: number): void {
    requestSeek((seekAnchorSeconds ?? state.playback.positionSeconds) + deltaSeconds)
  }

  function playPreviousTrack(): void {
    void options.playback?.previous().catch(() => {})
  }

  function playNextTrack(): void {
    void options.playback?.next().catch(() => {})
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
        ? trackRegistry.get(state.playback.currentTrackId)
        : undefined,
      ...state.playback.queueTrackIds.map((trackId) => trackRegistry.get(trackId)),
    ]
    return playbackTracks.filter(isPlayableAppleTrack)
  }

  function selectedLandingPlaylist(): ApplePlaylist | undefined {
    if (!isPlaylistLanding(state.destination) || playlistView) return undefined
    const selectedId = state.lists[state.destination].selectedTrackId
    return getVisiblePlaylists().find((playlist) => playlist.id === selectedId)
  }

  function playRandomTrack(): void {
    if (!options.playback) return
    if (selectedLandingPlaylist()) {
      void playSelectedPlaylistRandom()
      return
    }
    if (state.playback.currentTrackId && state.playback.canSetShuffleMode) {
      toggleShuffleMode()
      return
    }
    playTracksRandom(randomPlaybackTracks())
  }

  function playTracksRandom(tracks: readonly AppleCatalogTrack[]): void {
    if (!options.playback || tracks.length === 0) return
    const shuffled = [...tracks]
    for (let index = shuffled.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(Math.random() * (index + 1))
      const swapTrack = shuffled[index]!
      shuffled[index] = shuffled[swapIndex]!
      shuffled[swapIndex] = swapTrack
    }
    if (shuffled.length > 1 && shuffled[0]?.id === state.playback.currentTrackId) {
      const alternativeIndex = shuffled.findIndex(
        (track) => track.id !== state.playback.currentTrackId,
      )
      if (alternativeIndex > 0) {
        const currentTrack = shuffled[0]!
        shuffled[0] = shuffled[alternativeIndex]!
        shuffled[alternativeIndex] = currentTrack
      }
    }
    const selected = shuffled[0]
    if (!selected) return
    void options.playback.play(selected, shuffled.slice(1))
      .then(() => options.playback?.setShuffleMode("songs"))
      .catch(() => {})
  }

  function toggleShuffleMode(): void {
    if (!options.playback || !state.playback.canSetShuffleMode) return
    const mode = state.playback.shuffleMode === "songs" ? "off" : "songs"
    void options.playback.setShuffleMode(mode).catch(() => {})
  }

  function cycleRepeatMode(): void {
    if (!options.playback || !state.playback.canSetRepeatMode) return
    const mode = state.playback.repeatMode === "none"
      ? "all"
      : state.playback.repeatMode === "all"
        ? "one"
        : "none"
    void options.playback.setRepeatMode(mode).catch(() => {})
  }

  async function playSelectedPlaylistRandom(): Promise<void> {
    const playlist = selectedLandingPlaylist()
    if (!playlist || !options.playback || !options.onGetPlaylistTracks) return

    const generation = ++randomPlaylistGeneration
    randomPlaylistRequest?.abort()
    const controller = new AbortController()
    randomPlaylistRequest = controller
    let tracks: readonly AppleCatalogTrack[] = []
    let cursor: string | undefined
    try {
      for (let pageNumber = 0; pageNumber < maxPlaylistShufflePages; pageNumber++) {
        const page = await options.onGetPlaylistTracks(playlist, {
          ...(cursor ? { cursor } : {}),
          signal: controller.signal,
        })
        if (controller.signal.aborted || generation !== randomPlaylistGeneration) return
        tracks = appendUniqueTracks(tracks, page.items).slice(0, maxPlaybackQueueTracks)
        cursor = page.nextCursor ?? undefined
        if (!cursor || tracks.length === maxPlaybackQueueTracks) break
      }
      playTracksRandom(tracks.filter(isPlayableAppleTrack))
    } catch {
      // Playback remains unchanged when playlist tracks cannot be loaded.
    } finally {
      if (randomPlaylistRequest === controller) randomPlaylistRequest = undefined
    }
  }

  async function drainSeekRequests(): Promise<void> {
    if (!options.playback || seekRunning) return
    seekRunning = true
    try {
      while (pendingSeekSeconds !== null) {
        const target = pendingSeekSeconds
        pendingSeekSeconds = null
        try {
          await options.playback.seek(target)
        } catch {
          if (pendingSeekSeconds === null) seekAnchorSeconds = null
        }
      }
    } finally {
      seekRunning = false
    }
  }

  function isPlaybackTrack(trackId: string): boolean {
    return (
      state.playback.currentTrackId === trackId ||
      state.playback.queueTrackIds.includes(trackId)
    )
  }

  function getBaseTracks(destination = state.destination): readonly Track[] {
    if (destination === "library") return libraryTracks
    if (destination === "search") {
      return albumView?.status === "ready" ? albumView.album!.tracks : albumView ? [] : searchTracks
    }
    if (destination === "home" || destination === "playlists") {
      return playlistView?.status === "ready" || playlistView?.status === "loadingMore"
        ? playlistView.tracks
        : []
    }

    return state.playback.queueTrackIds
      .map((id) => trackRegistry.get(id))
      .filter((track): track is Track => Boolean(track))
  }

  function getVisibleTracks(): readonly Track[] {
    const list = state.lists[state.destination]
    const query = state.mode.type === "filter" ? state.mode.draft : list.filter
    return filterTracks(getBaseTracks(), query)
  }

  function getPlaylists(destination = state.destination): readonly ApplePlaylist[] {
    if (destination === "home") {
      return homeSections.flatMap((section) => section.items)
    }
    return destination === "playlists" ? libraryPlaylists : []
  }

  function getVisiblePlaylists(): readonly ApplePlaylist[] {
    const query = state.mode.type === "filter"
      ? state.mode.draft
      : state.lists[state.destination].filter
    return filterPlaylistValues(getPlaylists(), query)
  }

  function getVisibleItemIds(): readonly string[] {
    return isPlaylistLanding(state.destination) && !playlistView
      ? getVisiblePlaylists().map((playlist) => playlist.id)
      : getVisibleTracks().map((track) => track.id)
  }

  function selectedInfoTarget(): InfoTarget | undefined {
    const selectedId = state.lists[state.destination].selectedTrackId
    if (isPlaylistLanding(state.destination) && !playlistView) {
      const playlist = getVisiblePlaylists().find((item) => item.id === selectedId)
      return playlist ? { kind: "playlist", playlist } : undefined
    }

    const track = getVisibleTracks().find((item) => item.id === selectedId)
    if (track) {
      return {
        kind: "track",
        track,
        ...(albumView?.album ? { album: albumView.album } : {}),
        ...(playlistView ? { playlist: playlistView.playlist } : {}),
      }
    }
    if (albumView?.album) return { kind: "album", album: albumView.album }
    if (playlistView) return { kind: "playlist", playlist: playlistView.playlist }
    return undefined
  }

  function canOpenSelectedInfo(): boolean {
    return !currentBrowsePage() && selectedInfoTarget() !== undefined
  }

  function openSelectedInfo(): void {
    const target = selectedInfoTarget()
    if (!target) return
    infoTarget = target
    infoBody.scrollY = 0
    renderState()
  }

  function closeInfo(): void {
    if (!infoTarget) return
    infoTarget = undefined
    infoBody.scrollY = 0
    renderState()
  }

  function scrollInfo(delta: number): void {
    infoBody.scrollY = Math.max(
      0,
      Math.min(infoBody.maxScrollY, infoBody.scrollY + delta),
    )
  }

  function currentBrowsePage(): BrowsePage | undefined {
    return browsePages.at(-1)
  }

  function canBrowseNowPlaying(): boolean {
    if (
      !options.onGetSongContext ||
      !options.onGetAlbum ||
      !options.onGetArtistSection ||
      !state.playback.currentTrackId
    ) {
      return false
    }
    return appleSongResourceId(
      trackRegistry.get(state.playback.currentTrackId),
    ) !== null
  }

  async function openNowPlayingContext(): Promise<void> {
    if (!canBrowseNowPlaying() || !options.onGetSongContext) return
    const track = trackRegistry.get(state.playback.currentTrackId!)
    const songResourceId = appleSongResourceId(track)
    if (!track || !songResourceId) return

    const generation = ++contextGeneration
    contextRequest?.abort()
    const controller = new AbortController()
    contextRequest = controller
    state = reduceAppState(state, { type: "close-mode" })
    contextPicker = {
      status: "loading",
      pinnedTrack: track as AppleCatalogTrack,
      targets: [],
      selectedIndex: 0,
    }
    renderState()
    try {
      const context = await options.onGetSongContext(songResourceId, {
        signal: controller.signal,
      })
      if (
        controller.signal.aborted ||
        generation !== contextGeneration ||
        !contextPicker
      ) {
        return
      }
      contextPicker = {
        ...contextPicker,
        status: "ready",
        targets: [
          ...context.albums.map((album): ContextTarget => ({ kind: "album", album })),
          ...context.artists.map((artist): ContextTarget => ({ kind: "artist", artist })),
        ],
        selectedIndex: 0,
      }
      renderState()
    } catch {
      if (
        controller.signal.aborted ||
        generation !== contextGeneration ||
        !contextPicker
      ) {
        return
      }
      contextPicker = { ...contextPicker, status: "error", targets: [] }
      renderState()
    } finally {
      if (contextRequest === controller) contextRequest = undefined
    }
  }

  function closeContextPicker(): void {
    if (!contextPicker) return
    contextGeneration++
    contextRequest?.abort()
    contextRequest = undefined
    contextPicker = undefined
    renderState()
  }

  function chooseContextTarget(): void {
    const picker = contextPicker
    const target = picker?.targets[picker.selectedIndex]
    if (!picker || picker.status !== "ready" || !target) return
    contextPicker = undefined
    closeBrowseSession(false)
    browseContextOrigin = picker
    if (target.kind === "album") {
      void openBrowseAlbum(target.album, picker.pinnedTrack.apple.resourceId)
    } else {
      openBrowseArtist(target.artist)
    }
  }

  function closeBrowseSession(render = true): void {
    for (const request of browseRequests) request.abort()
    browseRequests.clear()
    const tracks = browsePages.flatMap(browsePageTracks)
    browsePages = []
    browseContextOrigin = undefined
    unregisterBrowseTracks(tracks)
    if (render) renderState()
  }

  function popBrowsePage(): boolean {
    const page = browsePages.pop()
    if (!page) return false
    for (const request of page.requests) {
      request.abort()
      browseRequests.delete(request)
    }
    page.requests.clear()
    unregisterBrowseTracks(browsePageTracks(page))
    if (browsePages.length === 0 && browseContextOrigin) {
      contextPicker = browseContextOrigin
      browseContextOrigin = undefined
    }
    renderState()
    return true
  }

  function unregisterBrowseTracks(tracks: readonly AppleCatalogTrack[]): void {
    const retainedBrowseIds = new Set(browsePages.flatMap(browsePageTracks).map((item) => item.id))
    for (const track of tracks) {
      if (
        retainedBrowseIds.has(track.id) ||
        libraryTracks.some((item) => item.id === track.id) ||
        searchTracks.some((item) => item.id === track.id) ||
        albumView?.album?.tracks.some((item) => item.id === track.id) ||
        playlistView?.tracks.some((item) => item.id === track.id) ||
        isPlaybackTrack(track.id)
      ) {
        continue
      }
      trackRegistry.delete(track.id)
    }
  }

  function openBrowseArtist(artist: AppleCatalogArtist): void {
    const page: ArtistBrowsePage = {
      kind: "artist",
      artist,
      sections: createArtistSectionStates(),
      selectedId: null,
      selectionTouched: false,
      requests: new Set(),
    }
    browsePages.push(page)
    renderState()
    for (const section of artistSections) {
      void loadArtistSection(page, section.name)
    }
  }

  async function loadArtistSection(
    page: ArtistBrowsePage,
    section: AppleArtistSectionName,
    cursor?: string,
  ): Promise<void> {
    if (!options.onGetArtistSection || !browsePages.includes(page)) return
    const controller = new AbortController()
    browseRequests.add(controller)
    page.requests.add(controller)
    page.sections[section] = {
      ...page.sections[section],
      status: cursor ? "loadingMore" : "loading",
    }
    renderState()
    try {
      const result = await options.onGetArtistSection(
        page.artist.apple.resourceId,
        section,
        { ...(cursor ? { cursor } : {}), signal: controller.signal },
      )
      if (
        controller.signal.aborted ||
        !browsePages.includes(page)
      ) {
        return
      }
      if (result.section !== section) throw new Error("Artist section mismatch")
      const items = appendUniqueBrowseItems(
        cursor ? page.sections[section].items : [],
        result.items,
      )
      for (const item of items) {
        if (isAppleCatalogTrack(item)) trackRegistry.set(item.id, item)
      }
      page.sections[section] = {
        status: "ready",
        items,
        nextCursor: result.nextCursor,
      }
      reconcileBrowseSelection(page)
      renderState()
    } catch {
      if (controller.signal.aborted || !browsePages.includes(page)) return
      page.sections[section] = {
        ...page.sections[section],
        status: cursor ? "ready" : "error",
        nextCursor: cursor ?? null,
      }
      reconcileBrowseSelection(page)
      renderState()
    } finally {
      browseRequests.delete(controller)
      page.requests.delete(controller)
    }
  }

  async function openBrowseAlbum(
    summary: AppleCatalogAlbumSummary,
    preferredSongResourceId?: string,
  ): Promise<void> {
    if (!options.onGetAlbum) return
    const page: AlbumBrowsePage = {
      kind: "album",
      summary,
      status: "loading",
      selectedId: null,
      requests: new Set(),
      ...(preferredSongResourceId ? { preferredSongResourceId } : {}),
    }
    browsePages.push(page)
    renderState()
    const controller = new AbortController()
    browseRequests.add(controller)
    page.requests.add(controller)
    try {
      const album = await options.onGetAlbum(summary.apple.resourceId, {
        signal: controller.signal,
      })
      if (controller.signal.aborted || !browsePages.includes(page)) return
      for (const track of album.tracks) trackRegistry.set(track.id, track)
      page.status = "ready"
      page.album = album
      page.selectedId = album.tracks.find(
        (track) => track.apple.resourceId === preferredSongResourceId,
      )?.id ?? album.tracks[0]?.id ?? null
      renderState()
    } catch {
      if (controller.signal.aborted || !browsePages.includes(page)) return
      page.status = "error"
      renderState()
    } finally {
      browseRequests.delete(controller)
      page.requests.delete(controller)
    }
  }

  function reconcileBrowseSelection(page: ArtistBrowsePage): void {
    const ids = artistSelectableRows(page).map(artistRowId)
    if (!page.selectionTouched || !ids.includes(page.selectedId ?? "")) {
      page.selectedId = ids[0] ?? null
    }
  }

  function moveBrowseSelection(delta: number): void {
    const page = currentBrowsePage()
    if (!page) return
    const ids = page.kind === "artist"
      ? artistSelectableRows(page).map(artistRowId)
      : (page.album?.tracks.map((track) => track.id) ?? [])
    if (ids.length === 0) return
    const selectedIndex = ids.indexOf(page.selectedId ?? "")
    const nextIndex = selectedIndex < 0
      ? delta < 0 ? ids.length - 1 : 0
      : Math.min(ids.length - 1, Math.max(0, selectedIndex + delta))
    page.selectedId = ids[nextIndex] ?? null
    if (page.kind === "artist") page.selectionTouched = true
    renderState()
  }

  function openSelectedBrowseItem(): void {
    const page = currentBrowsePage()
    if (!page) return
    if (page.kind === "artist") page.selectionTouched = true
    if (page.kind === "album") {
      const tracks = page.album?.tracks ?? []
      const selectedIndex = tracks.findIndex((track) => track.id === page.selectedId)
      const track = tracks[selectedIndex]
      if (options.playback && isPlayableAppleTrack(track)) {
        void options.playback.play(
          track,
          tracks.slice(selectedIndex + 1).filter(isPlayableAppleTrack),
        ).catch(() => {})
      }
      return
    }
    const row = artistSelectableRows(page).find((item) => artistRowId(item) === page.selectedId)
    if (!row) return
    if (row.kind === "album") {
      void openBrowseAlbum(row.album)
      return
    }
    if (row.kind === "artist") {
      openBrowseArtist(row.artist)
      return
    }
    const topSongs = page.sections["top-songs"].items.filter(isAppleCatalogTrack)
    const selectedIndex = topSongs.findIndex((track) => track.id === row.track.id)
    if (options.playback && isPlayableAppleTrack(row.track)) {
      void options.playback.play(
        row.track,
        topSongs.slice(selectedIndex + 1).filter(isPlayableAppleTrack),
      ).catch(() => {})
    }
  }

  function loadMoreSelectedArtistSection(): void {
    const page = currentBrowsePage()
    if (page?.kind !== "artist") return
    const row = artistSelectableRows(page).find((item) => artistRowId(item) === page.selectedId)
    if (!row) return
    page.selectionTouched = true
    const state = page.sections[row.section]
    if (state.status === "loading" || state.status === "loadingMore") return
    const cursor = state.nextCursor
    if (cursor) void loadArtistSection(page, row.section, cursor)
  }

  function canOpenSelectedAlbum(): boolean {
    if (
      currentBrowsePage() ||
      state.destination !== "search" ||
      albumView ||
      !options.onGetAlbumForSong
    ) return false
    const selectedId = state.lists.search.selectedTrackId
    return appleSongResourceId(searchTracks.find((track) => track.id === selectedId)) !== null
  }

  function leaveAlbumView(): void {
    if (!albumView) return
    albumGeneration++
    albumRequest?.abort()
    albumRequest = undefined
    const { sourceFilter, sourceSelectedTrackId } = albumView
    for (const track of albumView.album?.tracks ?? []) {
      if (
        !libraryTracks.some((libraryTrack) => libraryTrack.id === track.id) &&
        !searchTracks.some((searchTrack) => searchTrack.id === track.id) &&
        !isPlaybackTrack(track.id)
      ) {
        trackRegistry.delete(track.id)
      }
    }
    albumView = undefined
    state = {
      ...state,
      mode: { type: "normal", pendingKey: null },
      lists: {
        ...state.lists,
        search: {
          filter: sourceFilter,
          selectedTrackId: sourceSelectedTrackId,
        },
      },
    }
  }

  async function openSelectedAlbum(): Promise<void> {
    if (albumView || !options.onGetAlbumForSong) return
    const selectedId = state.lists[state.destination].selectedTrackId
    const selectedTrack = getVisibleTracks().find((track) => track.id === selectedId)
    const songResourceId = appleSongResourceId(selectedTrack)
    if (!selectedTrack || !songResourceId) return

    const generation = ++albumGeneration
    albumRequest?.abort()
    const controller = new AbortController()
    albumRequest = controller
    albumView = {
      status: "loading",
      title: selectedTrack.album,
      sourceSelectedTrackId: state.lists.search.selectedTrackId,
      sourceFilter: state.lists.search.filter,
    }
    state = reduceAppState(state, { type: "close-mode" })
    state = reduceAppState(state, {
      type: "reset-list",
      destination: "search",
      selectedTrackId: null,
    })
    renderState()

    try {
      const album = await options.onGetAlbumForSong(songResourceId, {
        signal: controller.signal,
      })
      if (controller.signal.aborted || generation !== albumGeneration || !albumView) return
      for (const track of album.tracks) trackRegistry.set(track.id, track)
      albumView = { ...albumView, status: "ready", title: album.title, album }
      state = reduceAppState(state, {
        type: "reset-list",
        destination: "search",
        selectedTrackId: album.tracks[0]?.id ?? null,
      })
      renderState()
    } catch {
      if (controller.signal.aborted || generation !== albumGeneration || !albumView) return
      albumView = { ...albumView, status: "error" }
      renderState()
    } finally {
      if (albumRequest === controller) albumRequest = undefined
    }
  }

  async function loadPlaylistLanding(destination = state.destination): Promise<void> {
    if (destination === "home") {
      if (homeState.status === "idle" || homeState.status === "error") {
        await loadHomeSections()
      }
      return
    }
    if (
      destination === "playlists" &&
      (libraryPlaylistState.status === "idle" || libraryPlaylistState.status === "error")
    ) {
      await loadLibraryPlaylists()
    }
  }

  async function loadHomeSections(cursor?: string): Promise<void> {
    if (!options.onGetHomeSections) {
      homeState = { status: "error", nextCursor: null }
      renderState()
      return
    }
    const generation = ++homeGeneration
    homeRequest?.abort()
    const controller = new AbortController()
    homeRequest = controller
    homeState = {
      ...homeState,
      status: cursor ? "loadingMore" : "loading",
    }
    if (!cursor) homeSections = []
    renderState()
    try {
      const page = await options.onGetHomeSections({
        ...(cursor ? { cursor } : {}),
        signal: controller.signal,
      })
      if (controller.signal.aborted || generation !== homeGeneration) return
      homeSections = appendUniqueHomeSections(homeSections, page.items)
      homeState = { status: "ready", nextCursor: page.nextCursor }
      reconcilePlaylistSelection()
    } catch {
      if (controller.signal.aborted || generation !== homeGeneration) return
      homeState = {
        status: cursor ? "ready" : "error",
        nextCursor: cursor ?? null,
      }
      renderState()
    } finally {
      if (homeRequest === controller) homeRequest = undefined
    }
  }

  async function loadLibraryPlaylists(cursor?: string): Promise<void> {
    if (!options.onGetLibraryPlaylists) {
      libraryPlaylistState = { status: "error", nextCursor: null }
      renderState()
      return
    }
    const generation = ++libraryPlaylistGeneration
    libraryPlaylistRequest?.abort()
    const controller = new AbortController()
    libraryPlaylistRequest = controller
    libraryPlaylistState = {
      ...libraryPlaylistState,
      status: cursor ? "loadingMore" : "loading",
    }
    if (!cursor) libraryPlaylists = []
    renderState()
    try {
      const page = await options.onGetLibraryPlaylists({
        ...(cursor ? { cursor } : {}),
        signal: controller.signal,
      })
      if (controller.signal.aborted || generation !== libraryPlaylistGeneration) return
      libraryPlaylists = appendUniquePlaylists(libraryPlaylists, page.items)
      libraryPlaylistState = { status: "ready", nextCursor: page.nextCursor }
      reconcilePlaylistSelection()
    } catch {
      if (controller.signal.aborted || generation !== libraryPlaylistGeneration) return
      libraryPlaylistState = {
        status: cursor ? "ready" : "error",
        nextCursor: cursor ?? null,
      }
      renderState()
    } finally {
      if (libraryPlaylistRequest === controller) libraryPlaylistRequest = undefined
    }
  }

  function reconcilePlaylistSelection(): void {
    if (!isPlaylistLanding(state.destination) || playlistView) {
      renderState()
      return
    }
    const visible = getVisiblePlaylists()
    const selectedId = state.lists[state.destination].selectedTrackId
    if (!visible.some((playlist) => playlist.id === selectedId)) {
      state = reduceAppState(state, {
        type: "select-track",
        trackId: visible[0]?.id ?? null,
      })
    }
    renderState()
  }

  async function loadMorePlaylists(): Promise<void> {
    if (state.destination === "home") {
      if (homeState.nextCursor) await loadHomeSections(homeState.nextCursor)
      return
    }
    if (state.destination === "playlists" && libraryPlaylistState.nextCursor) {
      await loadLibraryPlaylists(libraryPlaylistState.nextCursor)
    }
  }

  async function openSelectedPlaylist(): Promise<void> {
    if (!isPlaylistLanding(state.destination) || playlistView || !options.onGetPlaylistTracks) {
      return
    }
    const sourceDestination = state.destination
    const selectedId = state.lists[sourceDestination].selectedTrackId
    const playlist = getVisiblePlaylists().find((item) => item.id === selectedId)
    if (!playlist) return

    const generation = ++playlistTrackGeneration
    playlistTrackRequest?.abort()
    const controller = new AbortController()
    playlistTrackRequest = controller
    playlistView = {
      status: "loading",
      playlist,
      tracks: [],
      nextCursor: null,
      sourceDestination,
      sourceSelectedTrackId: selectedId,
      sourceFilter: state.lists[sourceDestination].filter,
    }
    state = reduceAppState(state, { type: "close-mode" })
    state = reduceAppState(state, {
      type: "reset-list",
      destination: sourceDestination,
      selectedTrackId: null,
    })
    renderState()
    try {
      const page = await options.onGetPlaylistTracks(playlist, {
        signal: controller.signal,
      })
      if (controller.signal.aborted || generation !== playlistTrackGeneration || !playlistView) {
        return
      }
      for (const track of page.items) trackRegistry.set(track.id, track)
      playlistView = {
        ...playlistView,
        status: "ready",
        tracks: page.items,
        nextCursor: page.nextCursor,
      }
      state = reduceAppState(state, {
        type: "reset-list",
        destination: sourceDestination,
        selectedTrackId: page.items[0]?.id ?? null,
      })
      renderState()
    } catch {
      if (controller.signal.aborted || generation !== playlistTrackGeneration || !playlistView) {
        return
      }
      playlistView = { ...playlistView, status: "error" }
      renderState()
    } finally {
      if (playlistTrackRequest === controller) playlistTrackRequest = undefined
    }
  }

  async function loadMorePlaylistTracks(): Promise<void> {
    const view = playlistView
    if (!view?.nextCursor || !options.onGetPlaylistTracks || view.status === "loadingMore") return
    const generation = ++playlistTrackGeneration
    playlistTrackRequest?.abort()
    const controller = new AbortController()
    playlistTrackRequest = controller
    playlistView = { ...view, status: "loadingMore" }
    renderState()
    try {
      const page = await options.onGetPlaylistTracks(view.playlist, {
        cursor: view.nextCursor,
        signal: controller.signal,
      })
      if (controller.signal.aborted || generation !== playlistTrackGeneration || !playlistView) {
        return
      }
      const tracks = appendUniqueTracks(playlistView.tracks, page.items)
      for (const track of page.items) trackRegistry.set(track.id, track)
      playlistView = {
        ...playlistView,
        status: "ready",
        tracks,
        nextCursor: page.nextCursor,
      }
      renderState()
    } catch {
      if (controller.signal.aborted || generation !== playlistTrackGeneration || !playlistView) {
        return
      }
      playlistView = { ...playlistView, status: "ready" }
      renderState()
    } finally {
      if (playlistTrackRequest === controller) playlistTrackRequest = undefined
    }
  }

  function leavePlaylistView(): void {
    if (!playlistView) return
    playlistTrackGeneration++
    playlistTrackRequest?.abort()
    playlistTrackRequest = undefined
    const view = playlistView
    for (const track of view.tracks) {
      if (
        !libraryTracks.some((item) => item.id === track.id) &&
        !searchTracks.some((item) => item.id === track.id) &&
        !isPlaybackTrack(track.id)
      ) {
        trackRegistry.delete(track.id)
      }
    }
    playlistView = undefined
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
  }

  function navigateTo(destination: Destination): void {
    const reopenSearch = destination === "search" && state.destination === "search"
    closeBrowseSession(false)
    leaveAlbumView()
    leavePlaylistView()
    const baseItems = isPlaylistLanding(destination)
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
    if (destination === "search" && (!catalogSearch.query || reopenSearch)) {
      actions.push({ type: "open-search", query: catalogSearch.query })
    }
    dispatchAll(actions)
    if (isPlaylistLanding(destination) && appleAuthStatus.state === "signedIn") {
      void loadPlaylistLanding(destination)
    }
  }

  async function submitCatalogSearch(query: string): Promise<void> {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return
    if (!options.onSearchSongs) {
      catalogSearch = {
        query: normalizedQuery,
        status: "error",
        nextCursor: null,
      }
      dispatch({ type: "close-mode" })
      return
    }

    const generation = ++searchGeneration
    searchRequest?.abort()
    const controller = new AbortController()
    searchRequest = controller
    catalogSearch = {
      query: normalizedQuery,
      status: "loading",
      nextCursor: null,
    }
    searchTracks = []
    for (const trackId of trackRegistry.keys()) {
      if (!libraryTracks.some((track) => track.id === trackId) && !isPlaybackTrack(trackId)) {
        trackRegistry.delete(trackId)
      }
    }
    dispatchAll([
      { type: "close-mode" },
      { type: "reset-list", destination: "search", selectedTrackId: null },
    ])

    try {
      const page = await options.onSearchSongs(normalizedQuery, {
        signal: controller.signal,
      })
      if (controller.signal.aborted || generation !== searchGeneration) return
      searchTracks = [...page.items]
      for (const track of page.items) trackRegistry.set(track.id, track)
      catalogSearch = {
        query: normalizedQuery,
        status: "ready",
        nextCursor: page.nextCursor,
      }
      dispatch({
        type: "reset-list",
        destination: "search",
        selectedTrackId: searchTracks[0]?.id ?? null,
      })
    } catch {
      if (controller.signal.aborted || generation !== searchGeneration) return
      catalogSearch = {
        query: normalizedQuery,
        status: "error",
        nextCursor: null,
      }
      renderState()
    } finally {
      if (searchRequest === controller) searchRequest = undefined
    }
  }

  async function loadMoreCatalogSearch(): Promise<void> {
    const cursor = catalogSearch.nextCursor
    if (!cursor || !options.onSearchSongs || catalogSearch.status === "loadingMore") return

    const generation = ++searchGeneration
    searchRequest?.abort()
    const controller = new AbortController()
    searchRequest = controller
    catalogSearch = { ...catalogSearch, status: "loadingMore" }
    renderState()
    try {
      const page = await options.onSearchSongs(catalogSearch.query, {
        cursor,
        signal: controller.signal,
      })
      if (controller.signal.aborted || generation !== searchGeneration) return
      const nextTracks = appendUniqueTracks(searchTracks, page.items)
      const additions = nextTracks.slice(searchTracks.length)
      searchTracks = nextTracks
      for (const track of additions) trackRegistry.set(track.id, track)
      catalogSearch = {
        ...catalogSearch,
        status: "ready",
        nextCursor: page.nextCursor,
      }
      renderState()
    } catch {
      if (controller.signal.aborted || generation !== searchGeneration) return
      catalogSearch = { ...catalogSearch, status: "error", nextCursor: cursor }
      renderState()
    } finally {
      if (searchRequest === controller) searchRequest = undefined
    }
  }

  function renderState(): void {
    const baseTracks = getBaseTracks()
    const activeBrowsePage = currentBrowsePage()
    const browseArtistRows = activeBrowsePage?.kind === "artist"
      ? artistDisplayRows(activeBrowsePage)
      : []
    const visibleTracks = activeBrowsePage?.kind === "album"
      ? activeBrowsePage.album?.tracks ?? []
      : getVisibleTracks()
    const playlistLanding = !activeBrowsePage &&
      isPlaylistLanding(state.destination) && !playlistView
    const visiblePlaylists = playlistLanding ? getVisiblePlaylists() : []
    const playlistRows = playlistLanding
      ? playlistDisplayRows(state.destination, visiblePlaylists, homeSections)
      : []
    const landingState = state.destination === "home" ? homeState : libraryPlaylistState
    const selectedId = activeBrowsePage?.selectedId ??
      state.lists[state.destination].selectedTrackId
    const selectedIndex = activeBrowsePage?.kind === "artist"
      ? browseArtistRows.findIndex(
          (row) => isSelectableArtistRow(row) && artistRowId(row) === selectedId,
        )
      : playlistLanding
        ? playlistRows.findIndex(
          (row) => row.kind === "playlist" && row.playlist.id === selectedId,
        )
        : visibleTracks.findIndex((track) => track.id === selectedId)
    const activeFilter =
      state.mode.type === "filter"
        ? state.mode.draft
        : state.lists[state.destination].filter
    const showFilter =
      Boolean(activeBrowsePage) ||
      state.destination === "search" ||
      state.destination === "home" ||
      state.destination === "playlists" ||
      state.mode.type === "search" ||
      Boolean(activeFilter)
    const compactHeight = renderer.terminalHeight < 21
    const activeVisualizerSettings = visualizerSettingsDialog?.draft ?? visualizerSettings
    const normalReservedRows = (showFilter ? 18 : 16) + (
      visualizerEnabled ? activeVisualizerSettings.height : 0
    )
    const destinationName = destinationLabel(state.destination)
    const activeAlbumView = !activeBrowsePage && state.destination === "search"
      ? albumView
      : undefined
    const showingAlbum = activeAlbumView !== undefined
    const activePlaylistView = !activeBrowsePage && isPlaylistLanding(state.destination)
      ? playlistView
      : undefined
    const showingPlaylist = activePlaylistView !== undefined

    breadcrumb.content = activeBrowsePage
      ? `nutka  /  ${activeBrowsePage.kind}`
      : showingPlaylist
      ? `nutka  /  ${activePlaylistView.sourceDestination}  /  playlist`
      : showingAlbum
      ? "nutka  /  search  /  album"
      : `nutka  /  ${destinationName.toLowerCase()}`
    workspaceTitle.content = activeBrowsePage
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
    workspaceCount.content = activeBrowsePage?.kind === "artist"
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
      : state.destination === "search" && catalogSearch.status === "loading"
        ? "searching..."
        : state.destination === "search" && catalogSearch.status === "loadingMore"
          ? `${visibleTracks.length} tracks · loading more...`
        : playlistLanding
          ? `${visiblePlaylists.length} ${pluralize("playlist", visiblePlaylists.length)}`
        : `${visibleTracks.length} ${pluralize("track", visibleTracks.length)}`
    filterLine.visible = showFilter
    filterLine.content = activeBrowsePage?.kind === "artist"
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
        : playlistLanding && playlistLoading(landingState)
          ? state.destination === "home"
            ? "◌  loading personalized recommendations"
            : "◌  loading library playlists"
          : playlistLanding && playlistLoadingMore(landingState)
            ? "◌  loading more playlists"
          : playlistLanding && playlistLandingUnavailable(landingState, visiblePlaylists.length)
            ? "×  playlists unavailable"
          : playlistLanding
            ? `${state.destination === "home" ? "Personalized for you" : "Your Library"}${
              activeFilter ? `  ·  / ${activeFilter}` : ""
            }`
        : activeAlbumView?.status === "loading"
          ? `◌  loading “${activeAlbumView.title}”`
          : activeAlbumView?.status === "error"
            ? "×  album unavailable · esc back"
            : activeAlbumView
              ? `${activeAlbumView.album!.artist}${activeFilter ? `  ·  / ${activeFilter}` : ""}`
        : state.destination === "search" && catalogSearch.status === "loading"
          ? `◌  searching Apple Music for “${catalogSearch.query}”`
          : state.destination === "search" && catalogSearch.status === "loadingMore"
            ? `◌  loading more songs for “${catalogSearch.query}”`
          : state.destination === "search" && catalogSearch.status === "error"
            ? `×  search unavailable · press s to retry “${catalogSearch.query}”`
            : state.destination === "search" && catalogSearch.query
              ? `⌕  ${catalogSearch.query}${activeFilter ? `  ·  / ${activeFilter}` : ""}`
              : activeFilter
          ? `/  ${activeFilter}  ·  press / to edit`
          : "›  type an Apple Music search and press Enter"
    filterLine.fg = activeBrowsePage && browsePageHasError(activeBrowsePage)
      ? theme.amber
      : state.mode.type === "filter" || state.mode.type === "search"
        ? theme.text
        : albumView?.status === "error" ||
            playlistView?.status === "error" ||
            (playlistLanding && playlistLandingUnavailable(
              landingState,
              visiblePlaylists.length,
            )) ||
            catalogSearch.status === "error"
          ? theme.amber
          : theme.muted
    setTrackRowContent(
      tableHeader,
      activeBrowsePage?.kind === "artist"
        ? { title: "item", artist: "artist", album: "type", year: "year", time: "time" }
        : playlistLanding
          ? { title: "playlist", artist: "curator", album: "description", time: "" }
          : { title: "track", artist: "artist", album: "album", time: "time" },
    )
    const showYearColumn = activeBrowsePage?.kind === "artist"
    tableHeader.year.visible = showYearColumn
    tableHeader.box.visible = !(compactHeight && showFilter)

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
        : playlistLanding ? playlistRows.length : visibleTracks.length,
      activeRowCount,
    )

    trackRows.forEach((row, rowIndex) => {
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
      const track = playlistLanding || activeBrowsePage?.kind === "artist"
        ? undefined
        : visibleTracks[itemIndex]
      if (artistRow?.kind === "heading") {
        row.box.visible = true
        setTrackRowContent(row, {
          title: artistRow.title,
          artist: "",
          album: "",
          time: "",
        })
        row.box.backgroundColor = theme.background
        setTrackRowColor(row, theme.accent)
        return
      }
      if (artistRow?.kind === "message") {
        row.box.visible = true
        setTrackRowContent(row, {
          title: `  ${artistRow.title}`,
          artist: "",
          album: "",
          time: "",
        })
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
      if (playlistRow?.kind === "heading") {
        row.box.visible = true
        setTrackRowContent(row, {
          title: playlistRow.title,
          artist: "",
          album: "",
          time: "",
        })
        row.box.backgroundColor = theme.background
        setTrackRowColor(row, theme.accent)
        return
      }
      if (playlistRow?.kind === "playlist") {
        const playlist = playlistRow.playlist
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
      if (!track) {
        const empty = activeBrowsePage?.kind === "artist"
          ? browseArtistRows.length === 0
          : playlistLanding ? playlistRows.length === 0 : visibleTracks.length === 0
        const showEmpty = rowIndex === 0 && empty
        row.box.visible = showEmpty
        setTrackRowContent(row, {
          title: showEmpty
            ? activeBrowsePage?.kind === "album"
              ? browseAlbumEmptyMessage(activeBrowsePage.status)
              : activeBrowsePage?.kind === "artist"
                ? "No artist content found"
            : playlistLanding
                ? playlistEmptyMessage(
                  state.destination,
                  landingState,
                  getPlaylists().length,
                )
            : activePlaylistView
              ? playlistTrackEmptyMessage(activePlaylistView.status)
            : state.destination === "search"
              ? activeAlbumView
                ? albumEmptyMessage(activeAlbumView.status)
                : searchEmptyMessage(catalogSearch)
              : emptyMessage(state.destination, baseTracks.length)
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
        title:
          renderer.terminalWidth < 64
            ? `${selected ? "›" : " "} ${track.title} — ${track.artist}`
            : `${selected ? "›" : " "} ${track.title}`,
        artist: track.artist,
        album: track.album,
        time: formatDuration(track.durationSeconds),
      })
      row.box.backgroundColor = selected ? theme.selection : theme.background
      setTrackRowColor(row, selected ? theme.text : theme.muted)
    })

    const currentTrack = state.playback.currentTrackId
      ? trackRegistry.get(state.playback.currentTrackId)
      : undefined
    const currentSongResourceId = appleSongResourceId(currentTrack)
    const currentSongLike = currentSongResourceId
      ? songLikeStates.get(currentSongResourceId)
      : undefined
    player.render({
      status: state.playback.status,
      currentTrack: currentTrack ?? null,
      queue: state.playback.queueTrackIds
        .map((trackId) => trackRegistry.get(trackId))
        .filter((track): track is Track => Boolean(track)),
      positionSeconds: state.playback.positionSeconds,
      durationSeconds: state.playback.durationSeconds,
      errorMessage: state.playback.errorCode
        ? playbackErrorMessage(state.playback.errorCode)
        : null,
      connected: Boolean(options.playback),
      shuffleMode: state.playback.shuffleMode,
      repeatMode: state.playback.repeatMode,
      canSetShuffleMode: state.playback.canSetShuffleMode,
      canSetRepeatMode: state.playback.canSetRepeatMode,
      liked: currentSongLike?.liked ?? false,
      likeStatus:
        appleAuthStatus.state === "signedIn" &&
        options.onGetSongLiked &&
        options.onSetSongLiked &&
        currentSongResourceId
          ? currentSongLike?.status ?? "loading"
          : "unavailable",
    })

    paletteOverlay.visible = state.mode.type === "palette"
    const paletteCommands = getPaletteCommands(
      state.mode.type === "palette" ? state.mode.query : "",
      {
        appleAuthStatus,
        canAppleAuth: Boolean(options.onAppleSignIn),
        canOpenAlbum: canOpenSelectedAlbum(),
        canOpenInfo: canOpenSelectedInfo(),
        canBrowseNowPlaying: canBrowseNowPlaying(),
        canFilter: !activeBrowsePage,
        canSetShuffleMode: state.playback.canSetShuffleMode,
        canSetRepeatMode: state.playback.canSetRepeatMode,
        canToggleCurrentSongLike: canToggleCurrentSongLike(),
      },
    )
    const paletteRowCount = Math.max(
      1,
      Math.min(maxPaletteRows, renderer.terminalHeight - 7),
    )
    const paletteSelectedIndex =
      state.mode.type === "palette" ? state.mode.selectedIndex : 0
    const paletteRowStart = getRowStart(
      paletteSelectedIndex,
      paletteCommands.length,
      paletteRowCount,
    )
    palettePopup.height = paletteRowCount + 6
    paletteInput.content = `›  ${state.mode.type === "palette" ? state.mode.query : ""}_`
    paletteSummary.content = `${paletteCommands.length} ${pluralize("command", paletteCommands.length)}`
    paletteRows.forEach((row, index) => {
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
      const selected =
        state.mode.type === "palette" && commandIndex === state.mode.selectedIndex
      row.box.visible = true
      row.box.backgroundColor = selected ? theme.selection : theme.surfaceRaised
      row.title.content = `${selected ? "›" : " "} ${command.title}${
        renderer.terminalWidth >= 80 ? ` · ${command.description}` : ""
      }`
      row.shortcut.content = command.shortcut
      row.title.fg = selected ? theme.text : theme.muted
      row.shortcut.fg = selected ? theme.accent : theme.muted
    })

    contextOverlay.visible = contextPicker !== undefined
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
    contextPopup.height = contextRowCount + 5
    contextSummary.content = contextPicker?.status === "loading"
      ? `◌  loading context for ${contextPicker.pinnedTrack.title}...`
      : contextPicker?.status === "error"
        ? "×  now-playing context is unavailable"
        : contextPicker?.targets.length
          ? `${contextPicker.pinnedTrack.title} · choose an album or artist`
          : "No album or artist links found"
    contextSummary.fg = contextPicker?.status === "error" ? theme.amber : theme.muted
    contextRows.forEach((row, index) => {
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
        target.kind === "album" ? target.album.title : target.artist.name
      }`
      row.shortcut.content = target.kind
      row.box.backgroundColor = selected ? theme.selection : theme.surfaceRaised
      row.title.fg = selected ? theme.text : theme.muted
      row.shortcut.fg = selected ? theme.accent : theme.muted
    })

    visualizerSettingsOverlay.visible = visualizerSettingsDialog !== undefined
    if (visualizerSettingsDialog) {
      const draft = visualizerSettingsDialog.draft
      const controls = visualizerSettingRows(draft)
      visualizerSettingsSummary.content = visualizerSettingsDialog.error ??
        "←/→ change · preview updates immediately"
      visualizerSettingsSummary.fg = visualizerSettingsDialog.error
        ? theme.amber
        : theme.muted
      visualizerSettingsRows.forEach((row, index) => {
        const control = controls[index]!
        const selected = index === visualizerSettingsDialog!.selectedIndex
        row.box.backgroundColor = selected ? theme.selection : theme.surfaceRaised
        row.title.content = `${selected ? "›" : " "} ${control.label}`
        row.shortcut.content = renderer.terminalWidth < 36
          ? control.value
          : `‹ ${control.value} ›`
        row.title.fg = selected ? theme.text : theme.muted
        row.shortcut.fg = selected ? theme.accent : theme.muted
      })
      const summaryVisible = renderer.terminalHeight >= 9
      const previewVisible = renderer.terminalHeight >= 15
      const previewWidth = Math.max(8, Math.min(52, renderer.terminalWidth - 12))
      visualizerSettingsSummary.visible = summaryVisible
      visualizerSettingsPreview.visible = previewVisible
      visualizerSettingsPreview.height = draft.height
      visualizerSettingsPreview.content = previewVisible
        ? formatSpectrumFrame(
            visualizerPreviewBands,
            previewWidth,
            draft.height,
            resolveVisualizerPalette(draft.palette, theme),
            false,
            draft.style,
          )
        : ""
      visualizerSettingsPopup.height = Math.min(
        renderer.terminalHeight - 1,
        previewVisible ? 9 + draft.height : summaryVisible ? 9 : 6,
      )
    }

    helpOverlay.visible = state.mode.type === "help"
    const compactHelp = renderer.terminalHeight < 18
    const compactHelpLines = [
      "ctrl+p commands · g n now playing",
      "↑/↓ move · i info · / fuzzy filter",
      "b/s/n previous · shuffle · next · r repeat · l like",
      "←/→ seek 5s · shift+←/→ 15s",
      "g s search · a album · m more · v visualizer · V settings · ? help",
    ]
    helpTexts.forEach((line, index) => {
      line.visible = compactHelp ? index < compactHelpLines.length : true
      line.content = compactHelp
        ? (compactHelpLines[index] ?? "")
        : (helpLines[index]?.[0] ?? "")
      line.fg = compactHelp
        ? index === 0
          ? theme.accent
          : theme.text
        : (helpLines[index]?.[1] ?? theme.text)
    })
    helpPopup.height = compactHelp ? 9 : 17

    infoOverlay.visible = infoTarget !== undefined
    if (infoTarget) {
      const content = formatInfoTarget(infoTarget)
      if (infoBody.plainText !== content) infoBody.content = content
      infoBody.scrollY = Math.min(infoBody.scrollY, infoBody.maxScrollY)
      infoPopup.title = ` ${infoTarget.kind} info `
    }

    appleAuthOverlay.visible =
      authSuccessVisible || isAppleAuthProgress(appleAuthStatus)
    appleAuthPopup.title = authSuccessVisible
      ? " apple music connected "
      : " apple music login "
    appleAuthPopup.bottomTitle = authSuccessVisible
      ? " enter continue "
      : " esc cancel "
    const authCopy = authSuccessVisible
      ? appleAuthSuccessCopy(appleAuthStatus)
      : appleAuthProgressCopy(appleAuthStatus)
    authInstructions.forEach((line, index) => {
      line.content = authCopy[index] ?? ""
      line.visible = Boolean(authCopy[index])
    })
    providerStatus.content =
      renderer.terminalWidth < 64
        ? compactAppleAuthStatusLabel(appleAuthStatus)
        : appleAuthStatusLabel(appleAuthStatus)

    mode.content = visualizerSettingsDialog
      ? "VISUAL"
      : contextPicker
      ? "CONTEXT"
      : infoTarget
      ? "INFO"
      : state.mode.type === "normal" && state.mode.pendingKey === "g"
        ? "GO TO"
        : state.mode.type.toUpperCase()
    keyHelp.content =
      authSuccessVisible
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
        : activeBrowsePage && state.mode.type === "normal"
          ? browseFooterHelp(activeBrowsePage, renderer.terminalWidth)
        : showingPlaylist && state.mode.type === "normal"
          ? playlistDetailFooterHelp(
              activePlaylistView?.nextCursor !== null,
              renderer.terminalWidth,
            )
        : playlistLanding && state.mode.type === "normal"
          ? playlistFooterHelp(
              landingState.nextCursor !== null,
              renderer.terminalWidth,
              state.destination,
            )
        : showingAlbum && state.mode.type === "normal"
          ? albumFooterHelp(renderer.terminalWidth)
        : state.destination === "search" && state.mode.type === "normal"
          ? searchFooterHelp(catalogSearch.nextCursor !== null, renderer.terminalWidth)
          : footerHelp(state, renderer.terminalWidth)
  }

  function executeCommand(command: Command | undefined): void {
    if (!command) return
    switch (command.id) {
      case "home":
      case "library":
      case "playlists":
      case "search":
      case "queue":
        navigateTo(command.id)
        return
      case "filter":
        dispatch({ type: "open-filter" })
        return
      case "info":
        state = reduceAppState(state, { type: "close-mode" })
        openSelectedInfo()
        return
      case "album":
        void openSelectedAlbum()
        return
      case "browse-now-playing":
        void openNowPlayingContext()
        return
      case "apple-sign-in":
        dispatch({ type: "close-mode" })
        options.onAppleSignIn?.()
        return
      case "apple-sign-out":
        dispatch({ type: "close-mode" })
        options.onAppleSignOut?.()
        return
      case "apple-retry-restore":
        dispatch({ type: "close-mode" })
        options.onAppleRestore?.()
        return
      case "apple-cleanup":
        dispatch({ type: "close-mode" })
        options.onAppleSignOut?.()
        return
      case "shuffle":
        state = reduceAppState(state, { type: "close-mode" })
        toggleShuffleMode()
        return
      case "repeat":
        state = reduceAppState(state, { type: "close-mode" })
        cycleRepeatMode()
        return
      case "like":
        state = reduceAppState(state, { type: "close-mode" })
        void toggleCurrentSongLiked()
        return
      case "visualizer":
        state = reduceAppState(state, { type: "close-mode" })
        toggleVisualizer()
        return
      case "visualizer-settings":
        state = reduceAppState(state, { type: "close-mode" })
        openVisualizerSettings()
        return
      case "help":
        dispatch({ type: "open-help" })
        return
      case "quit":
        dispatch({ type: "close-mode" })
        options.onQuit()
    }
  }

  function editFilter(draft: string): void {
    const visibleTrackIds = isPlaylistLanding(state.destination) && !playlistView
      ? filterPlaylistValues(getPlaylists(), draft).map((playlist) => playlist.id)
      : filterTracks(getBaseTracks(), draft).map((track) => track.id)
    dispatch({ type: "edit-filter", draft, visibleTrackIds })
  }

  function handleFilterKey(key: KeyEvent): void {
    if (state.mode.type !== "filter") return
    const visibleItemIds = getVisibleItemIds()

    if (key.name === "escape") {
      dispatch({ type: "cancel-filter" })
      return
    }
    if (key.name === "return" || key.name === "enter") {
      dispatch({ type: "submit-filter" })
      return
    }
    if (key.name === "backspace") {
      editFilter(state.mode.draft.slice(0, -1))
      return
    }
    if (
      key.name === "down" ||
      (key.ctrl && (key.name === "n" || key.sequence === "n"))
    ) {
      dispatch({
        type: "move-selection",
        delta: 1,
        visibleTrackIds: visibleItemIds,
      })
      return
    }
    if (
      key.name === "up" ||
      (key.ctrl && (key.name === "p" || key.sequence === "p"))
    ) {
      dispatch({
        type: "move-selection",
        delta: -1,
        visibleTrackIds: visibleItemIds,
      })
      return
    }
    if (isPrintable(key)) editFilter(state.mode.draft + key.sequence)
  }

  function handleSearchKey(key: KeyEvent): void {
    if (state.mode.type !== "search") return
    if (key.name === "escape") {
      dispatch({ type: "close-mode" })
      return
    }
    if (key.name === "return" || key.name === "enter") {
      void submitCatalogSearch(state.mode.draft)
      return
    }
    if (key.name === "backspace") {
      dispatch({ type: "edit-search", draft: state.mode.draft.slice(0, -1) })
      return
    }
    if (isPrintable(key)) {
      dispatch({ type: "edit-search", draft: state.mode.draft + key.sequence })
    }
  }

  function handlePaletteKey(key: KeyEvent): void {
    if (state.mode.type !== "palette") return
    const paletteCommands = getPaletteCommands(state.mode.query, {
      appleAuthStatus,
      canAppleAuth: Boolean(options.onAppleSignIn),
      canOpenAlbum: canOpenSelectedAlbum(),
      canOpenInfo: canOpenSelectedInfo(),
      canBrowseNowPlaying: canBrowseNowPlaying(),
      canFilter: !currentBrowsePage(),
      canSetShuffleMode: state.playback.canSetShuffleMode,
      canSetRepeatMode: state.playback.canSetRepeatMode,
      canToggleCurrentSongLike: canToggleCurrentSongLike(),
    })

    if (key.name === "escape") {
      dispatch({ type: "close-mode" })
      return
    }
    if (key.name === "return" || key.name === "enter") {
      executeCommand(paletteCommands[state.mode.selectedIndex])
      return
    }
    if (key.name === "backspace") {
      dispatch({ type: "edit-palette", query: state.mode.query.slice(0, -1) })
      return
    }
    if (
      key.name === "down" ||
      (key.ctrl && (key.name === "n" || key.sequence === "n"))
    ) {
      dispatch({ type: "move-palette", delta: 1, itemCount: paletteCommands.length })
      return
    }
    if (
      key.name === "up" ||
      (key.ctrl && (key.name === "p" || key.sequence === "p"))
    ) {
      dispatch({ type: "move-palette", delta: -1, itemCount: paletteCommands.length })
      return
    }
    if (isPrintable(key)) {
      dispatch({ type: "edit-palette", query: state.mode.query + key.sequence })
    }
  }

  function handleInfoKey(key: KeyEvent): void {
    if (!infoTarget) return
    if (key.name === "escape" || isPlainKey(key, "i")) {
      closeInfo()
      return
    }
    if (isPlainKey(key, "j") || key.name === "down") {
      scrollInfo(1)
      return
    }
    if (isPlainKey(key, "k") || key.name === "up") {
      scrollInfo(-1)
      return
    }
    const pageSize = Math.max(1, Math.min(12, renderer.terminalHeight - 8))
    if (key.name === "pagedown") {
      scrollInfo(pageSize)
      return
    }
    if (key.name === "pageup") {
      scrollInfo(-pageSize)
      return
    }
    if (key.name === "home") {
      infoBody.scrollY = 0
      return
    }
    if (key.name === "end") infoBody.scrollY = infoBody.maxScrollY
  }

  function handleContextPickerKey(key: KeyEvent): void {
    if (!contextPicker) return
    if (
      key.name === "escape" ||
      (key.ctrl && (key.name === "o" || key.sequence === "o"))
    ) {
      closeContextPicker()
      return
    }
    if (key.name === "return" || key.name === "enter") {
      chooseContextTarget()
      return
    }
    if (isPlainKey(key, "j") || key.name === "down") {
      if (contextPicker.targets.length > 0) {
        contextPicker.selectedIndex = Math.min(
          contextPicker.targets.length - 1,
          contextPicker.selectedIndex + 1,
        )
        renderState()
      }
      return
    }
    if (isPlainKey(key, "k") || key.name === "up") {
      contextPicker.selectedIndex = Math.max(0, contextPicker.selectedIndex - 1)
      renderState()
    }
  }

  function handleVisualizerSettingsKey(key: KeyEvent): void {
    if (!visualizerSettingsDialog) return
    if (key.name === "escape") {
      closeVisualizerSettings(false)
      return
    }
    if (key.name === "return" || key.name === "enter") {
      closeVisualizerSettings(true)
      return
    }
    if (isPlainKey(key, "j") || key.name === "down") {
      visualizerSettingsDialog.selectedIndex = Math.min(
        visualizerSettingCount - 1,
        visualizerSettingsDialog.selectedIndex + 1,
      )
      renderState()
      return
    }
    if (isPlainKey(key, "k") || key.name === "up") {
      visualizerSettingsDialog.selectedIndex = Math.max(
        0,
        visualizerSettingsDialog.selectedIndex - 1,
      )
      renderState()
      return
    }
    if (key.name === "left" || key.name === "right") {
      cycleVisualizerSetting(key.name === "left" ? -1 : 1)
    }
  }

  function handleNormalKey(key: KeyEvent): void {
    if (state.mode.type !== "normal") return

    if (state.mode.pendingKey === "g") {
      const target = gotoTarget(key)
      if (target === "now-playing") {
        dispatch({ type: "close-mode" })
        void openNowPlayingContext()
        return
      }
      if (target) {
        navigateTo(target)
        return
      }
      dispatch({ type: "close-mode" })
      return
    }

    if (key.ctrl && (key.name === "p" || key.sequence === "p")) {
      dispatch({ type: "open-palette" })
      return
    }
    if (key.ctrl && (key.name === "o" || key.sequence === "o")) {
      popBrowsePage()
      return
    }
    if (isShiftKey(key, "v")) {
      openVisualizerSettings()
      return
    }
    const activeBrowsePage = currentBrowsePage()
    if (activeBrowsePage) {
      if (isPlainKey(key, "j") || key.name === "down") {
        moveBrowseSelection(1)
        return
      }
      if (isPlainKey(key, "k") || key.name === "up") {
        moveBrowseSelection(-1)
        return
      }
      if (key.name === "return" || key.name === "enter") {
        openSelectedBrowseItem()
        return
      }
      if (isPlainKey(key, "m")) {
        loadMoreSelectedArtistSection()
        return
      }
      if (isPlainKey(key, "i") || isPlainKey(key, "/")) return
      if (key.name === "escape") {
        popBrowsePage()
        return
      }
    }
    if (isPlainKey(key, "i")) {
      openSelectedInfo()
      return
    }
    if (isPlainKey(key, "j") || key.name === "down") {
      dispatch({
        type: "move-selection",
        delta: 1,
        visibleTrackIds: getVisibleItemIds(),
      })
      return
    }
    if (isPlainKey(key, "k") || key.name === "up") {
      dispatch({
        type: "move-selection",
        delta: -1,
        visibleTrackIds: getVisibleItemIds(),
      })
      return
    }
    if (key.name === "return" || key.name === "enter") {
      if (isPlaylistLanding(state.destination) && !playlistView) {
        void openSelectedPlaylist()
        return
      }
      const visibleTracks = getVisibleTracks()
      const selectedId = state.lists[state.destination].selectedTrackId
      const selectedIndex = visibleTracks.findIndex((track) => track.id === selectedId)
      const selectedTrack = visibleTracks[selectedIndex]
      if (options.playback && isPlayableAppleTrack(selectedTrack)) {
        const upcoming = visibleTracks
          .slice(selectedIndex + 1)
          .filter(isPlayableAppleTrack)
        void options.playback.play(selectedTrack, upcoming).catch(() => {})
      }
      return
    }
    if (key.name === "space" || key.sequence === " ") {
      if (state.playback.status === "playing") {
        void options.playback?.pause().catch(() => {})
      } else if (state.playback.status === "paused") {
        void options.playback?.resume().catch(() => {})
      }
      return
    }
    if (isPlainKey(key, "b")) {
      playPreviousTrack()
      return
    }
    if (isPlainKey(key, "l")) {
      void toggleCurrentSongLiked()
      return
    }
    if (isPlainKey(key, "r")) {
      cycleRepeatMode()
      return
    }
    if (isPlainKey(key, "s")) {
      playRandomTrack()
      return
    }
    if (isPlainKey(key, "n")) {
      playNextTrack()
      return
    }
    if (isPlainKey(key, "v")) {
      toggleVisualizer()
      return
    }
    if (
      !key.ctrl &&
      !key.meta &&
      !key.option &&
      (key.name === "left" || key.name === "right")
    ) {
      const delta = key.shift ? 15 : 5
      seekBy(key.name === "left" ? -delta : delta)
      return
    }
    if (isPlainKey(key, "/")) {
      dispatch({ type: "open-filter" })
      return
    }
    if (!activeBrowsePage && state.destination === "search" && isPlainKey(key, "a")) {
      void openSelectedAlbum()
      return
    }
    if (!activeBrowsePage && state.destination === "search" && !albumView && isPlainKey(key, "m")) {
      void loadMoreCatalogSearch()
      return
    }
    if (!activeBrowsePage && isPlaylistLanding(state.destination) && isPlainKey(key, "m")) {
      if (playlistView) void loadMorePlaylistTracks()
      else void loadMorePlaylists()
      return
    }
    if (isPlainKey(key, "?")) {
      dispatch({ type: "open-help" })
      return
    }
    if (isPlainKey(key, "g")) {
      dispatch({ type: "begin-goto" })
      return
    }
    if (key.name === "escape") {
      if (albumView) {
        leaveAlbumView()
        renderState()
        return
      }
      if (playlistView) {
        leavePlaylistView()
        renderState()
        return
      }
      if (state.destination !== "home") navigateTo("home")
      return
    }
    if (isPlainKey(key, "q")) options.onQuit()
  }

  function handleKeypress(key: KeyEvent): void {
    if (key.eventType === "release") return
    if (authSuccessVisible) {
      if (
        key.name === "escape" ||
        key.name === "return" ||
        key.name === "enter"
      ) {
        authSuccessVisible = false
        renderState()
      }
      return
    }
    if (
      isAppleAuthProgress(appleAuthStatus)
    ) {
      if (key.name === "escape") options.onAppleSignInCancel?.()
      return
    }
    if (visualizerSettingsDialog) return handleVisualizerSettingsKey(key)
    if (contextPicker) return handleContextPickerKey(key)
    if (infoTarget) return handleInfoKey(key)
    if (state.mode.type === "palette") return handlePaletteKey(key)
    if (state.mode.type === "search") return handleSearchKey(key)
    if (state.mode.type === "filter") return handleFilterKey(key)
    if (state.mode.type === "help") {
      if (key.ctrl && (key.name === "p" || key.sequence === "p")) {
        dispatch({ type: "open-palette" })
      } else if (
        key.name === "escape" ||
        key.name === "return" ||
        key.name === "enter" ||
        key.name === "?"
      ) {
        dispatch({ type: "close-mode" })
      }
      return
    }
    handleNormalKey(key)
  }

  function applyResponsiveLayout(): void {
    const width = renderer.terminalWidth
    const compactHeight = renderer.terminalHeight < 21
    const compactAuth = renderer.terminalHeight < 14
    header.height = compactHeight ? 2 : 3
    header.paddingX = compactHeight ? 1 : 2
    workspace.padding = compactHeight ? 0 : 1
    workspaceHeader.height = compactHeight ? 1 : 2
    player.applyResponsiveLayout(width, compactHeight)
    footer.height = compactHeight ? 2 : 3
    footer.paddingX = compactHeight ? 1 : 2
    providerStatus.visible = width >= 40
    if (width < 64) providerStatus.content = compactAppleAuthStatusLabel(appleAuthStatus)
    destinationHint.visible = width >= 100
    palettePopup.width = width >= 80 ? 72 : "94%"
    contextPopup.width = width >= 80 ? 72 : "94%"
    visualizerSettingsPopup.width = width >= 72 ? 64 : "94%"
    visualizerSettingsPopup.paddingY = renderer.terminalHeight >= 9 ? 1 : 0
    const visualizerValueWidth = Math.max(4, Math.min(22, Math.floor((width - 8) / 2)))
    for (const row of visualizerSettingsRows) row.shortcut.width = visualizerValueWidth
    helpPopup.width = width >= 80 ? 72 : "94%"
    infoPopup.width = width >= 90 ? 80 : "94%"
    infoPopup.height = Math.max(7, Math.min(22, renderer.terminalHeight - 1))
    appleAuthPopup.width = width >= 72 ? 64 : "94%"
    appleAuthPopup.height = compactAuth ? Math.max(7, renderer.terminalHeight - 1) : 12
    authInstructions[0]!.height = compactAuth ? 1 : 2
    authInstructions[2]!.height = compactAuth ? 1 : 2

    for (const row of [tableHeader, ...trackRows]) {
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

  function toggleVisualizer(): void {
    visualizerEnabled = !visualizerEnabled
    player.setVisualizerEnabled(visualizerEnabled)
    void options.playback?.audioAnalysis?.setEnabled(visualizerEnabled).catch(() => {})
    applyResponsiveLayout()
    renderState()
  }

  function openVisualizerSettings(): void {
    state = reduceAppState(state, { type: "close-mode" })
    visualizerSettingsDialog = {
      original: { ...visualizerSettings },
      draft: { ...visualizerSettings },
      selectedIndex: 0,
    }
    renderState()
  }

  function closeVisualizerSettings(apply: boolean): void {
    if (!visualizerSettingsDialog) return
    const dialog = visualizerSettingsDialog
    if (!apply) {
      player.setVisualizerSettings(dialog.original)
      visualizerSettingsDialog = undefined
      applyResponsiveLayout()
      renderState()
      return
    }

    try {
      options.onSaveVisualizerSettings?.(dialog.draft)
      visualizerSettings = { ...dialog.draft }
      visualizerSettingsDialog = undefined
      applyResponsiveLayout()
      renderState()
    } catch {
      dialog.error = "Could not save visualizer settings"
      renderState()
    }
  }

  function cycleVisualizerSetting(delta: number): void {
    if (!visualizerSettingsDialog) return
    const draft = cycleVisualizerSettings(
      visualizerSettingsDialog.draft,
      visualizerSettingsDialog.selectedIndex,
      delta,
    )
    if (!draft) return
    visualizerSettingsDialog.draft = draft
    visualizerSettingsDialog.error = undefined
    player.setVisualizerSettings(draft)
    applyResponsiveLayout()
    renderState()
  }

  function handleResize(): void {
    applyResponsiveLayout()
    renderState()
  }

  renderer.keyInput.on("keypress", handleKeypress)
  renderer.on(CliRenderEvents.RESIZE, handleResize)
  const unsubscribePlayback = options.playback?.subscribe(syncPlayback)
  const unsubscribeAudioAnalysis = options.playback?.audioAnalysis?.subscribe(
    (frame) => player.renderAudioAnalysis(frame),
  )
  applyResponsiveLayout()
  renderState()

  return {
    getState: () => ({ ...state }),
    setAppleAuthStatus: (status) => {
      const shouldLoadHome =
        status.state === "signedIn" &&
        (appleAuthStatus.state !== "signedIn" ||
          status.storefront !== appleAuthStatus.storefront)
      if (
        appleAuthStatus.state === "signedIn" &&
        (status.state !== "signedIn" ||
          status.storefront !== appleAuthStatus.storefront)
      ) {
        infoTarget = undefined
        infoBody.scrollY = 0
        contextGeneration++
        contextRequest?.abort()
        contextRequest = undefined
        contextPicker = undefined
        closeBrowseSession(false)
        leaveAlbumView()
        leavePlaylistView()
        searchGeneration++
        searchRequest?.abort()
        searchRequest = undefined
        searchTracks = []
        catalogSearch = { query: "", status: "idle", nextCursor: null }
        homeGeneration++
        homeRequest?.abort()
        homeRequest = undefined
        libraryPlaylistGeneration++
        libraryPlaylistRequest?.abort()
        libraryPlaylistRequest = undefined
        playlistTrackGeneration++
        playlistTrackRequest?.abort()
        playlistTrackRequest = undefined
        randomPlaylistGeneration++
        randomPlaylistRequest?.abort()
        randomPlaylistRequest = undefined
        homeSections = []
        libraryPlaylists = []
        homeState = { status: "idle", nextCursor: null }
        libraryPlaylistState = { status: "idle", nextCursor: null }
        void options.playback?.disconnect()
        for (const trackId of trackRegistry.keys()) {
          if (
            !libraryTracks.some((track) => track.id === trackId) &&
            !isPlaybackTrack(trackId)
          ) {
            trackRegistry.delete(trackId)
          }
        }
        state = reduceAppState(state, {
          type: "reset-list",
          destination: "home",
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
      authSuccessVisible =
        status.state === "signedIn" &&
        ["authorizing", "validating", "saving"].includes(appleAuthStatus.state)
      if (status.state !== "signedIn") {
        for (const request of songLikeRequests) request.abort()
        songLikeRequests.clear()
        songLikeStates.clear()
      }
      appleAuthStatus = status
      if (status.state === "signedIn" && state.playback.currentTrackId) {
        const track = trackRegistry.get(state.playback.currentTrackId)
        if (isPlayableAppleTrack(track)) void loadSongLike(track)
      }
      if (state.mode.type === "palette") {
        state = reduceAppState(state, {
          type: "edit-palette",
          query: state.mode.query,
        })
      }
      renderState()
      if (shouldLoadHome) {
        void loadPlaylistLanding("home")
        if (state.destination === "playlists") void loadPlaylistLanding("playlists")
      }
    },
    destroy: () => {
      searchGeneration++
      searchRequest?.abort()
      albumGeneration++
      albumRequest?.abort()
      homeGeneration++
      homeRequest?.abort()
      libraryPlaylistGeneration++
      libraryPlaylistRequest?.abort()
      playlistTrackGeneration++
      playlistTrackRequest?.abort()
      randomPlaylistGeneration++
      randomPlaylistRequest?.abort()
      contextGeneration++
      contextRequest?.abort()
      for (const request of songLikeRequests) request.abort()
      songLikeRequests.clear()
      for (const request of browseRequests) request.abort()
      browseRequests.clear()
      renderer.keyInput.off("keypress", handleKeypress)
      renderer.off(CliRenderEvents.RESIZE, handleResize)
      unsubscribePlayback?.()
      unsubscribeAudioAnalysis?.()
      app.destroyRecursively()
    },
  }
}

function gotoTarget(key: KeyEvent): Destination | "now-playing" | null {
  if (isPlainKey(key, "n")) return "now-playing"
  if (isPlainKey(key, "h")) return "home"
  if (isPlainKey(key, "l")) return "library"
  if (isPlainKey(key, "p")) return "playlists"
  if (isPlainKey(key, "s")) return "search"
  if (isPlainKey(key, "q")) return "queue"
  return null
}

function isPrintable(key: KeyEvent): boolean {
  return (
    key.sequence.length === 1 &&
    !key.ctrl &&
    !key.meta &&
    key.sequence >= " "
  )
}

function isPlainKey(key: KeyEvent, name: string): boolean {
  return (
    !key.ctrl &&
    !key.meta &&
    !key.shift &&
    (key.name === name || key.sequence === name)
  )
}

function isShiftKey(key: KeyEvent, name: string): boolean {
  return (
    !key.ctrl &&
    !key.meta &&
    !key.option &&
    (key.shift || key.sequence === name.toUpperCase()) &&
    (key.name === name || key.sequence.toLowerCase() === name)
  )
}
