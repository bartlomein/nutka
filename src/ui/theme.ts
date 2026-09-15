import { readFileSync } from "node:fs"

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

export const approvedTheme: NutkaTheme = {
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

export function loadTheme(environment: NodeJS.ProcessEnv = process.env): NutkaTheme {
  const themePath = environment.NUTKA_THEME_PATH
  if (!themePath) return approvedTheme

  try {
    return parseOmarchyTheme(readFileSync(themePath, "utf8")) ?? approvedTheme
  } catch {
    return approvedTheme
  }
}

export const theme = loadTheme()
