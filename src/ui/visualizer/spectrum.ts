import {
  BoxRenderable,
  StyledText,
  TextRenderable,
  dim,
  fg,
  type CliRenderer,
  type TextChunk,
} from "@opentui/core"

import type { AudioSpectrumFrame, PlaybackStatus } from "../../core/types"
import type {
  VisualizerComponent,
  VisualizerOptions,
  VisualizerPalette,
} from "./types"

const fractionalBlocks = " ▁▂▃▄▅▆▇█"

export function createSpectrumVisualizer(
  renderer: CliRenderer,
  options: VisualizerOptions,
): VisualizerComponent {
  const height = Math.max(1, Math.min(8, Math.floor(options.height ?? 3)))
  let terminalWidth = renderer.terminalWidth
  let compactHeight = false
  let status: PlaybackStatus = "idle"
  let frame: AudioSpectrumFrame | null = null

  const root = new BoxRenderable(renderer, {
    id: "player-visualizer",
    width: "100%",
    height,
    flexDirection: "row",
    justifyContent: "center",
  })
  const spectrum = new TextRenderable(renderer, {
    id: "player-spectrum",
    content: "",
    width: spectrumWidth(terminalWidth),
    height,
    truncate: true,
  })
  root.add(spectrum)

  function update(): void {
    const width = spectrumWidth(terminalWidth)
    spectrum.width = width
    spectrum.content = frame && status !== "idle"
      ? formatSpectrumFrame(frame.bands, width, height, options.palette, status === "paused")
      : ""
  }

  function renderStatus(nextStatus: PlaybackStatus): void {
    status = nextStatus
    update()
  }

  function renderFrame(nextFrame: AudioSpectrumFrame | null): void {
    frame = nextFrame
    update()
    renderer.requestRender()
  }

  function applyResponsiveLayout(width: number, isCompactHeight: boolean): void {
    terminalWidth = width
    compactHeight = isCompactHeight
    root.visible = !compactHeight
    update()
  }

  applyResponsiveLayout(terminalWidth, compactHeight)
  return { root, renderStatus, renderFrame, applyResponsiveLayout }
}

export function formatSpectrumFrame(
  bands: readonly number[],
  width: number,
  height: number,
  palette: VisualizerPalette,
  dimmed = false,
): StyledText {
  const barCount = Math.max(1, Math.floor(width))
  const rowCount = Math.max(1, Math.floor(height))
  const resampled = resampleSpectrum(bands, barCount)
  const chunks: TextChunk[] = []

  for (let row = 0; row < rowCount; row++) {
    for (let index = 0; index < resampled.length; index++) {
      const value = resampled[index]!
      const totalSteps = Math.round(value / 255 * rowCount * 8)
      const stepsBelow = (rowCount - row - 1) * 8
      const fill = Math.max(0, Math.min(8, totalSteps - stepsBelow))
      const glyph = fractionalBlocks[fill] ?? " "
      const frequencyColor = interpolatePaletteColor(
        index / Math.max(1, resampled.length - 1),
        palette,
      )
      const tipRow = fill > 0 && totalSteps <= stepsBelow + 8
      const color = tipRow && value >= 224 ? palette.peak : frequencyColor
      const chunk = fg(color)(glyph)
      chunks.push(dimmed ? dim(chunk) : chunk)
    }
    if (row < rowCount - 1) chunks.push(fg(palette.low)("\n"))
  }

  return new StyledText(chunks)
}

export function resampleSpectrum(
  bands: readonly number[],
  targetLength: number,
): readonly number[] {
  const length = Math.max(1, Math.floor(targetLength))
  if (bands.length === 0) return Array.from({ length }, () => 0)
  if (bands.length === length) return bands.map(clampByte)

  if (length < bands.length) {
    return Array.from({ length }, (_, index) => {
      const start = Math.floor(index * bands.length / length)
      const end = Math.max(start + 1, Math.floor((index + 1) * bands.length / length))
      let maximum = 0
      for (let source = start; source < Math.min(end, bands.length); source++) {
        maximum = Math.max(maximum, clampByte(bands[source] ?? 0))
      }
      return maximum
    })
  }

  return Array.from({ length }, (_, index) => {
    const sourcePosition = index * (bands.length - 1) / Math.max(1, length - 1)
    const left = Math.floor(sourcePosition)
    const right = Math.min(bands.length - 1, left + 1)
    const ratio = sourcePosition - left
    return Math.round(
      clampByte(bands[left] ?? 0) * (1 - ratio) +
      clampByte(bands[right] ?? 0) * ratio,
    )
  })
}

function spectrumWidth(terminalWidth: number): number {
  return Math.max(16, Math.min(96, terminalWidth - 24))
}

function interpolatePaletteColor(
  position: number,
  palette: VisualizerPalette,
): string {
  if (position <= 0.5) return interpolateHex(palette.low, palette.mid, position * 2)
  return interpolateHex(palette.mid, palette.high, (position - 0.5) * 2)
}

function interpolateHex(start: string, end: string, ratio: number): string {
  const startColor = parseHex(start)
  const endColor = parseHex(end)
  if (!startColor || !endColor) return ratio < 0.5 ? start : end
  const channel = (index: number): string =>
    Math.round(startColor[index]! + (endColor[index]! - startColor[index]!) * ratio)
      .toString(16)
      .padStart(2, "0")
  return `#${channel(0)}${channel(1)}${channel(2)}`
}

function parseHex(value: string): readonly [number, number, number] | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value)
  return match
    ? [Number.parseInt(match[1]!, 16), Number.parseInt(match[2]!, 16), Number.parseInt(match[3]!, 16)]
    : null
}

function clampByte(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(255, Math.round(value))) : 0
}
