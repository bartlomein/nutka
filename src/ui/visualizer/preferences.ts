import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import type { VisualizerSettings } from "./types"

const maximumConfigBytes = 64 * 1024

export const defaultVisualizerSettings: VisualizerSettings = {
  kind: "spectrum",
  style: "spaced",
  palette: "theme",
  height: 3,
}

export function loadVisualizerSettings(
  environment: NodeJS.ProcessEnv = process.env,
): VisualizerSettings {
  const path = visualizerConfigPath(environment)
  if (!path) return { ...defaultVisualizerSettings }

  try {
    const file = statSync(path)
    if (!file.isFile() || file.size > maximumConfigBytes) {
      return { ...defaultVisualizerSettings }
    }
    return decodeVisualizerSettings(Bun.TOML.parse(readFileSync(path, "utf8")))
  } catch {
    return { ...defaultVisualizerSettings }
  }
}

export function saveVisualizerSettings(
  settings: VisualizerSettings,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const path = visualizerConfigPath(environment)
  if (!path) throw new Error("Visualizer configuration path is unavailable")

  const source = readExistingConfig(path)
  const serialized = replaceVisualizerSection(source, settings)

  const directory = dirname(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, serialized, { mode: 0o600, flag: "wx" })
    renameSync(temporaryPath, path)
  } catch (error) {
    try {
      unlinkSync(temporaryPath)
    } catch {}
    throw error
  }
}

export function visualizerConfigPath(
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (environment.NUTKA_CONFIG_PATH) return environment.NUTKA_CONFIG_PATH
  const configHome = environment.XDG_CONFIG_HOME || (
    environment.HOME ? join(environment.HOME, ".config") : undefined
  )
  return configHome ? join(configHome, "nutka", "config.toml") : undefined
}

function readExistingConfig(path: string): string {
  try {
    const file = statSync(path)
    if (!file.isFile() || file.size > maximumConfigBytes) {
      throw new Error("Nutka configuration is not a regular bounded file")
    }
    const source = readFileSync(path, "utf8")
    if (!isRecord(Bun.TOML.parse(source))) {
      throw new Error("Nutka configuration root is invalid")
    }
    return source
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""
    throw error
  }
}

function replaceVisualizerSection(source: string, settings: VisualizerSettings): string {
  const section = [
    "[visualizer]",
    `kind = "${settings.kind}"`,
    `style = "${settings.style}"`,
    `palette = "${settings.palette}"`,
    `height = ${settings.height}`,
  ].join("\n")
  const lines = source.split("\n")
  const start = lines.findIndex((line) => /^\s*\[visualizer\]\s*(?:#.*)?$/u.test(line))
  if (start < 0) {
    const parsed = Bun.TOML.parse(source)
    if (isRecord(parsed) && Object.hasOwn(parsed, "visualizer")) {
      throw new Error("Visualizer configuration must use a [visualizer] table")
    }
    const prefix = source.trimEnd()
    return prefix ? `${prefix}\n\n${section}\n` : `${section}\n`
  }

  let end = start + 1
  while (end < lines.length && !/^\s*\[\[?[^\]]+\]\]?\s*(?:#.*)?$/u.test(lines[end]!)) {
    end++
  }
  lines.splice(start, end - start, ...section.split("\n"))
  return `${lines.join("\n").trimEnd()}\n`
}

function decodeVisualizerSettings(value: unknown): VisualizerSettings {
  if (!isRecord(value) || !isRecord(value.visualizer)) {
    return { ...defaultVisualizerSettings }
  }
  const settings = value.visualizer
  return {
    kind: settings.kind === "spectrum" ? settings.kind : defaultVisualizerSettings.kind,
    style: ["dense", "spaced", "wide"].includes(String(settings.style))
      ? settings.style as VisualizerSettings["style"]
      : defaultVisualizerSettings.style,
    palette: ["theme", "monochrome", "warm", "cool", "spectrum"].includes(
      String(settings.palette),
    )
      ? settings.palette as VisualizerSettings["palette"]
      : defaultVisualizerSettings.palette,
    height: typeof settings.height === "number" && [2, 3, 4].includes(settings.height)
      ? settings.height as VisualizerSettings["height"]
      : defaultVisualizerSettings.height,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
