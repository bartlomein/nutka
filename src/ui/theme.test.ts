import { describe, expect, test } from "bun:test"

import { parseOmarchyTheme } from "./theme"

describe("parseOmarchyTheme", () => {
  test("maps Omarchy semantic colors to the Nuta interface", () => {
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
    })
  })

  test("rejects themes without required semantic colors", () => {
    expect(parseOmarchyTheme('background = "#1e1e2e"')).toBeNull()
  })
})
