import { BoxRenderable, type CliRenderer } from "@opentui/core"

import type { AudioSpectrumFrame, PlaybackStatus } from "../../core/types"

import { createSpectrumVisualizer } from "./spectrum"
import type {
  SpectrumVisualizerStyle,
  VisualizerChoice,
  VisualizerComponent,
  VisualizerDefinition,
  VisualizerKind,
  VisualizerOptions,
} from "./types"

export type {
  VisualizerComponent,
  VisualizerDefinition,
  VisualizerHeight,
  VisualizerKind,
  VisualizerOptions,
  VisualizerPalette,
  VisualizerPaletteName,
  VisualizerSettings,
} from "./types"

export const visualizerDefinitions = {
  spectrum: {
    kind: "spectrum",
    label: "Spectrum",
    requiredAnalysis: "spectrum",
    styles: [
      { value: "dense", label: "Dense" },
      { value: "spaced", label: "Spaced" },
      { value: "wide", label: "Wide" },
    ] satisfies readonly VisualizerChoice<SpectrumVisualizerStyle>[],
    factory: createSpectrumVisualizer,
  },
} as const satisfies Record<VisualizerKind, VisualizerDefinition>

export const visualizerKinds = Object.values(visualizerDefinitions).map(
  ({ kind, label }) => ({ value: kind, label }),
)

export const visualizerPalettes = [
  { value: "theme", label: "Theme" },
  { value: "monochrome", label: "Monochrome" },
  { value: "warm", label: "Warm" },
  { value: "cool", label: "Cool" },
  { value: "spectrum", label: "Spectrum" },
] as const

export const visualizerHeights = [
  { value: 2, label: "2 rows" },
  { value: 3, label: "3 rows" },
  { value: 4, label: "4 rows" },
] as const

export function visualizerDefinition(kind: VisualizerKind): VisualizerDefinition {
  return visualizerDefinitions[kind]
}

export function createVisualizer(
  renderer: CliRenderer,
  options: VisualizerOptions,
): VisualizerComponent {
  let currentKind = options.settings.kind
  let current = visualizerDefinitions[currentKind].factory(renderer, options)
  let status: PlaybackStatus = "idle"
  let frame: AudioSpectrumFrame | null = null
  let width = renderer.terminalWidth
  let compactHeight = false

  const root = new BoxRenderable(renderer, {
    id: "player-visualizer-host",
    width: "100%",
    height: options.settings.height,
    flexDirection: "column",
  })
  root.add(current.root)

  return {
    root,
    renderStatus(nextStatus) {
      status = nextStatus
      current.renderStatus(nextStatus)
    },
    renderFrame(nextFrame) {
      frame = nextFrame
      current.renderFrame(nextFrame)
    },
    applyOptions(nextOptions) {
      root.height = nextOptions.settings.height
      if (nextOptions.settings.kind === currentKind) {
        current.applyOptions(nextOptions)
        return
      }

      root.remove(current.root)
      current.root.destroyRecursively()
      currentKind = nextOptions.settings.kind
      current = visualizerDefinitions[currentKind].factory(renderer, nextOptions)
      root.add(current.root)
      current.applyResponsiveLayout(width, compactHeight)
      current.renderStatus(status)
      current.renderFrame(frame)
      renderer.requestRender()
    },
    applyResponsiveLayout(nextWidth, nextCompactHeight) {
      width = nextWidth
      compactHeight = nextCompactHeight
      root.visible = !nextCompactHeight
      current.applyResponsiveLayout(nextWidth, nextCompactHeight)
    },
  }
}
