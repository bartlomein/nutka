import type { AudioQuality } from "../core/types"

export const MAX_PLAYBACK_MESSAGE_BYTES = 64 * 1024

export interface PlaybackWorkerTrack {
  trackId: string
  resourceId: string
}

export type PlaybackWorkerRequest =
  | {
      type: "initialize"
      requestId: number
      executablePath: string
      playbackUrl: string
      profilePath: string
      developerToken: string
      musicUserToken: string
    }
  | {
      type: "play"
      requestId: number
      loadId: number
      tracks: readonly PlaybackWorkerTrack[]
    }
  | { type: "pause" | "resume" | "stop"; requestId: number }
  | { type: "seek"; requestId: number; positionSeconds: number }
  | { type: "shutdown"; requestId: number }

export type PlaybackWorkerResponse =
  | {
      type: "result"
      requestId: number
      ok: boolean
      errorCode?: string
    }
  | {
      type: "snapshot"
      loadId: number | null
      resourceId: string | null
      status: "idle" | "playing" | "paused"
      positionSeconds: number
      durationSeconds: number | null
      errorCode: string | null
      audioQuality: AudioQuality | null
    }

export function encodePlaybackMessage(message: object): string {
  return `${JSON.stringify(message)}\n`
}

export function decodePlaybackWorkerRequest(line: string): PlaybackWorkerRequest | null {
  const value = parseObject(line)
  if (!value || !isSafeInteger(value.requestId) || typeof value.type !== "string") return null

  if (value.type === "initialize") {
    if (
      !isNonEmptyString(value.executablePath, 4096) ||
      !isNonEmptyString(value.playbackUrl, 4096) ||
      !isNonEmptyString(value.profilePath, 4096) ||
      !isNonEmptyString(value.developerToken, 16_384) ||
      !isNonEmptyString(value.musicUserToken, 16_384)
    ) return null
    return value as unknown as PlaybackWorkerRequest
  }
  if (value.type === "play") {
    if (!isSafeInteger(value.loadId) || !Array.isArray(value.tracks) || value.tracks.length === 0 || value.tracks.length > 100) return null
    if (value.tracks.some((track) => !isWorkerTrack(track))) return null
    return value as unknown as PlaybackWorkerRequest
  }
  if (value.type === "seek") {
    if (typeof value.positionSeconds !== "number" || !Number.isFinite(value.positionSeconds) || value.positionSeconds < 0) return null
    return value as unknown as PlaybackWorkerRequest
  }
  if (["pause", "resume", "stop", "shutdown"].includes(value.type)) {
    return value as unknown as PlaybackWorkerRequest
  }
  return null
}

export function decodePlaybackWorkerResponse(line: string): PlaybackWorkerResponse | null {
  const value = parseObject(line)
  if (!value || typeof value.type !== "string") return null
  if (value.type === "result") {
    if (!isSafeInteger(value.requestId) || typeof value.ok !== "boolean") return null
    if (value.errorCode !== undefined && !isSafeCode(value.errorCode)) return null
    return value as unknown as PlaybackWorkerResponse
  }
  if (value.type === "snapshot") {
    if (
      !(value.loadId === null || isSafeInteger(value.loadId)) ||
      !(value.resourceId === null || isResourceId(value.resourceId)) ||
      !["idle", "playing", "paused"].includes(String(value.status)) ||
      !isFiniteNonNegative(value.positionSeconds) ||
      !(value.durationSeconds === null || isFiniteNonNegative(value.durationSeconds)) ||
      !(value.errorCode === null || isSafeCode(value.errorCode)) ||
      !(value.audioQuality === null || isPlaybackAudioQuality(value.audioQuality))
    ) return null
    return value as unknown as PlaybackWorkerResponse
  }
  return null
}

function isPlaybackAudioQuality(value: unknown): value is AudioQuality {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const quality = value as Record<string, unknown>
  if (
    quality.source !== "playback" ||
    ![
      "aac",
      "stereo",
      "lossless",
      "hi-res-lossless",
      "dolby-audio",
      "dolby-atmos",
      "spatial-audio",
    ].includes(String(quality.format))
  ) return false
  return (
    isOptionalMetric(quality.bitrateKbps, 100_000) &&
    isOptionalMetric(quality.bitDepth, 64) &&
    isOptionalMetric(quality.sampleRateKhz, 768)
  )
}

function isOptionalMetric(value: unknown, maximum: number): boolean {
  return value === undefined ||
    (typeof value === "number" && Number.isFinite(value) && value > 0 && value <= maximum)
}

function parseObject(line: string): Record<string, unknown> | null {
  if (Buffer.byteLength(line, "utf8") > MAX_PLAYBACK_MESSAGE_BYTES) return null
  try {
    const value: unknown = JSON.parse(line)
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function isWorkerTrack(value: unknown): value is PlaybackWorkerTrack {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const track = value as Record<string, unknown>
  return isNonEmptyString(track.trackId, 256) && isResourceId(track.resourceId)
}

function isResourceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(value)
}

function isSafeCode(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9_.:-]{1,64}$/i.test(value)
}

function isNonEmptyString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}
