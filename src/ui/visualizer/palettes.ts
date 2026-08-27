import type { NutkaTheme } from "../theme"
import type { VisualizerPalette, VisualizerPaletteName } from "./types"

export function resolveVisualizerPalette(
  name: VisualizerPaletteName,
  currentTheme: NutkaTheme,
): VisualizerPalette {
  switch (name) {
    case "theme":
      return {
        low: currentTheme.visualizerLow,
        mid: currentTheme.visualizerMid,
        high: currentTheme.visualizerHigh,
        peak: currentTheme.visualizerPeak,
      }
    case "monochrome":
      return {
        low: currentTheme.accent,
        mid: currentTheme.accent,
        high: currentTheme.accent,
        peak: currentTheme.text,
      }
    case "warm":
      return {
        low: "#8F3F32",
        mid: "#D09A5B",
        high: "#F0D8A8",
        peak: "#FFF1D0",
      }
    case "cool":
      return {
        low: "#315B70",
        mid: "#67A1B8",
        high: "#B8D8E8",
        peak: "#E8F8FF",
      }
    case "spectrum":
      return {
        low: "#5B7FFF",
        mid: "#70C97C",
        high: "#E36A5D",
        peak: "#FFFFFF",
      }
  }
}
