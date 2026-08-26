import type { BoxRenderable, CliRenderer } from "@opentui/core"

import type { AudioSpectrumFrame, PlaybackStatus } from "../../core/types"

export type VisualizerKind = "spectrum"

export interface VisualizerPalette {
  low: string
  mid: string
  high: string
  peak: string
}

export interface VisualizerOptions {
  kind: VisualizerKind
  palette: VisualizerPalette
  height?: number
}

export interface VisualizerComponent {
  root: BoxRenderable
  renderStatus(status: PlaybackStatus): void
  renderFrame(frame: AudioSpectrumFrame | null): void
  applyResponsiveLayout(width: number, compactHeight: boolean): void
}

export type VisualizerFactory = (
  renderer: CliRenderer,
  options: VisualizerOptions,
) => VisualizerComponent
