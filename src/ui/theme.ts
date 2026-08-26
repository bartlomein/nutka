import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface NutkaTheme {
  background: string
  surface: string
  surfaceRaised: string
  overlay: string
  selection: string
  border: string
  text: string
  muted: string
  accent: string
  amber: string
  visualizerLow: string
  visualizerMid: string
  visualizerHigh: string
  visualizerPeak: string
}

const fallbackTheme: NutkaTheme = {
  background: "#0B0C0C",
  surface: "#121414",
  surfaceRaised: "#181B1A",
  overlay: "#080909D9",
  selection: "#30362D",
  border: "#454A45",
  text: "#D8D0C2",
  muted: "#777A75",
  accent: "#9AAA76",
  amber: "#D09A5B",
  visualizerLow: "#739A78",
  visualizerMid: "#9AAA76",
  visualizerHigh: "#D8D0C2",
  visualizerPeak: "#D09A5B",
}

export function parseOmarchyTheme(source: string): NutkaTheme | null {
  const color = (name: string): string | undefined =>
    new RegExp(
      `^\\s*${name}\\s*=\\s*["'](#[0-9a-fA-F]{6})["']\\s*$`,
      "m",
    ).exec(source)?.[1]

  const background = color("background")
  const foreground = color("foreground")
  const accent = color("accent")

  if (!background || !foreground || !accent) return null

  const darkBackground = color("dark_background") ?? background
  const darkerBackground = color("darker_background") ?? darkBackground

  return {
    background,
    surface: darkBackground,
    surfaceRaised: color("lighter_background") ?? background,
    overlay: `${darkerBackground}D9`,
    selection: color("selection") ?? accent,
    border: color("muted") ?? foreground,
    text: foreground,
    muted: color("dark_foreground") ?? color("muted") ?? foreground,
    accent,
    amber: color("yellow") ?? accent,
    visualizerLow: color("visualizer_low") ?? accent,
    visualizerMid: color("visualizer_mid") ?? color("yellow") ?? accent,
    visualizerHigh: color("visualizer_high") ?? foreground,
    visualizerPeak: color("visualizer_peak") ?? color("yellow") ?? accent,
  }
}

function loadTheme(): NutkaTheme {
  const stateHome =
    process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state")
  const themePath = process.env.NUTKA_THEME_PATH ?? join(
    stateHome,
    "omarchy",
    "current",
    "theme",
    "colors.toml",
  )

  try {
    return parseOmarchyTheme(readFileSync(themePath, "utf8")) ?? fallbackTheme
  } catch {
    return fallbackTheme
  }
}

export const theme = loadTheme()
