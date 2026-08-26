import type { CliRenderer } from "@opentui/core"

import { createSpectrumVisualizer } from "./spectrum"
import type {
  VisualizerComponent,
  VisualizerFactory,
  VisualizerKind,
  VisualizerOptions,
} from "./types"

export type {
  VisualizerComponent,
  VisualizerKind,
  VisualizerOptions,
  VisualizerPalette,
} from "./types"

const visualizers: Record<VisualizerKind, VisualizerFactory> = {
  spectrum: createSpectrumVisualizer,
}

export function createVisualizer(
  renderer: CliRenderer,
  options: VisualizerOptions,
): VisualizerComponent {
  return visualizers[options.kind](renderer, options)
}
