import {
  BoxRenderable,
  TextRenderable,
  type CliRenderer,
  type MouseEvent,
} from "@opentui/core"

import type {
  AudioSpectrumFrame,
  PlaybackRepeatMode,
  PlaybackShuffleMode,
  PlaybackSource,
  PlaybackStatus,
  Track,
} from "../core/types"
import { createAudioQualityBadge } from "./audio-quality"
import { theme } from "./theme"
import {
  createVisualizer,
  type VisualizerSettings,
} from "./visualizer"
import { resolveVisualizerPalette } from "./visualizer/palettes"
import { defaultVisualizerSettings } from "./visualizer/preferences"

export interface PlayerPanelState {
  status: PlaybackStatus
  currentTrack: Track | null
  queue: readonly Track[]
  positionSeconds: number
  durationSeconds: number | null
  errorMessage: string | null
  connected: boolean
  shuffleMode: PlaybackShuffleMode
  repeatMode: PlaybackRepeatMode
  canSetShuffleMode: boolean
  canSetRepeatMode: boolean
  source?: PlaybackSource | null
  dynamicQueue?: boolean
  canSeek?: boolean
  canSkipNext?: boolean
  canSkipPrevious?: boolean
  liked: boolean
  likeStatus: "unavailable" | "loading" | "ready" | "saving" | "error"
}

export interface PlayerPanel {
  root: BoxRenderable
  render(state: PlayerPanelState): void
  renderAudioAnalysis(frame: AudioSpectrumFrame | null): void
  setVisualizerEnabled(enabled: boolean): void
  setVisualizerSettings(settings: VisualizerSettings): void
  applyResponsiveLayout(width: number, compactHeight: boolean): void
}

export interface PlayerPanelOptions {
  onSeek?: (positionSeconds: number) => void
  visualizer?: VisualizerSettings
}

