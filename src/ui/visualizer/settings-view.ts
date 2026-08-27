import {
  visualizerDefinition,
  visualizerHeights,
  visualizerKinds,
  visualizerPalettes,
  type VisualizerSettings,
} from "./index"

export const visualizerSettingCount = 4
export const visualizerPreviewBands = [
  80, 112, 168, 224, 188, 136, 104, 152,
  208, 248, 176, 120, 88, 128, 184, 232,
  196, 144, 96, 116, 164, 212, 180, 132,
  92, 124, 172, 220, 156, 108, 76, 100,
] as const

export interface VisualizerSettingsDialog {
  original: VisualizerSettings
  draft: VisualizerSettings
  selectedIndex: number
  error?: string
}

export function visualizerSettingRows(
  settings: VisualizerSettings,
): readonly { label: string; value: string }[] {
  const definition = visualizerDefinition(settings.kind)
  return [
    { label: "Visualizer", value: definition.label },
    { label: "Style", value: choiceLabel(definition.styles, settings.style) },
    { label: "Palette", value: choiceLabel(visualizerPalettes, settings.palette) },
    { label: "Height", value: choiceLabel(visualizerHeights, settings.height) },
  ]
}

export function cycleVisualizerSettings(
  current: VisualizerSettings,
  selectedIndex: number,
  delta: number,
): VisualizerSettings | undefined {
  switch (selectedIndex) {
    case 0: {
      const kind = cycleChoice(visualizerKinds, current.kind, delta)
      const definition = visualizerDefinition(kind)
      return kind === current.kind
        ? current
        : { ...current, kind, style: definition.styles[0]?.value ?? current.style }
    }
    case 1:
      return {
        ...current,
        style: cycleChoice(visualizerDefinition(current.kind).styles, current.style, delta),
      }
    case 2:
      return {
        ...current,
        palette: cycleChoice(visualizerPalettes, current.palette, delta),
      }
    case 3:
      return {
        ...current,
        height: cycleChoice(visualizerHeights, current.height, delta),
      }
    default:
      return undefined
  }
}

function choiceLabel<T extends string | number>(
  choices: readonly { value: T; label: string }[],
  value: T,
): string {
  return choices.find((choice) => choice.value === value)?.label ?? String(value)
}

function cycleChoice<T extends string | number>(
  choices: readonly { value: T; label: string }[],
  current: T,
  delta: number,
): T {
  const currentIndex = Math.max(0, choices.findIndex((choice) => choice.value === current))
  const nextIndex = (currentIndex + delta % choices.length + choices.length) % choices.length
  return choices[nextIndex]!.value
}
