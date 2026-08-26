import type { AudioFormat, AudioQuality } from "../core/types"

const MAX_PROPERTY_LENGTH = 32 * 1024

export interface ChromiumMediaProperty {
  name: string
  value: string
}

export class ChromiumAudioQualityTracker {
  private readonly players = new Map<string, Map<string, string>>()
  private latestPlayerId: string | null = null

  update(playerId: string, properties: readonly ChromiumMediaProperty[]): void {
    if (!isSafePlayerId(playerId) || properties.length > 100) return
    const player = this.players.get(playerId) ?? new Map<string, string>()
    for (const property of properties) {
      if (
        typeof property.name !== "string" ||
        typeof property.value !== "string" ||
        property.name.length > 128 ||
        property.value.length > MAX_PROPERTY_LENGTH
      ) continue
      if (property.value === "null") player.delete(property.name)
      else player.set(property.name, property.value)
    }
    this.players.set(playerId, player)
    this.latestPlayerId = playerId
  }

  get quality(): AudioQuality | null {
    if (this.latestPlayerId) {
      const latest = deriveChromiumAudioQuality(this.players.get(this.latestPlayerId))
      if (latest) return latest
    }
    for (const player of [...this.players.values()].reverse()) {
      const quality = deriveChromiumAudioQuality(player)
      if (quality) return quality
    }
    return null
  }
}

export function deriveChromiumAudioQuality(
  properties: ReadonlyMap<string, string> | undefined,
): AudioQuality | null {
  if (!properties) return null
  const track = decodeAudioTrack(properties.get("kAudioTracks"))
  const codec = track?.codec ?? firstProperty(properties, [
    "kAudioCodecName",
    "kAudioCodec",
  ])
  const format = codec && audioFormat(codec)
  if (!format) return null

  const bitrateBits = numberProperty(properties, ["kAudioBitrate", "kBitrate"])
  const sampleRate = track?.sampleRate ?? numberProperty(properties, ["kAudioSampleRate"])
  return {
    format,
    ...(bitrateBits !== null && bitrateBits >= 8_000 && bitrateBits <= 100_000_000
      ? { bitrateKbps: Math.round(bitrateBits / 1_000) }
      : {}),
    ...(sampleRate !== null && sampleRate >= 8_000 && sampleRate <= 768_000
      ? { sampleRateKhz: sampleRate / 1_000 }
      : {}),
    source: "playback",
  }
}

function decodeAudioTrack(value: string | undefined): {
  codec?: string
  sampleRate: number | null
} | null {
  if (!value || value.length > MAX_PROPERTY_LENGTH) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    const track = parsed[0]
    if (!track || typeof track !== "object" || Array.isArray(track)) return null
    const record = track as Record<string, unknown>
    const codec = typeof record.codec === "string" && record.codec.length <= 64
      ? record.codec
      : undefined
    const samples = record["samples per second"]
    return {
      ...(codec ? { codec } : {}),
      sampleRate: typeof samples === "number" && Number.isFinite(samples)
        ? samples
        : null,
    }
  } catch {
    return null
  }
}

function audioFormat(value: string): AudioFormat | null {
  const codec = value.trim().toLowerCase()
  if (codec.includes("aac") || codec.includes("mp4a")) return "aac"
  if (codec.includes("alac") || codec.includes("flac")) return "lossless"
  if (codec.includes("ec-3") || codec.includes("eac3") || codec === "ac-3") {
    return "dolby-audio"
  }
  return null
}

function firstProperty(
  properties: ReadonlyMap<string, string>,
  names: readonly string[],
): string | null {
  for (const name of names) {
    const value = properties.get(name)
    if (value && value.length <= 64) return value
  }
  return null
}

function numberProperty(
  properties: ReadonlyMap<string, string>,
  names: readonly string[],
): number | null {
  const value = firstProperty(properties, names)
  if (value === null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function isSafePlayerId(value: string): boolean {
  return typeof value === "string" && /^[a-z0-9_.:-]{1,128}$/i.test(value)
}
