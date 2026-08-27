import type { BoxRenderable, CliRenderer } from "@opentui/core"

import type { AudioSpectrumFrame, PlaybackStatus } from "../../core/types"

export type VisualizerKind = "spectrum"

export type SpectrumVisualizerStyle = "dense" | "spaced" | "wide"

export type VisualizerPaletteName =
  | "theme"
  | "monochrome"
  | "warm"
  | "cool"
  | "spectrum"

export type VisualizerHeight = 2 | 3 | 4

export interface SpectrumVisualizerSettings {
  kind: "spectrum"
  style: SpectrumVisualizerStyle
  palette: VisualizerPaletteName
  height: VisualizerHeight
}

export type VisualizerSettings = SpectrumVisualizerSettings

export interface VisualizerPalette {
  low: string
  mid: string
  high: string
  peak: string
}

export interface VisualizerOptions {
  settings: VisualizerSettings
  palette: VisualizerPalette
}

export interface VisualizerComponent {
  root: BoxRenderable
  renderStatus(status: PlaybackStatus): void
  renderFrame(frame: AudioSpectrumFrame | null): void
  applyOptions(options: VisualizerOptions): void
  applyResponsiveLayout(width: number, compactHeight: boolean): void
}

export interface VisualizerChoice<T extends string> {
  value: T
  label: string
}

export interface VisualizerDefinition {
  kind: VisualizerKind
  label: string
  requiredAnalysis: "spectrum"
  styles: readonly VisualizerChoice<SpectrumVisualizerStyle>[]
  factory: VisualizerFactory
}

export type VisualizerFactory = (
  renderer: CliRenderer,
  options: VisualizerOptions,
) => VisualizerComponent
