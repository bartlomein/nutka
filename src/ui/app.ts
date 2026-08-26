import {
  BoxRenderable,
  CliRenderEvents,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core"

import {
  filterTracks,
  initialState,
  reduceAppState,
  type AppAction,
  type AppState,
} from "../core/state"
import type { Track } from "../core/types"
import { theme } from "./theme"

const visibleRowCount = 8

interface NutaAppOptions {
  tracks: readonly Track[]
  onQuit: () => void
}

interface TrackRow {
  box: BoxRenderable
  title: TextRenderable
  artist: TextRenderable
  album: TextRenderable
  time: TextRenderable
}

export interface NutaApp {
  getState(): AppState
  setProviderStatus(status: string): void
  destroy(): void
}

export function createNutaApp(
  renderer: CliRenderer,
  options: NutaAppOptions,
): NutaApp {
  let state = { ...initialState }

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
  header.add(text(renderer, "brand", "nuta", theme.text))
  const providerStatus = text(
    renderer,
    "provider-status",
    "apple music  ○ demo",
    theme.muted,
  )
  header.add(providerStatus)

  const main = new BoxRenderable(renderer, {
    id: "main",
    width: "100%",
    flexGrow: 1,
    flexDirection: "row",
    overflow: "hidden",
  })

  const sidebar = new BoxRenderable(renderer, {
    id: "sidebar",
    width: 18,
    height: "100%",
    padding: 1,
    flexDirection: "column",
    gap: 1,
    border: ["right"],
    borderColor: theme.border,
  })
  sidebar.add(text(renderer, "library-title", "library", theme.muted))
  sidebar.add(text(renderer, "nav-home", "1  home", theme.muted))
  sidebar.add(text(renderer, "nav-search", "2  search", theme.accent))
  sidebar.add(text(renderer, "nav-library", "3  library", theme.muted))
  sidebar.add(text(renderer, "nav-playlists", "4  playlists", theme.muted))
  sidebar.add(text(renderer, "nav-queue", "5  queue", theme.muted))

  const results = new BoxRenderable(renderer, {
    id: "results",
    minWidth: 38,
    height: "100%",
    flexGrow: 1,
    padding: 1,
    flexDirection: "column",
    border: ["right"],
    borderColor: theme.border,
    overflow: "hidden",
  })
  results.add(text(renderer, "search-title", "Search", theme.text))

  const searchLine = text(renderer, "search-line", "/ ", theme.text)
  searchLine.height = 2
  results.add(searchLine)

  const tableHeader = createTrackRow(renderer, "table-header", theme.background)
  setTrackRowContent(tableHeader, {
    title: "track",
    artist: "artist",
    album: "album",
    time: "time",
  })
  setTrackRowColor(tableHeader, theme.muted)
  results.add(tableHeader.box)

  const trackRows = Array.from({ length: visibleRowCount }, (_, index) => {
    const row = createTrackRow(renderer, `track-${index}`, theme.background)
    results.add(row.box)
    return row
  })

  const queue = new BoxRenderable(renderer, {
    id: "queue",
    width: 27,
    height: "100%",
    padding: 1,
    flexDirection: "column",
    gap: 1,
    overflow: "hidden",
  })
  queue.add(text(renderer, "queue-title", "up next", theme.accent))

  const queueLines = Array.from({ length: 5 }, (_, index) => {
    const line = text(renderer, `queue-${index}`, "", theme.text)
    queue.add(line)
    return line
  })

  main.add(sidebar)
  main.add(results)
  main.add(queue)

  const nowPlaying = new BoxRenderable(renderer, {
    id: "now-playing",
    width: "100%",
    height: 7,
    padding: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    border: ["top"],
    borderColor: theme.border,
    backgroundColor: theme.surface,
  })

  const trackInfo = new BoxRenderable(renderer, {
    id: "track-info",
    width: "38%",
    flexDirection: "column",
  })
  const nowPlayingTitle = text(
    renderer,
    "now-playing-title",
    "nothing playing",
    theme.accent,
  )
  const nowPlayingDetails = text(
    renderer,
    "now-playing-details",
    "press enter on a track",
    theme.muted,
  )
  trackInfo.add(nowPlayingTitle)
  trackInfo.add(nowPlayingDetails)

  const progressInfo = new BoxRenderable(renderer, {
    id: "progress-info",
    flexGrow: 1,
    flexDirection: "column",
    alignItems: "center",
  })
  const progressTime = text(renderer, "progress-time", "0:00 / 0:00", theme.amber)
  const progressBar = text(
    renderer,
    "progress-bar",
    "────────────────────────────",
    theme.muted,
  )
  progressInfo.add(progressTime)
  progressInfo.add(progressBar)

  nowPlaying.add(trackInfo)
  nowPlaying.add(progressInfo)

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
  const keyHelp = text(
    renderer,
    "key-help",
    "j/k move   enter play   space pause   / search   q quit",
    theme.muted,
  )
  const quality = text(renderer, "quality", "demo catalog", theme.amber)
  footer.add(mode)
  footer.add(keyHelp)
  footer.add(quality)

  app.add(header)
  app.add(main)
  app.add(nowPlaying)
  app.add(footer)
  renderer.root.add(app)

  function dispatch(action: AppAction): void {
    state = reduceAppState(state, action)
    renderState()
  }

  function renderState(): void {
    const filteredTracks = filterTracks(options.tracks, state.query)
    const selectedTrack = filteredTracks[state.selectedIndex]
    const currentTrack = options.tracks.find(
      (track) => track.id === state.currentTrackId,
    )

    searchLine.content =
      state.inputMode === "search"
        ? `/ ${state.query}_`
        : `/ ${state.query || "search catalog"}`
    searchLine.fg =
      state.inputMode === "search" ? theme.accent : theme.muted

    const rowStart = getRowStart(
      state.selectedIndex,
      filteredTracks.length,
      visibleRowCount,
    )

    trackRows.forEach((row, rowIndex) => {
      const trackIndex = rowStart + rowIndex
      const track = filteredTracks[trackIndex]

      if (!track) {
        row.box.visible = rowIndex === 0 && filteredTracks.length === 0
        setTrackRowContent(row, {
          title: row.box.visible ? "no tracks match this search" : "",
          artist: "",
          album: "",
          time: "",
        })
        row.box.backgroundColor = theme.background
        setTrackRowColor(row, theme.muted)
        return
      }

      row.box.visible = true
      setTrackRowContent(row, {
        title: `${trackIndex === state.selectedIndex ? "›" : " "} ${track.title}`,
        artist: track.artist,
        album: track.album,
        time: formatDuration(track.durationSeconds),
      })
      row.box.backgroundColor =
        trackIndex === state.selectedIndex ? theme.selection : theme.background
      setTrackRowColor(
        row,
        trackIndex === state.selectedIndex ? theme.text : theme.muted,
      )
    })

    const upcomingTracks = getUpcomingTracks(
      options.tracks,
      currentTrack?.id ?? selectedTrack?.id,
      queueLines.length,
    )
    queueLines.forEach((line, index) => {
      const track = upcomingTracks[index]
      line.content = track
        ? `${index + 1}  ${track.title}  ${formatDuration(track.durationSeconds)}`
        : ""
      line.visible = Boolean(track)
    })

    if (currentTrack) {
      const statusIcon = state.playbackStatus === "playing" ? "▶" : "Ⅱ"
      nowPlayingTitle.content = `${statusIcon}  ${currentTrack.title}`
      nowPlayingDetails.content = `${currentTrack.artist} · ${currentTrack.album}`
      progressTime.content = `1:42 / ${formatDuration(currentTrack.durationSeconds)}`
      progressBar.content =
        state.playbackStatus === "playing"
          ? "━━━━━━━━━━╸─────────────────"
          : "━━━━━━━━━━┃─────────────────"
    } else {
      nowPlayingTitle.content = "nothing playing"
      nowPlayingDetails.content = "press enter on a track"
      progressTime.content = "0:00 / 0:00"
      progressBar.content = "────────────────────────────"
    }

    mode.content = state.inputMode === "search" ? "INSERT" : "NORMAL"
    keyHelp.content =
      state.inputMode === "search"
        ? "type to filter   enter accept   esc normal"
        : "j/k move   enter play   space pause   / search   q quit"
  }

  function handleKeypress(key: KeyEvent): void {
    if (key.eventType === "release") return

    if (state.inputMode === "search") {
      if (key.name === "return" || key.name === "enter") {
        dispatch({ type: "finish-search" })
        return
      }

      if (key.name === "escape") {
        dispatch({ type: "finish-search" })
        return
      }

      if (key.name === "backspace") {
        dispatch({ type: "set-query", query: state.query.slice(0, -1) })
        return
      }

      if (
        key.sequence.length === 1 &&
        !key.ctrl &&
        !key.meta &&
        key.sequence >= " "
      ) {
        dispatch({ type: "set-query", query: state.query + key.sequence })
      }
      return
    }

    const filteredTracks = filterTracks(options.tracks, state.query)
    const selectedTrack = filteredTracks[state.selectedIndex]

    if (key.name === "j" || key.name === "down") {
      dispatch({ type: "move", delta: 1, itemCount: filteredTracks.length })
      return
    }

    if (key.name === "k" || key.name === "up") {
      dispatch({ type: "move", delta: -1, itemCount: filteredTracks.length })
      return
    }

    if (key.name === "return" || key.name === "enter") {
      dispatch({ type: "play", trackId: selectedTrack?.id ?? null })
      return
    }

    if (key.name === "space" || key.sequence === " ") {
      dispatch({
        type: "toggle-playback",
        selectedTrackId: selectedTrack?.id ?? null,
      })
      return
    }

    if (key.name === "/" || key.sequence === "/") {
      dispatch({ type: "begin-search" })
      return
    }

    if (key.name === "q") {
      options.onQuit()
    }
  }

  function applyResponsiveLayout(): void {
    sidebar.visible = renderer.terminalWidth >= 64
    sidebar.width = renderer.terminalWidth >= 100 ? 18 : 15
    queue.visible = renderer.terminalWidth >= 92
    nowPlaying.height = renderer.terminalHeight >= 25 ? 7 : 5
    quality.visible = renderer.terminalWidth >= 80
  }

  renderer.keyInput.on("keypress", handleKeypress)
  renderer.on(CliRenderEvents.RESIZE, applyResponsiveLayout)
  applyResponsiveLayout()
  renderState()

  return {
    getState: () => ({ ...state }),
    setProviderStatus: (status) => {
      providerStatus.content = status
    },
    destroy: () => {
      renderer.keyInput.off("keypress", handleKeypress)
      renderer.off(CliRenderEvents.RESIZE, applyResponsiveLayout)
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

function getUpcomingTracks(
  tracks: readonly Track[],
  currentTrackId: string | undefined,
  count: number,
): readonly Track[] {
  const currentIndex = tracks.findIndex((track) => track.id === currentTrackId)
  const startIndex = currentIndex >= 0 ? currentIndex + 1 : 0

  return Array.from({ length: Math.min(count, tracks.length) }, (_, index) =>
    tracks[(startIndex + index) % tracks.length],
  ).filter((track): track is Track => Boolean(track))
}

export function formatDuration(durationSeconds: number): string {
  const minutes = Math.floor(durationSeconds / 60)
  const seconds = durationSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}
