import {
  BoxRenderable,
  TextRenderable,
  type CliRenderer,
  type MouseEvent,
} from "@opentui/core"

import type { AudioSpectrumFrame, PlaybackStatus, Track } from "../core/types"
import { createAudioQualityBadge } from "./audio-quality"
import { theme } from "./theme"
import { createVisualizer, type VisualizerOptions } from "./visualizer"

export interface PlayerPanelState {
  status: PlaybackStatus
  currentTrack: Track | null
  queue: readonly Track[]
  positionSeconds: number
  durationSeconds: number | null
  errorMessage: string | null
  connected: boolean
  randomAvailable: boolean
}

export interface PlayerPanel {
  root: BoxRenderable
  render(state: PlayerPanelState): void
  renderAudioAnalysis(frame: AudioSpectrumFrame | null): void
  setVisualizerEnabled(enabled: boolean): void
  applyResponsiveLayout(width: number, compactHeight: boolean): void
}

export interface PlayerPanelOptions {
  onSeek?: (positionSeconds: number) => void
  visualizer?: VisualizerOptions
}

export function createPlayerPanel(
  renderer: CliRenderer,
  options: PlayerPanelOptions = {},
): PlayerPanel {
  let terminalWidth = renderer.terminalWidth
  let compactHeight = false
  let visualizerEnabled = true
  let progressDuration: number | null = null
  let progressWidth = 4
  let progressBarOffset = 6

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

  const metadata = playerRow(renderer, "player-metadata", "center")
  const details = playerText(
    renderer,
    "now-playing-details",
    "select an Apple Music song and press Enter",
    theme.muted,
  )
  metadata.add(details)

  const visualizer = createVisualizer(renderer, options.visualizer ?? {
    kind: "spectrum",
    height: 3,
    palette: {
      low: theme.visualizerLow,
      mid: theme.visualizerMid,
      high: theme.visualizerHigh,
      peak: theme.visualizerPeak,
    },
  })

  const progressRow = playerRow(renderer, "player-progress-row", "center")
  const progress = playerText(renderer, "player-progress", "", theme.muted)
  progress.onMouseDown = seekFromPointer
  progress.onMouseDrag = seekFromPointer
  progressRow.add(progress)

  const context = playerRow(renderer, "player-context")
  const next = playerText(renderer, "player-next", "", theme.muted)
  const controls = new BoxRenderable(renderer, {
    id: "player-controls",
    width: 12,
    height: 1,
    flexDirection: "row",
    justifyContent: "center",
    columnGap: 2,
  })
  const previousControl = playerText(renderer, "player-previous", "│◀", theme.muted)
  const randomControl = playerText(renderer, "player-random", "⇄", theme.muted)
  const nextControl = playerText(renderer, "player-next-control", "▶│", theme.muted)
  previousControl.width = 2
  randomControl.width = 1
  nextControl.width = 2
  const quality = createAudioQualityBadge(renderer)
  next.flexGrow = 1
  controls.add(previousControl)
  controls.add(randomControl)
  controls.add(nextControl)
  context.add(next)
  context.add(controls)
  context.add(quality.root)

  root.add(primary)
  root.add(metadata)
  root.add(visualizer.root)
  root.add(progressRow)
  root.add(context)

  function render(state: PlayerPanelState): void {
    const track = state.currentTrack
    const duration = state.durationSeconds ?? track?.durationSeconds ?? null
    progressDuration = track && duration !== null && duration > 0 ? duration : null
    progressWidth = progressBarWidth(terminalWidth)
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
    previousControl.fg = track ? theme.accent : theme.muted
    randomControl.fg = state.randomAvailable ? theme.accent : theme.muted
    nextControl.fg = state.queue.length > 0 ? theme.accent : theme.muted

    status.content = state.errorMessage
      ? "×"
      : state.status === "playing"
        ? "▶"
        : state.status === "paused"
          ? "Ⅱ"
          : "○"
    title.content = track
      ? track.title
      : state.errorMessage
        ? "playback unavailable"
        : "nothing playing"
    details.content = track
      ? `${track.artist}  ·  ${track.album}`
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
    next.content = nextTrack
      ? `NEXT  ${nextTrack.title}  ·  ${nextTrack.artist}`
      : track
        ? "QUEUE  end of queue"
        : ""
    quality.render(track?.audioQuality ?? null)
    visualizer.renderStatus(state.status)
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

  function seekFromPointer(event: MouseEvent): void {
    if (event.button !== 0 || progressDuration === null || !options.onSeek) return
    const barStart = progress.screenX + progressBarOffset
    const ratio = Math.max(0, Math.min(1, (event.x - barStart) / (progressWidth - 1)))
    options.onSeek(ratio * progressDuration)
    event.preventDefault()
    event.stopPropagation()
  }

  function applyResponsiveLayout(width: number, isCompactHeight: boolean): void {
    terminalWidth = width
    compactHeight = isCompactHeight
    root.height = compactHeight ? 3 : visualizerEnabled ? 8 : 5
    root.paddingX = compactHeight ? 1 : 2
    metadata.visible = !compactHeight
    context.visible = !compactHeight
    status.width = 3
    quality.applyResponsiveLayout(width, compactHeight)
    visualizer.applyResponsiveLayout(width, compactHeight || !visualizerEnabled)
  }

  applyResponsiveLayout(terminalWidth, compactHeight)
  return {
    root,
    render,
    renderAudioAnalysis,
    setVisualizerEnabled,
    applyResponsiveLayout,
  }
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
