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
  AppleCatalogAlbum,
  AppleCatalogPlaylist,
  AppleCatalogTrack,
  AppleLibraryPlaylist,
  ApplePlaylist,
  PlaybackController,
  PlaybackSnapshot,
  SearchOptions,
  SearchPage,
  Track,
} from "../core/types"
import type { AppleAuthStatus } from "../services/apple-auth"
import { formatAudioQuality } from "./audio-quality"
import { createPlayerPanel } from "./player"
import { theme } from "./theme"

const maxTrackRows = 30
const maxPaletteRows = 7

type CommandId =
  | "library"
  | "playlists"
  | "search"
  | "queue"
  | "album"
  | "info"
  | "filter"
  | "apple-sign-in"
  | "apple-sign-out"
  | "apple-retry-restore"
  | "apple-cleanup"
  | "help"
  | "quit"

interface Command {
  id: CommandId
  title: string
  description: string
  shortcut: string
  keywords: string
}

const commands: readonly Command[] = [
  {
    id: "library",
    title: "Go to Library",
    description: "Browse saved tracks",
    shortcut: "g l",
    keywords: "library tracks browse saved",
  },
  {
    id: "playlists",
    title: "Go to Playlists",
    description: "Browse For You and saved playlists",
    shortcut: "g p",
    keywords: "playlists for you recommended saved library",
  },
  {
    id: "search",
    title: "Search music",
    description: "Find title, artist, or album",
    shortcut: "g s",
    keywords: "search find catalog music",
  },
  {
    id: "queue",
    title: "Go to Queue",
    description: "See what plays next",
    shortcut: "g q",
    keywords: "queue upcoming next",
  },
  {
    id: "filter",
    title: "Filter current list",
    description: "Narrow visible tracks",
    shortcut: "/",
    keywords: "filter current list narrow",
  },
  {
    id: "info",
    title: "Show Item Info",
    description: "Inspect the selected item",
    shortcut: "i",
    keywords: "info details metadata selected track album playlist",
  },
  {
    id: "album",
    title: "Go to Album",
    description: "Open the selected song's album",
    shortcut: "a",
    keywords: "album release selected song open",
  },
  {
    id: "apple-sign-in",
    title: "Sign in to Apple Music",
    description: "Authorize this device",
    shortcut: "",
    keywords: "apple music login sign in authorize account",
  },
  {
    id: "apple-retry-restore",
    title: "Retry Apple Music keyring",
    description: "Try loading the saved login again",
    shortcut: "",
    keywords: "apple music retry keyring restore login",
  },
  {
    id: "apple-cleanup",
    title: "Remove incomplete Apple login",
    description: "Clean up after a keyring save failure",
    shortcut: "",
    keywords: "apple music cleanup remove incomplete keyring save failed",
  },
  {
    id: "apple-sign-out",
    title: "Sign out of Apple Music",
    description: "Remove login from this device",
    shortcut: "",
    keywords: "apple music logout sign out account",
  },
  {
    id: "help",
    title: "Keyboard help",
    description: "Show all shortcuts",
    shortcut: "?",
    keywords: "help keyboard shortcuts keys",
  },
  {
    id: "quit",
    title: "Quit Nuta",
    description: "Close the player",
    shortcut: "q",
    keywords: "quit exit close",
  },
]

interface NutaAppOptions {
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
  onGetRecommendedPlaylists?: (
    options?: SearchOptions,
  ) => Promise<SearchPage<AppleCatalogPlaylist>>
  onGetLibraryPlaylists?: (
    options?: SearchOptions,
  ) => Promise<SearchPage<AppleLibraryPlaylist>>
  onGetPlaylistTracks?: (
    playlist: ApplePlaylist,
    options?: SearchOptions,
  ) => Promise<SearchPage<AppleCatalogTrack>>
  onAppleSignIn?: () => void
  onAppleSignOut?: () => void
  onAppleSignInCancel?: () => void
  onAppleRestore?: () => void
  playback?: PlaybackController<AppleCatalogTrack>
}

interface TrackRow {
  box: BoxRenderable
  title: TextRenderable
  artist: TextRenderable
  album: TextRenderable
  time: TextRenderable
}

type PlaylistDisplayRow =
  | { kind: "heading"; title: string }
  | { kind: "playlist"; playlist: ApplePlaylist }

type InfoTarget =
  | {
      kind: "track"
      track: Track
      album?: AppleCatalogAlbum
      playlist?: ApplePlaylist
    }
  | { kind: "album"; album: AppleCatalogAlbum }
  | { kind: "playlist"; playlist: ApplePlaylist }

interface PaletteRow {
  box: BoxRenderable
  title: TextRenderable
  shortcut: TextRenderable
}

export interface NutaApp {
  getState(): AppState
  setAppleAuthStatus(status: AppleAuthStatus): void
  destroy(): void
}

