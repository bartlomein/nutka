import { describe, expect, test } from "bun:test"

import type { NutkaTheme } from "../theme"
import { resolveVisualizerPalette } from "./palettes"

const theme = {
  accent: "#111111",
  text: "#222222",
  visualizerLow: "#333333",
  visualizerMid: "#444444",
  visualizerHigh: "#555555",
  visualizerPeak: "#666666",
} as NutkaTheme

describe("visualizer palettes", () => {
  test("follows theme colors by default", () => {
    expect(resolveVisualizerPalette("theme", theme)).toEqual({
      low: "#333333",
      mid: "#444444",
      high: "#555555",
      peak: "#666666",
    })
  })

  test("provides a theme-aware monochrome option and fixed color presets", () => {
    expect(resolveVisualizerPalette("monochrome", theme)).toEqual({
      low: "#111111",
      mid: "#111111",
      high: "#111111",
      peak: "#222222",
    })
    expect(resolveVisualizerPalette("warm", theme)).not.toEqual(
      resolveVisualizerPalette("cool", theme),
    )
    expect(resolveVisualizerPalette("spectrum", theme).peak).toBe("#FFFFFF")
  })
})