export function createPlayerPanel(
  renderer: CliRenderer,
  options: PlayerPanelOptions = {},
): PlayerPanel {
  let terminalWidth = renderer.terminalWidth
  let contentWidth = renderer.terminalWidth
  let compactHeight = false
  let visualizerEnabled = true
  let visualizerSettings = options.visualizer ?? defaultVisualizerSettings
  let progressDuration: number | null = null
  let progressWidth = 4
  let progressBarOffset = 6
  let latestState: PlayerPanelState | undefined

  const root = new BoxRenderable(renderer, {
    id: "now-playing",
    width: "100%",
    height: 8,
    paddingX: 2,
    flexDirection: "column",
    border: ["top"],
    borderColor: theme.border,
    backgroundColor: theme.background,
  })

  const primary = playerRow(renderer, "player-primary", "center")
  const status = playerText(renderer, "player-status", "○", theme.muted)
  const title = playerText(renderer, "now-playing-title", "nothing playing", theme.text)
  status.width = 3
  primary.add(status)
  primary.add(title)
  const compactModes = playerText(renderer, "player-compact-modes", "", theme.accent)
  compactModes.visible = false
  primary.add(compactModes)

  const metadata = playerRow(renderer, "player-metadata", "center")
  const details = playerText(
    renderer,
    "now-playing-details",
    "select an Apple Music song and press Enter",
    theme.muted,
  )
  metadata.add(details)

  const visualizer = createVisualizer(renderer, {
    settings: visualizerSettings,
    palette: resolveVisualizerPalette(visualizerSettings.palette, theme),
  })
  visualizer.root.border = ["top"]
  visualizer.root.borderColor = theme.border
  visualizer.root.title = " SPECTRUM  ·  v toggle  ·  shift+v configure "
  visualizer.root.titleColor = theme.accent

  const progressRow = playerRow(renderer, "player-progress-row", "center")
  const progress = playerText(renderer, "player-progress", "", theme.muted)
  progress.onMouseDown = seekFromPointer
  progress.onMouseDrag = seekFromPointer
  progressRow.add(progress)

  const context = playerRow(renderer, "player-context")
  const next = playerText(renderer, "player-next", "", theme.muted)
  const controls = new BoxRenderable(renderer, {
    id: "player-controls",
    width: 33,
    height: 1,
    flexDirection: "row",
    justifyContent: "center",
    columnGap: 1,
  })
  const previousControl = playerText(renderer, "player-previous", "│◀", theme.muted)
  const shuffleControl = playerText(renderer, "player-shuffle", "", theme.muted)
  const playPauseControl = playerText(renderer, "player-play-pause", "○", theme.muted)
  const nextControl = playerText(renderer, "player-next-control", "▶│", theme.muted)
  const repeatControl = playerText(renderer, "player-repeat", "", theme.muted)
  previousControl.width = 2
  shuffleControl.width = 12
  playPauseControl.width = 1
  nextControl.width = 2
  repeatControl.width = 12
  const quality = createAudioQualityBadge(renderer)
  next.flexGrow = 1
  controls.add(shuffleControl)
  controls.add(previousControl)
  controls.add(playPauseControl)
  controls.add(nextControl)
  controls.add(repeatControl)
  context.add(next)
  context.add(controls)
  context.add(quality.root)

  root.add(primary)
  root.add(metadata)
  root.add(visualizer.root)
  root.add(progressRow)
  root.add(context)

  function render(state: PlayerPanelState): void {
    latestState = state
    const track = state.currentTrack
    const duration = state.durationSeconds ?? track?.durationSeconds ?? null
    progressDuration = state.canSeek !== false && track && duration !== null && duration > 0
      ? duration
      : null
    progressWidth = progressBarWidth(contentWidth)
    const position = finiteSeconds(state.positionSeconds)
    const boundedPosition = duration !== null && duration > 0
      ? Math.min(position, duration)
      : position
    progressBarOffset = formatPlayerTime(boundedPosition).length + 2
    const statusColor = state.errorMessage
      ? theme.amber
      : state.status === "playing"
        ? theme.accent
        : state.status === "paused"
          ? theme.amber
          : theme.muted

    root.borderColor = theme.border
    status.fg = statusColor
    progress.fg = statusColor
    title.fg = track ? theme.text : state.errorMessage ? theme.amber : theme.muted
    previousControl.fg = track && state.canSkipPrevious !== false ? theme.accent : theme.muted
    playPauseControl.fg = track ? theme.accent : theme.muted
    nextControl.fg = state.canSkipNext !== false && (
        state.queue.length > 0 || state.repeatMode !== "none" || state.dynamicQueue
      )
      ? theme.accent
      : theme.muted

    status.content = state.errorMessage
      ? "×"
      : state.status === "playing"
        ? "▶"
        : state.status === "paused"
          ? "Ⅱ"
          : "○"
    title.content = track
      ? `${likeStatusPrefix(state)}${track.title}`
      : state.errorMessage
        ? "playback unavailable"
          : "nothing playing"
    playPauseControl.content = state.status === "playing"
      ? "Ⅱ"
      : state.status === "paused"
        ? "▶"
        : "○"
    const stationContext = state.source?.type === "station"
      ? `${state.source.isLive ? "LIVE" : "RADIO"} ${state.source.title}`
      : null
    details.content = track
      ? `${stationContext ? `${stationContext}  ·  ` : ""}${track.artist}  ·  ${track.album}`
      : stationContext
        ? stationContext
      : state.errorMessage
        ? state.errorMessage
        : state.connected
          ? "select an Apple Music song and press Enter"
          : "playback worker is not connected yet"
    progress.content = formatProgressLine(
      state.positionSeconds,
      duration,
      progressWidth,
      Boolean(track),
    )

    const nextTrack = state.queue[0]
    if (track && state.repeatMode === "one") {
      next.content = "NEXT  repeat current song"
    } else if (nextTrack) {
      next.content = `NEXT  ${nextTrack.title}  ·  ${nextTrack.artist}`
    } else if (track && state.repeatMode === "all") {
      next.content = "NEXT  queue repeats"
    } else if (track && state.dynamicQueue) {
      next.content = "QUEUE  radio continues"
    } else {
      next.content = track ? "QUEUE  end of queue" : ""
    }
    quality.render(track?.audioQuality ?? null)
    renderModeControls(state)
    visualizer.renderStatus(state.status)
  }

  function renderModeControls(state: PlayerPanelState): void {
    const wide = terminalWidth >= 94
    const shuffleActive = state.shuffleMode === "songs"
    const repeatActive = state.repeatMode !== "none"
    const showShuffle = state.canSetShuffleMode || shuffleActive
    const showRepeat = state.canSetRepeatMode || repeatActive
    shuffleControl.content = showShuffle
      ? wide
        ? ` SHUFFLE ${shuffleActive ? "ON " : "OFF"}`
        : `S:${shuffleActive ? "ON " : "OFF"}`
      : ""
    repeatControl.content = showRepeat
      ? wide
        ? ` REPEAT ${repeatModeLabel(state.repeatMode, true)}`
        : `R:${repeatModeLabel(state.repeatMode, false)}`
      : ""
    shuffleControl.fg = shuffleActive ? theme.background : theme.muted
    shuffleControl.bg = shuffleActive ? theme.accent : theme.background
    repeatControl.fg = repeatActive ? theme.background : theme.muted
    repeatControl.bg = repeatActive ? theme.accent : theme.background

    const shuffleWidth = showShuffle ? wide ? 12 : 5 : 0
    const repeatWidth = showRepeat ? wide ? 12 : 6 : 0
    shuffleControl.width = shuffleWidth
    repeatControl.width = repeatWidth
    controls.width = 9 + shuffleWidth + repeatWidth
    const compactLabel = [
      shuffleActive ? "[S:on]" : "",
      state.repeatMode === "all" ? "[R:all]" : state.repeatMode === "one" ? "[R:1]" : "",
    ].filter(Boolean).join(" ")
    compactModes.content = compactLabel
    compactModes.width = compactLabel.length
    const showCompactModes = compactHeight && compactLabel.length > 0
    compactModes.visible = showCompactModes
    primary.justifyContent = showCompactModes ? "space-between" : "center"
    title.flexGrow = showCompactModes ? 1 : 0
    title.width = showCompactModes
      ? Math.max(1, terminalWidth - compactLabel.length - 5)
      : "auto"
  }

  function renderAudioAnalysis(frame: AudioSpectrumFrame | null): void {
    if (!visualizerEnabled) return
    visualizer.renderFrame(frame)
  }

  function setVisualizerEnabled(enabled: boolean): void {
    if (enabled === visualizerEnabled) return
    visualizerEnabled = enabled
    if (!enabled) visualizer.renderFrame(null)
    applyResponsiveLayout(terminalWidth, compactHeight)
    renderer.requestRender()
  }

  function setVisualizerSettings(settings: VisualizerSettings): void {
    visualizerSettings = settings
    visualizer.applyOptions({
      settings,
      palette: resolveVisualizerPalette(settings.palette, theme),
    })
    applyResponsiveLayout(terminalWidth, compactHeight)
    renderer.requestRender()
  }

  function seekFromPointer(event: MouseEvent): void {
    if (event.button !== 0 || progressDuration === null || !options.onSeek) return
    const barStart = progress.screenX + progressBarOffset
    const ratio = Math.max(0, Math.min(1, (event.x - barStart) / (progressWidth - 1)))
    options.onSeek(ratio * progressDuration)
    event.preventDefault()
    event.stopPropagation()
  }

  function applyResponsiveLayout(width: number, isCompactHeight: boolean): void {
    terminalWidth = renderer.terminalWidth
    contentWidth = width
    compactHeight = isCompactHeight
    root.height = compactHeight ? 3 : visualizerEnabled ? 5 + visualizerSettings.height : 5
    root.paddingX = compactHeight ? 1 : 2
    primary.justifyContent = "center"
    title.flexGrow = 0
    title.width = "auto"
    metadata.visible = !compactHeight
    context.visible = !compactHeight
    status.width = 3
    if (latestState) renderModeControls(latestState)
    quality.applyResponsiveLayout(contentWidth, compactHeight)
    visualizer.applyResponsiveLayout(contentWidth, compactHeight || !visualizerEnabled)
  }

  applyResponsiveLayout(terminalWidth, compactHeight)
  return {
    root,
    render,
    renderAudioAnalysis,
    setVisualizerEnabled,
    setVisualizerSettings,
    applyResponsiveLayout,
  }
}

