import { describe, expect, test } from "bun:test"

import type { VisualizerSettings } from "./index"
import { cycleVisualizerSettings, visualizerSettingRows } from "./settings-view"

const settings: VisualizerSettings = {
  kind: "spectrum",
  style: "dense",
  palette: "theme",
  height: 3,
}

describe("visualizer settings view", () => {
  test("cycles registered choices in both directions", () => {
    expect(cycleVisualizerSettings(settings, 1, -1)?.style).toBe("wide")
    expect(cycleVisualizerSettings(settings, 2, 1)?.palette).toBe("monochrome")
    expect(cycleVisualizerSettings(settings, 3, 1)?.height).toBe(4)
  })

  test("derives labels from the visualizer registry", () => {
    expect(visualizerSettingRows(settings)).toEqual([
      { label: "Visualizer", value: "Spectrum" },
      { label: "Style", value: "Dense" },
      { label: "Palette", value: "Theme" },
      { label: "Height", value: "3 rows" },
    ])
  })
})
