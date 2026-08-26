import { TextRenderable, type CliRenderer } from "@opentui/core"

import type { AudioQuality } from "../core/types"
import { theme } from "./theme"

export interface AudioQualityBadge {
  root: TextRenderable
  render(quality: AudioQuality | null): void
  applyResponsiveLayout(width: number, compactHeight: boolean): void
}

export function createAudioQualityBadge(renderer: CliRenderer): AudioQualityBadge {
  let terminalWidth = renderer.terminalWidth
  let compactHeight = false
  let currentQuality: AudioQuality | null = null

  const root = new TextRenderable(renderer, {
    id: "audio-quality",
    content: "",
    width: 30,
    height: 1,
    fg: theme.accent,
    truncate: true,
    visible: false,
  })

  function update(): void {
    const visible = Boolean(currentQuality) && !compactHeight && terminalWidth >= 64
    const displayWidth = terminalWidth >= 100 ? 30 : 20
    root.width = displayWidth
    root.visible = visible
    if (!currentQuality) {
      root.content = ""
      return
    }
    root.fg = isPremiumQuality(currentQuality) ? theme.accent : theme.muted
    const label = formatAudioQuality(currentQuality, displayWidth < 30)
    root.content = ` ${label} `.padStart(displayWidth)
  }

  function render(quality: AudioQuality | null): void {
    currentQuality = quality
    update()
  }

  function applyResponsiveLayout(width: number, isCompactHeight: boolean): void {
    terminalWidth = width
    compactHeight = isCompactHeight
    update()
  }

  update()
  return { root, render, applyResponsiveLayout }
}

export function formatAudioQuality(
  quality: AudioQuality,
  compact = false,
): string {
  const format = audioFormatLabel(quality.format, compact)
  const bitrate = validMetric(quality.bitrateKbps, 100_000)
  const bitDepth = validMetric(quality.bitDepth, 64)
  const sampleRate = validMetric(quality.sampleRateKhz, 768)

  if (quality.format === "aac" && bitrate !== null) {
    return `AAC · ${formatNumber(bitrate)} kbps`
  }
  if (bitDepth !== null && sampleRate !== null) {
    return compact
      ? `${format} · ${formatNumber(bitDepth)}/${formatNumber(sampleRate)}`
      : `${format} · ${formatNumber(bitDepth)}-bit/${formatNumber(sampleRate)} kHz`
  }
  if (sampleRate !== null) {
    return `${format} · ${formatNumber(sampleRate)} kHz`
  }
  return quality.source === "catalog" ? `AUDIO  ${format}` : format
}

function audioFormatLabel(format: AudioQuality["format"], compact: boolean): string {
  switch (format) {
    case "aac":
      return "AAC"
    case "stereo":
      return "STEREO"
    case "lossless":
      return "LOSSLESS"
    case "hi-res-lossless":
      return compact ? "HI-RES" : "HI-RES LOSSLESS"
    case "dolby-audio":
      return "DOLBY AUDIO"
    case "dolby-atmos":
      return "DOLBY ATMOS"
    case "spatial-audio":
      return compact ? "SPATIAL" : "SPATIAL AUDIO"
  }
}

function isPremiumQuality(quality: AudioQuality): boolean {
  return quality.format !== "aac" && quality.format !== "stereo"
}

function validMetric(value: number | undefined, maximum: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= maximum
    ? value
    : null
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "")
}
