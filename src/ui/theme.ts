import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface NutaTheme {
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
}

const fallbackTheme: NutaTheme = {
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
}

export function parseOmarchyTheme(source: string): NutaTheme | null {
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
  }
}

function loadTheme(): NutaTheme {
  const stateHome =
    process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state")
  const themePath = join(
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