export function createNutaApp(
  renderer: CliRenderer,
  options: NutaAppOptions,
): NutaApp {
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
  let recommendedPlaylists: readonly AppleCatalogPlaylist[] = []
  let libraryPlaylists: readonly AppleLibraryPlaylist[] = []
  let recommendationRequest: AbortController | undefined
  let recommendationGeneration = 0
  let libraryPlaylistRequest: AbortController | undefined
  let libraryPlaylistGeneration = 0
  let playlistTrackRequest: AbortController | undefined
  let playlistTrackGeneration = 0
  let recommendationState: {
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
  let infoTarget: InfoTarget | undefined

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
  const breadcrumb = text(renderer, "breadcrumb", "nuta  /  library", theme.text)
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
  const workspaceTitle = text(renderer, "workspace-title", "Library", theme.text)
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

  const player = createPlayerPanel(renderer, { onSeek: requestSeek })

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
  const destinationHint = text(renderer, "destination-hint", "g l/p/s/q", theme.amber)
  keyHelp.flexGrow = 1
  destinationHint.width = 11
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

  const helpOverlay = createOverlay(renderer, "help-overlay", 30)
  const helpPopup = new BoxRenderable(renderer, {
    id: "help-popup",
    width: 72,
    maxWidth: "94%",
    height: 16,
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
    ["g l  library     g p  playlists     g s  search     g q  queue", theme.text],
    ["ctrl+p  commands      ?    help         q    quit", theme.text],
    ["", theme.text],
    ["LISTS", theme.accent],
    ["j/k or ↑/↓  move      enter  play or open", theme.text],
    ["i           item info /      filter", theme.text],
    ["←/→         seek 5s   shift+←/→  seek 15s", theme.text],
    ["esc         back to library or cancel pending g", theme.text],
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
    })
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
    if (destination === "playlists") {
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

  function getPlaylists(): readonly ApplePlaylist[] {
    const savedCatalogIds = new Set(
      libraryPlaylists
        .map((playlist) => playlist.apple.globalId)
        .filter((id): id is string => Boolean(id)),
    )
    return [
      ...recommendedPlaylists.filter(
        (playlist) => !savedCatalogIds.has(playlist.apple.resourceId),
      ),
      ...libraryPlaylists,
    ]
  }

  function getVisiblePlaylists(): readonly ApplePlaylist[] {
    const query = state.mode.type === "filter"
      ? state.mode.draft
      : state.lists.playlists.filter
    return filterPlaylistValues(getPlaylists(), query)
  }

  function getVisibleItemIds(): readonly string[] {
    return state.destination === "playlists" && !playlistView
      ? getVisiblePlaylists().map((playlist) => playlist.id)
      : getVisibleTracks().map((track) => track.id)
  }

  function selectedInfoTarget(): InfoTarget | undefined {
    const selectedId = state.lists[state.destination].selectedTrackId
    if (state.destination === "playlists" && !playlistView) {
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
    return selectedInfoTarget() !== undefined
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

  function canOpenSelectedAlbum(): boolean {
    if (state.destination !== "search" || albumView || !options.onGetAlbumForSong) return false
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

  async function loadPlaylistLanding(): Promise<void> {
    const requests: Promise<void>[] = []
    if (
      recommendationState.status === "idle" ||
      recommendationState.status === "error"
    ) {
      requests.push(loadRecommendedPlaylists())
    }
    if (
      libraryPlaylistState.status === "idle" ||
      libraryPlaylistState.status === "error"
    ) {
      requests.push(loadLibraryPlaylists())
    }
    await Promise.all(requests)
  }

  async function loadRecommendedPlaylists(cursor?: string): Promise<void> {
    if (!options.onGetRecommendedPlaylists) {
      recommendationState = { status: "error", nextCursor: null }
      renderState()
      return
    }
    const generation = ++recommendationGeneration
    recommendationRequest?.abort()
    const controller = new AbortController()
    recommendationRequest = controller
    recommendationState = {
      ...recommendationState,
      status: cursor ? "loadingMore" : "loading",
    }
    if (!cursor) recommendedPlaylists = []
    renderState()
    try {
      const page = await options.onGetRecommendedPlaylists({
        ...(cursor ? { cursor } : {}),
        signal: controller.signal,
      })
      if (controller.signal.aborted || generation !== recommendationGeneration) return
      recommendedPlaylists = appendUniquePlaylists(recommendedPlaylists, page.items)
      recommendationState = { status: "ready", nextCursor: page.nextCursor }
      reconcilePlaylistSelection()
    } catch {
      if (controller.signal.aborted || generation !== recommendationGeneration) return
      recommendationState = {
        status: cursor ? "ready" : "error",
        nextCursor: cursor ?? null,
      }
      renderState()
    } finally {
      if (recommendationRequest === controller) recommendationRequest = undefined
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
    if (state.destination !== "playlists" || playlistView) {
      renderState()
      return
    }
    const visible = getVisiblePlaylists()
    const selectedId = state.lists.playlists.selectedTrackId
    if (!visible.some((playlist) => playlist.id === selectedId)) {
      state = reduceAppState(state, {
        type: "select-track",
        trackId: visible[0]?.id ?? null,
      })
    }
    renderState()
  }

  async function loadMorePlaylists(): Promise<void> {
    const selectedId = state.lists.playlists.selectedTrackId
    const selected = getVisiblePlaylists().find((playlist) => playlist.id === selectedId)
    if (selected?.apple.resourceType === "library-playlists") {
      if (libraryPlaylistState.nextCursor) {
        await loadLibraryPlaylists(libraryPlaylistState.nextCursor)
      }
      return
    }
    if (recommendationState.nextCursor) {
      await loadRecommendedPlaylists(recommendationState.nextCursor)
    } else if (libraryPlaylistState.nextCursor) {
      await loadLibraryPlaylists(libraryPlaylistState.nextCursor)
    }
  }

  async function openSelectedPlaylist(): Promise<void> {
    if (playlistView || !options.onGetPlaylistTracks) return
    const selectedId = state.lists.playlists.selectedTrackId
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
      sourceSelectedTrackId: selectedId,
      sourceFilter: state.lists.playlists.filter,
    }
    state = reduceAppState(state, { type: "close-mode" })
    state = reduceAppState(state, {
      type: "reset-list",
      destination: "playlists",
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
        destination: "playlists",
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
        playlists: {
          filter: view.sourceFilter,
          selectedTrackId: view.sourceSelectedTrackId,
        },
      },
    }
  }

  function navigateTo(destination: Destination): void {
    leaveAlbumView()
    leavePlaylistView()
    const baseItems = destination === "playlists"
      ? getPlaylists()
      : getBaseTracks(destination)
    const rememberedId = state.lists[destination].selectedTrackId
    const selectedTrackId = baseItems.some((item) => item.id === rememberedId)
      ? rememberedId
      : (baseItems[0]?.id ?? null)
    const actions: AppAction[] = [
      { type: "navigate", destination },
      { type: "select-track", trackId: selectedTrackId },
    ]
    if (destination === "search" && !catalogSearch.query) {
      actions.push({ type: "open-search", query: catalogSearch.query })
    }
    dispatchAll(actions)
    if (destination === "playlists" && appleAuthStatus.state === "signedIn") {
      void loadPlaylistLanding()
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
      const knownIds = new Set(searchTracks.map((track) => track.id))
      const additions = page.items.filter((track) => !knownIds.has(track.id))
      searchTracks = [...searchTracks, ...additions]
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
    const visibleTracks = getVisibleTracks()
    const playlistLanding = state.destination === "playlists" && !playlistView
    const visiblePlaylists = playlistLanding ? getVisiblePlaylists() : []
    const playlistRows = playlistLanding ? playlistDisplayRows(visiblePlaylists) : []
    const selectedId = state.lists[state.destination].selectedTrackId
    const selectedIndex = playlistLanding
      ? playlistRows.findIndex(
          (row) => row.kind === "playlist" && row.playlist.id === selectedId,
        )
      : visibleTracks.findIndex((track) => track.id === selectedId)
    const activeFilter =
      state.mode.type === "filter"
        ? state.mode.draft
        : state.lists[state.destination].filter
    const showFilter =
      state.destination === "search" ||
      state.destination === "playlists" ||
      state.mode.type === "search" ||
      Boolean(activeFilter)
    const compactHeight = renderer.terminalHeight < 16
    const destinationName = destinationLabel(state.destination)
    const activeAlbumView = state.destination === "search" ? albumView : undefined
    const showingAlbum = activeAlbumView !== undefined
    const activePlaylistView = state.destination === "playlists" ? playlistView : undefined
    const showingPlaylist = activePlaylistView !== undefined

    breadcrumb.content = showingPlaylist
      ? "nuta  /  playlists  /  playlist"
      : showingAlbum
      ? "nuta  /  search  /  album"
      : `nuta  /  ${destinationName.toLowerCase()}`
    workspaceTitle.content =
      activePlaylistView
        ? activePlaylistView.playlist.title
        : activeAlbumView
          ? activeAlbumView.title
          : state.destination === "search"
            ? "Search music"
            : destinationName
    workspaceCount.content =
      activePlaylistView?.status === "loading"
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
    filterLine.content =
      state.mode.type === "search"
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
        : playlistLanding && playlistsLoading(recommendationState, libraryPlaylistState)
          ? "◌  loading For You and library playlists"
          : playlistLanding && playlistsLoadingMore(recommendationState, libraryPlaylistState)
            ? "◌  loading more playlists"
          : playlistLanding && playlistsUnavailable(
              recommendationState,
              libraryPlaylistState,
              visiblePlaylists.length,
            )
            ? "×  playlists unavailable"
          : playlistLanding
            ? `For You  ·  Your Library${activeFilter ? `  ·  / ${activeFilter}` : ""}`
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
    filterLine.fg =
      state.mode.type === "filter" || state.mode.type === "search"
        ? theme.text
        : albumView?.status === "error" ||
            playlistView?.status === "error" ||
            (playlistLanding && playlistsUnavailable(
              recommendationState,
              libraryPlaylistState,
              visiblePlaylists.length,
            )) ||
            catalogSearch.status === "error"
          ? theme.amber
          : theme.muted
    setTrackRowContent(tableHeader, playlistLanding
      ? { title: "playlist", artist: "curator", album: "description", time: "" }
      : { title: "track", artist: "artist", album: "album", time: "time" })
    tableHeader.box.visible = !(compactHeight && showFilter)

    const activeRowCount = Math.max(
      1,
      Math.min(
        maxTrackRows,
        renderer.terminalHeight -
          (compactHeight ? (showFilter ? 10 : 9) : showFilter ? 18 : 16),
      ),
    )
    const rowStart = getRowStart(
      Math.max(0, selectedIndex),
      playlistLanding ? playlistRows.length : visibleTracks.length,
      activeRowCount,
    )

    trackRows.forEach((row, rowIndex) => {
      if (rowIndex >= activeRowCount) {
        row.box.visible = false
        return
      }

      const itemIndex = rowStart + rowIndex
      const playlistRow = playlistLanding ? playlistRows[itemIndex] : undefined
      const track = playlistLanding ? undefined : visibleTracks[itemIndex]
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
        const empty = playlistLanding ? playlistRows.length === 0 : visibleTracks.length === 0
        const showEmpty = rowIndex === 0 && empty
        row.box.visible = showEmpty
        setTrackRowContent(row, {
          title: showEmpty
            ? playlistLanding
                ? playlistEmptyMessage(
                  recommendationState,
                  libraryPlaylistState,
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
    })

    paletteOverlay.visible = state.mode.type === "palette"
    const paletteCommands = getPaletteCommands(
      state.mode.type === "palette" ? state.mode.query : "",
      appleAuthStatus,
      Boolean(options.onAppleSignIn),
      canOpenSelectedAlbum(),
      canOpenSelectedInfo(),
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

    helpOverlay.visible = state.mode.type === "help"
    const compactHelp = renderer.terminalHeight < 18
    const compactHelpLines = [
      "ctrl+p commands · g l/p/s/q go",
      "↑/↓ move · i info · / fuzzy filter",
      "←/→ seek 5s · shift+←/→ 15s",
      "s search · a album · m more · ? help",
      "filter: type · enter apply · esc cancel",
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
    helpPopup.height = compactHelp ? 9 : 16

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

    mode.content = infoTarget
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
        : infoTarget
          ? renderer.terminalWidth < 64
            ? "j/k scroll  i/esc close"
            : "Item information   j/k or ↑/↓ scroll   i/esc close"
        : showingPlaylist && state.mode.type === "normal"
          ? playlistDetailFooterHelp(
              activePlaylistView?.nextCursor !== null,
              renderer.terminalWidth,
            )
        : playlistLanding && state.mode.type === "normal"
          ? playlistFooterHelp(
              recommendationState.nextCursor !== null ||
                libraryPlaylistState.nextCursor !== null,
              renderer.terminalWidth,
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
      case "help":
        dispatch({ type: "open-help" })
        return
      case "quit":
        dispatch({ type: "close-mode" })
        options.onQuit()
    }
  }

  function editFilter(draft: string): void {
    const visibleTrackIds = state.destination === "playlists" && !playlistView
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
    const paletteCommands = getPaletteCommands(
      state.mode.query,
      appleAuthStatus,
      Boolean(options.onAppleSignIn),
      canOpenSelectedAlbum(),
      canOpenSelectedInfo(),
    )

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

  function handleNormalKey(key: KeyEvent): void {
    if (state.mode.type !== "normal") return

    if (state.mode.pendingKey === "g") {
      const destination = gotoDestination(key)
      if (destination) {
        navigateTo(destination)
        return
      }
      dispatch({ type: "close-mode" })
      return
    }

    if (key.ctrl && (key.name === "p" || key.sequence === "p")) {
      dispatch({ type: "open-palette" })
      return
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
      if (state.destination === "playlists" && !playlistView) {
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
    if (state.destination === "search" && isPlainKey(key, "s")) {
      leaveAlbumView()
      dispatch({ type: "open-search", query: catalogSearch.query })
      return
    }
    if (state.destination === "search" && isPlainKey(key, "a")) {
      void openSelectedAlbum()
      return
    }
    if (state.destination === "search" && !albumView && isPlainKey(key, "m")) {
      void loadMoreCatalogSearch()
      return
    }
    if (state.destination === "playlists" && isPlainKey(key, "m")) {
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
      if (state.destination !== "library") navigateTo("library")
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
    const compactHeight = renderer.terminalHeight < 16
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

  function handleResize(): void {
    applyResponsiveLayout()
    renderState()
  }

  renderer.keyInput.on("keypress", handleKeypress)
  renderer.on(CliRenderEvents.RESIZE, handleResize)
  const unsubscribePlayback = options.playback?.subscribe(syncPlayback)
  applyResponsiveLayout()
  renderState()

  return {
    getState: () => ({ ...state }),
    setAppleAuthStatus: (status) => {
      const shouldLoadPlaylists =
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
        leaveAlbumView()
        leavePlaylistView()
        searchGeneration++
        searchRequest?.abort()
        searchRequest = undefined
        searchTracks = []
        catalogSearch = { query: "", status: "idle", nextCursor: null }
        recommendationGeneration++
        recommendationRequest?.abort()
        recommendationRequest = undefined
        libraryPlaylistGeneration++
        libraryPlaylistRequest?.abort()
        libraryPlaylistRequest = undefined
        playlistTrackGeneration++
        playlistTrackRequest?.abort()
        playlistTrackRequest = undefined
        recommendedPlaylists = []
        libraryPlaylists = []
        recommendationState = { status: "idle", nextCursor: null }
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
      appleAuthStatus = status
      if (state.mode.type === "palette") {
        state = reduceAppState(state, {
          type: "edit-palette",
          query: state.mode.query,
        })
      }
      renderState()
      if (shouldLoadPlaylists) void loadPlaylistLanding()
    },
    destroy: () => {
      searchGeneration++
      searchRequest?.abort()
      albumGeneration++
      albumRequest?.abort()
      recommendationGeneration++
      recommendationRequest?.abort()
      libraryPlaylistGeneration++
      libraryPlaylistRequest?.abort()
      playlistTrackGeneration++
      playlistTrackRequest?.abort()
      renderer.keyInput.off("keypress", handleKeypress)
      renderer.off(CliRenderEvents.RESIZE, handleResize)
      unsubscribePlayback?.()
      app.destroyRecursively()
    },
  }
}

function text(
  renderer: CliRenderer,
  id: string,
  content: string,
  fg: string,
  bg?: string,
): TextRenderable {
  return new TextRenderable(renderer, {
    id,
    content,
    fg,
    bg,
    height: 1,
    truncate: true,
  })
}

function createOverlay(
  renderer: CliRenderer,
  id: string,
  zIndex: number,
): BoxRenderable {
  return new BoxRenderable(renderer, {
    id,
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    zIndex,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.overlay,
    visible: false,
  })
}

function createTrackRow(
  renderer: CliRenderer,
  id: string,
  backgroundColor: string,
): TrackRow {
  const box = new BoxRenderable(renderer, {
    id,
    width: "100%",
    height: 1,
    flexDirection: "row",
    columnGap: 2,
    backgroundColor,
  })
  const title = text(renderer, `${id}-title`, "", theme.text)
  const artist = text(renderer, `${id}-artist`, "", theme.text)
  const album = text(renderer, `${id}-album`, "", theme.text)
  const time = text(renderer, `${id}-time`, "", theme.text)

  title.width = "32%"
  artist.width = "24%"
  album.flexGrow = 1
  time.width = 6
  box.add(title)
  box.add(artist)
  box.add(album)
  box.add(time)
  return { box, title, artist, album, time }
}

function setTrackRowContent(
  row: TrackRow,
  content: { title: string; artist: string; album: string; time: string },
): void {
  row.title.content = content.title
  row.artist.content = content.artist
  row.album.content = content.album
  row.time.content = content.time
}

function setTrackRowColor(row: TrackRow, color: string): void {
  row.title.fg = color
  row.artist.fg = color
  row.album.fg = color
  row.time.fg = color
}

function playlistDisplayRows(
  playlists: readonly ApplePlaylist[],
): readonly PlaylistDisplayRow[] {
  const recommended = playlists.filter(
    (playlist) => playlist.apple.resourceType === "playlists",
  )
  const library = playlists.filter(
    (playlist) => playlist.apple.resourceType === "library-playlists",
  )
  return [
    ...(recommended.length > 0
      ? [{ kind: "heading" as const, title: "FOR YOU" }, ...recommended.map(
          (playlist): PlaylistDisplayRow => ({ kind: "playlist", playlist }),
        )]
      : []),
    ...(library.length > 0
      ? [{ kind: "heading" as const, title: "YOUR LIBRARY" }, ...library.map(
          (playlist): PlaylistDisplayRow => ({ kind: "playlist", playlist }),
        )]
      : []),
  ]
}

function appendUniquePlaylists<T extends ApplePlaylist>(
  current: readonly T[],
  additions: readonly T[],
): readonly T[] {
  const ids = new Set(current.map((playlist) => playlist.id))
  return [...current, ...additions.filter((playlist) => !ids.has(playlist.id))]
}

function appendUniqueTracks(
  current: readonly AppleCatalogTrack[],
  additions: readonly AppleCatalogTrack[],
): readonly AppleCatalogTrack[] {
  const ids = new Set(current.map((track) => track.id))
  return [...current, ...additions.filter((track) => !ids.has(track.id))]
}

function filterPlaylistValues(
  playlists: readonly ApplePlaylist[],
  query: string,
): readonly ApplePlaylist[] {
  const normalized = normalizeFilter(query)
  if (!normalized) return playlists
  const terms = normalized.split(/\s+/)
  return playlists.filter((playlist) => {
    const text = normalizeFilter(
      `${playlist.title} ${playlist.curator} ${playlist.description ?? ""}`,
    )
    return terms.every((term) => text.includes(term))
  })
}

function normalizeFilter(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .trim()
    .toLowerCase()
}

function playlistsLoading(
  recommended: { status: string },
  library: { status: string },
): boolean {
  return recommended.status === "loading" || library.status === "loading"
}

function playlistsLoadingMore(
  recommended: { status: string },
  library: { status: string },
): boolean {
  return recommended.status === "loadingMore" || library.status === "loadingMore"
}

function playlistsUnavailable(
  recommended: { status: string },
  library: { status: string },
  itemCount: number,
): boolean {
  return itemCount === 0 && recommended.status === "error" && library.status === "error"
}

function getRowStart(
  selectedIndex: number,
  itemCount: number,
  rowCount: number,
): number {
  if (itemCount <= rowCount) return 0
  return Math.min(
    Math.max(0, selectedIndex - Math.floor(rowCount / 2)),
    itemCount - rowCount,
  )
}

function getPaletteCommands(
  query: string,
  appleAuthStatus: AppleAuthStatus,
  canAppleAuth: boolean,
  canOpenAlbum: boolean,
  canOpenInfo: boolean,
): readonly Command[] {
  const availableCommands = commands.filter((command) => {
    if (command.id === "album") return canOpenAlbum
    if (command.id === "info") return canOpenInfo
    if (command.id === "apple-sign-in") {
      if (!canAppleAuth) return false
      return (
        appleAuthStatus.state === "signedOut" ||
        (appleAuthStatus.state === "error" &&
          [
            "authorization_invalid",
            "browser_open_failed",
            "service_unavailable",
            "session_expired",
          ].includes(appleAuthStatus.code))
      )
    }
    if (command.id === "apple-sign-out") {
      return (
        canAppleAuth &&
        (appleAuthStatus.state === "signedIn" ||
          (appleAuthStatus.state === "error" &&
            appleAuthStatus.code === "credential_delete_failed"))
      )
    }
    if (command.id === "apple-retry-restore") {
      return (
        canAppleAuth &&
        appleAuthStatus.state === "error" &&
        appleAuthStatus.code === "credential_load_failed"
      )
    }
    if (command.id === "apple-cleanup") {
      return (
        canAppleAuth &&
        appleAuthStatus.state === "error" &&
        appleAuthStatus.code === "credential_save_failed"
      )
    }
    return true
  })
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return availableCommands
  return availableCommands.filter((command) =>
    `${command.title} ${command.description} ${command.keywords}`
      .toLowerCase()
      .includes(normalizedQuery),
  )
}

function formatInfoTarget(target: InfoTarget): string {
  if (target.kind === "playlist") return formatPlaylistInfo(target.playlist)
  if (target.kind === "album") return formatAlbumInfo(target.album)

  const lines = formatTrackInfo(target.track)
  if (target.album) {
    lines.push("", "ALBUM", ...formatAlbumInfo(target.album).split("\n"))
  }
  if (target.playlist) {
    lines.push("", "PLAYLIST", ...formatPlaylistInfo(target.playlist).split("\n"))
  }
  return lines.join("\n")
}

function formatTrackInfo(track: Track): string[] {
  const lines = [safeInfoText(track.title), safeInfoText(track.artist), ""]
  infoField(lines, "Album", track.album)
  infoField(lines, "Duration", formatDuration(track.durationSeconds))
  const apple = (track as Partial<AppleCatalogTrack>).apple
  if (apple?.resourceType !== "songs") return lines

  const details = apple.details
  infoField(lines, "Released", formatInfoDate(details?.releaseDate))
  infoField(lines, "Genres", details?.genreNames?.join(", "))
  infoField(lines, "Track", details?.trackNumber)
  infoField(lines, "Disc", details?.discNumber)
  infoField(lines, "Composer", details?.composerName)
  infoField(lines, "Rating", titleCase(details?.contentRating))
  if (details?.hasLyrics !== undefined) {
    infoField(lines, "Lyrics", details.hasLyrics ? "Available" : "Unavailable")
  }
  if (details?.isAppleDigitalMaster !== undefined) {
    infoField(lines, "Master", details.isAppleDigitalMaster ? "Apple Digital Master" : "Standard")
  }
  if (track.audioQuality) {
    infoField(
      lines,
      "Audio",
      formatAudioQuality(track.audioQuality).replace(/^AUDIO\s+/, ""),
    )
  }
  if (details?.editorialNotes) {
    lines.push("", "EDITORIAL NOTES", safeInfoText(details.editorialNotes, 2_000))
  }
  return lines
}

function formatAlbumInfo(album: AppleCatalogAlbum): string {
  const lines = [safeInfoText(album.title), safeInfoText(album.artist), ""]
  const details = album.apple.details
  infoField(lines, "Released", formatInfoDate(details?.releaseDate))
  infoField(lines, "Genres", details?.genreNames?.join(", "))
  infoField(lines, "Tracks", details?.trackCount ?? album.tracks.length)
  infoField(lines, "Label", details?.recordLabel)
  infoField(lines, "Rating", titleCase(details?.contentRating))
  if (details?.isCompilation !== undefined) {
    infoField(lines, "Compilation", details.isCompilation ? "Yes" : "No")
  }
  if (details?.isSingle !== undefined) {
    infoField(lines, "Single", details.isSingle ? "Yes" : "No")
  }
  infoField(lines, "Copyright", details?.copyright)
  if (details?.editorialNotes) {
    lines.push("", "EDITORIAL NOTES", safeInfoText(details.editorialNotes, 2_000))
  }
  return lines.join("\n")
}

function formatPlaylistInfo(playlist: ApplePlaylist): string {
  const lines = [safeInfoText(playlist.title), safeInfoText(playlist.curator), ""]
  const library = playlist.apple.resourceType === "library-playlists"
  const details = playlist.apple.details
  infoField(lines, "Source", library ? "Your Library" : "For You")
  infoField(lines, "Type", titleCase(details?.playlistType))
  infoField(lines, "Updated", formatInfoDate(details?.lastModifiedDate))
  infoField(lines, "Added", formatInfoDate(details?.dateAdded))
  if (details?.isChart !== undefined) {
    infoField(lines, "Chart", details.isChart ? "Yes" : "No")
  }
  if (details?.canEdit !== undefined) {
    infoField(lines, "Editable", details.canEdit ? "Yes" : "No")
  }
  if (details?.isPublic !== undefined) {
    infoField(lines, "Visibility", details.isPublic ? "Public" : "Private")
  }
  if (details?.hasCatalog !== undefined) {
    infoField(lines, "Catalog", details.hasCatalog ? "Matched" : "Library only")
  }
  if (playlist.description) {
    lines.push("", "DESCRIPTION", safeInfoText(playlist.description, 2_000))
  }
  return lines.join("\n")
}

function infoField(
  lines: string[],
  label: string,
  value: string | number | undefined,
): void {
  if (value === undefined || value === "") return
  lines.push(`${label.padEnd(14)}${safeInfoText(String(value), 1_000)}`)
}

function safeInfoText(value: string, maxLength = 500): string {
  return value
    .slice(0, maxLength)
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
}

function formatInfoDate(value: string | undefined): string | undefined {
  if (!value) return undefined
  const date = value.match(/^\d{4}-\d{2}-\d{2}/u)?.[0]
  return date ?? value
}

function titleCase(value: string | undefined): string | undefined {
  return value
    ?.split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ")
}

function appleAuthStatusLabel(status: AppleAuthStatus): string {
  switch (status.state) {
    case "signedOut":
      return "apple music  ○ signed out"
    case "restoring":
      return "apple music  ◌ restoring"
    case "connecting":
      return "apple music  ◌ connecting"
    case "authorizing":
      return "apple music  ◌ waiting"
    case "validating":
      return "apple music  ◌ validating"
    case "saving":
      return "apple music  ◌ saving login"
    case "signedIn":
      return `apple music  ● ${status.storefront}`
    case "signingOut":
      return "apple music  ◌ signing out"
    case "error":
      if (status.code === "credential_delete_failed") {
        return "apple music  × sign out failed"
      }
      if (
        status.code === "credential_load_failed"
      ) {
        return "apple music  × keyring"
      }
      if (status.code === "credential_save_failed") {
        return "apple music  × save failed"
      }
      return "apple music  × unavailable"
  }
}

function compactAppleAuthStatusLabel(status: AppleAuthStatus): string {
  switch (status.state) {
    case "signedIn":
      return `apple ● ${status.storefront}`
    case "authorizing":
    case "connecting":
    case "validating":
    case "saving":
    case "restoring":
    case "signingOut":
      return "apple ◌ busy"
    case "signedOut":
      return "apple ○ out"
    case "error":
      if (status.code === "credential_delete_failed") return "apple × sign-out"
      if (
        status.code === "credential_load_failed"
      ) {
        return "apple × keyring"
      }
      if (status.code === "credential_save_failed") return "apple × save"
      return "apple × error"
  }
}

function isAppleAuthProgress(status: AppleAuthStatus): boolean {
  return (
    status.state === "connecting" ||
    status.state === "authorizing" ||
    status.state === "validating" ||
    status.state === "saving"
  )
}

function appleAuthProgressCopy(status: AppleAuthStatus): readonly string[] {
  switch (status.state) {
    case "connecting":
      return ["Starting a secure browser session...", "", "", "", "", "Please wait."]
    case "authorizing":
      return [
        "Continue in the browser window.",
        "Approve access with Apple Music.",
        "No pairing code is required.",
        "",
        "Return here after approval.",
        "Waiting for Apple Music...",
      ]
    case "validating":
      return ["Authorization received.", "Checking it with Apple Music...", "", "", "", "Please wait."]
    case "saving":
      return ["Authorization verified.", "Saving it to the system keyring...", "", "", "", "Please wait."]
    default:
      return []
  }
}

function appleAuthSuccessCopy(status: AppleAuthStatus): readonly string[] {
  return status.state === "signedIn"
    ? [
        "Apple Music authorization succeeded.",
        `Storefront: ${status.storefront.toUpperCase()}`,
        "Your login is stored in the system keyring.",
        "",
        "The browser tab can now be closed.",
        "Press Enter to continue.",
      ]
    : []
}

function gotoDestination(key: KeyEvent): Destination | null {
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

function destinationLabel(destination: Destination): string {
  return destination[0]!.toUpperCase() + destination.slice(1)
}

function emptyMessage(destination: Destination, baseTrackCount: number): string {
  if (destination === "queue" && baseTrackCount === 0) {
    return "queue is empty"
  }
  if (baseTrackCount === 0) {
    return destination === "search"
      ? "Apple Music search is not connected"
      : destination === "playlists"
        ? "Apple Music playlists are not loaded yet"
      : "Apple Music library is not loaded yet"
  }
  return "no tracks match this filter"
}

function searchEmptyMessage(search: {
  query: string
  status: "idle" | "loading" | "loadingMore" | "ready" | "error"
}): string {
  switch (search.status) {
    case "idle":
      return "Type a search and press Enter"
    case "loading":
    case "loadingMore":
      return "Searching Apple Music..."
    case "error":
      return "Apple Music search is unavailable"
    case "ready":
      return search.query ? `No songs found for ${search.query}` : "No songs found"
  }
}

function footerHelp(state: AppState, width = 120): string {
  if (state.mode.type === "palette") return "type commands   ↑/↓ move   enter run   esc close"
  if (state.mode.type === "help") return "? or esc close   ctrl+p commands"
  if (state.mode.type === "search") return "type query   enter search Apple Music   esc cancel"
  if (state.mode.type === "filter") return "type filter   ↑/↓ move   enter apply   esc cancel"
  if (state.mode.pendingKey === "g") {
    return "l library   p playlists   s search   q queue   esc cancel"
  }
  if (width < 64) return "↑↓ move  enter play  i info  ←→ seek"
  if (width < 100) return "j/k move  enter play  i info  space pause"
  return "j/k move   enter play   i info   space pause/resume   ←/→ seek   / filter   ctrl+p commands"
}

function searchFooterHelp(hasMore: boolean, width: number): string {
  if (width < 64) return hasMore ? "enter play  i info  m more" : "enter play  i info"
  return hasMore
    ? "enter play   i info   s search   a album   m more"
    : "enter play   i info   s search   a album"
}

function albumFooterHelp(width: number): string {
  return width < 64
    ? "enter play  i info  esc back"
    : "enter play   i info   space pause   esc search results   s search"
}

function playlistFooterHelp(hasMore: boolean, width: number): string {
  if (width < 64) return hasMore ? "enter open  i info  m more" : "enter open  i info"
  return hasMore
    ? "enter open playlist   i info   / filter   m load more   esc library"
    : "enter open playlist   i info   / filter   esc library"
}

function playlistDetailFooterHelp(hasMore: boolean, width: number): string {
  if (width < 64) return hasMore ? "enter play  i info  m more" : "enter play  i info"
  return hasMore
    ? "enter play   i info   space pause   / filter   m more   esc playlists"
    : "enter play   i info   space pause   / filter   esc playlists"
}

function playlistEmptyMessage(
  recommended: { status: string },
  library: { status: string },
  loadedCount: number,
): string {
  if (playlistsLoading(recommended, library)) return "Loading Apple Music playlists..."
  if (playlistsUnavailable(recommended, library, loadedCount)) {
    return "Apple Music playlists are unavailable"
  }
  return loadedCount > 0 ? "No playlists match this filter" : "No playlists found"
}

function playlistTrackEmptyMessage(
  status: "loading" | "ready" | "loadingMore" | "error",
): string {
  if (status === "loading") return "Loading playlist..."
  if (status === "error") return "Apple Music playlist is unavailable · esc back"
  return "This playlist has no playable songs"
}

function albumEmptyMessage(status: "loading" | "ready" | "error"): string {
  if (status === "loading") return "Loading album..."
  if (status === "error") return "Apple Music album is unavailable · esc back"
  return "This album has no tracks"
}

function appleSongResourceId(track: Track | undefined): string | null {
  const apple = (track as Partial<AppleCatalogTrack> | undefined)?.apple
  return apple?.resourceType === "songs" && typeof apple.resourceId === "string"
    ? apple.resourceId
    : null
}

function isPlayableAppleTrack(track: Track | undefined): track is AppleCatalogTrack {
  const apple = (track as Partial<AppleCatalogTrack> | undefined)?.apple
  return Boolean(
    apple?.resourceType === "songs" &&
    typeof apple.resourceId === "string" &&
    apple.playParams?.kind === "song" &&
    apple.playParams.id === apple.resourceId,
  )
}

function playbackErrorMessage(errorCode: string): string {
  if (errorCode === "authorization_rejected" || errorCode === "authorization_invalid") {
    return "Apple Music playback authorization is required"
  }
  if (errorCode === "worker_crashed" || errorCode === "worker_exited") {
    return "the playback worker stopped; press Enter to retry"
  }
  if (errorCode === "playback_timeout") return "Apple Music playback did not start"
  if (errorCode === "drm_unavailable") return "Apple Music DRM is unavailable"
  return "Apple Music could not complete the playback request"
}

function pluralize(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`
}

export function formatDuration(durationSeconds: number): string {
  const minutes = Math.floor(durationSeconds / 60)
  const seconds = Math.floor(durationSeconds % 60)
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}