function likeStatusPrefix(state: PlayerPanelState): string {
  switch (state.likeStatus) {
    case "unavailable":
      return ""
    case "loading":
      return "◌  "
    case "ready":
      return state.liked ? "★  " : "☆  "
    case "saving":
      return state.liked ? "★  " : "☆  "
    case "error":
      return state.liked ? "★  " : "☆  "
  }
}

function repeatModeLabel(mode: PlaybackRepeatMode, wide: boolean): string {
  if (mode === "all") return wide ? "ALL " : "ALL"
  if (mode === "one") return wide ? "1   " : "1"
  return wide ? "OFF " : "OFF"
}

export function formatProgressLine(
  positionSeconds: number,
  durationSeconds: number | null,
  barWidth: number,
  active: boolean,
): string {
  const position = finiteSeconds(positionSeconds)
  const duration = durationSeconds === null ? null : finiteSeconds(durationSeconds)
  const boundedPosition = duration && duration > 0
    ? Math.min(position, duration)
    : position
  const elapsed = formatPlayerTime(boundedPosition)
  const total = duration === null ? "--:--" : formatPlayerTime(duration)
  const width = Math.max(4, barWidth)
  if (!active || !duration || duration <= 0) {
    return `${elapsed}  ${"─".repeat(width)}  ${total}`
  }

  const ratio = boundedPosition / duration
  const marker = Math.min(width - 1, Math.round(ratio * (width - 1)))
  return `${elapsed}  ${"━".repeat(marker)}●${"─".repeat(width - marker - 1)}  ${total}`
}

function playerRow(
  renderer: CliRenderer,
  id: string,
  justifyContent: "center" | "space-between" = "space-between",
): BoxRenderable {
  return new BoxRenderable(renderer, {
    id,
    width: "100%",
    height: 1,
    flexDirection: "row",
    justifyContent,
  })
}

function playerText(
  renderer: CliRenderer,
  id: string,
  content: string,
  fg: string,
): TextRenderable {
  return new TextRenderable(renderer, {
    id,
    content,
    fg,
    height: 1,
    truncate: true,
  })
}

function progressBarWidth(terminalWidth: number): number {
  return Math.max(4, Math.min(72, terminalWidth - (terminalWidth < 56 ? 18 : 22)))
}

function finiteSeconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function formatPlayerTime(durationSeconds: number): string {
  const minutes = Math.floor(durationSeconds / 60)
  const seconds = durationSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}
