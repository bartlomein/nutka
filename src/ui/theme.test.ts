import { describe, expect, test } from "bun:test"

import { approvedTheme, loadTheme, parseOmarchyTheme } from "./theme"

test("uses the approved console palette unless an explicit theme is configured", () => {
  expect(approvedTheme).toEqual({
    background: "#0E0D12",
    surface: "#121117",
    surfaceRaised: "#17151D",
    overlay: "#0B0A0F",
    selection: "#30242E",
    border: "#3F3B47",
    text: "#F0EBF2",
    muted: "#928B9E",
    accent: "#B29CFF",
    amber: "#FF6D66",
    visualizerLow: "#8D78CF",
    visualizerMid: "#B29CFF",
    visualizerHigh: "#FF6D66",
    visualizerPeak: "#F0EBF2",
  })
  expect(loadTheme({ XDG_STATE_HOME: "/tmp/omarchy" })).toEqual(approvedTheme)
})

describe("parseOmarchyTheme", () => {
  test("maps Omarchy semantic colors to the Nutka interface", () => {
    const theme = parseOmarchyTheme(`
      accent = "#89b4fa"
      selection = "#45475a"
      muted = "#585b70"
      background = "#1e1e2e"
      dark_background = "#161622"
      darker_background = "#101019"
      lighter_background = "#313244"
      foreground = "#cdd6f4"
      dark_foreground = "#6c7086"
      yellow = "#f9e2af"
    `)

    expect(theme).toEqual({
      background: "#1e1e2e",
      surface: "#161622",
      surfaceRaised: "#313244",
      overlay: "#101019D9",
      selection: "#45475a",
      border: "#585b70",
      text: "#cdd6f4",
      muted: "#6c7086",
      accent: "#89b4fa",
      amber: "#f9e2af",
      visualizerLow: "#89b4fa",
      visualizerMid: "#f9e2af",
      visualizerHigh: "#cdd6f4",
      visualizerPeak: "#f9e2af",
    })
  })

  test("accepts custom visualizer colors", () => {
    const theme = parseOmarchyTheme(`
      background = "#111111"
      foreground = "#eeeeee"
      accent = "#aaaaaa"
      visualizer_low = "#112233"
      visualizer_mid = "#445566"
      visualizer_high = "#778899"
      visualizer_peak = "#ffffff"
    `)

    expect(theme).toMatchObject({
      visualizerLow: "#112233",
      visualizerMid: "#445566",
      visualizerHigh: "#778899",
      visualizerPeak: "#ffffff",
    })
  })

  test("rejects themes without required semantic colors", () => {
    expect(parseOmarchyTheme('background = "#1e1e2e"')).toBeNull()
  })
})
