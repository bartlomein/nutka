import type {
  AudioQuality,
  PlaybackRepeatMode,
  PlaybackShuffleMode,
} from "../core/types"

export const MAX_PLAYBACK_MESSAGE_BYTES = 64 * 1024
export const MAX_PLAYBACK_QUEUE_ITEMS = 100
export const MAX_PLAYBACK_METADATA_LENGTH = 512
export const MAX_PLAYBACK_RESOURCE_ID_LENGTH = 128
export const PLAYBACK_DYNAMIC_QUEUE_WINDOW = 25
export const PLAYBACK_SPECTRUM_BAND_COUNT = 64

export interface PlaybackWorkerTrack {
  trackId: string
  resourceId: string
}

export interface PlaybackWorkerItem {
  resourceId: string
  title: string | null
  artist: string | null
  album: string | null
  durationSeconds: number | null
}

export interface PlaybackBrowserSnapshot {
  initialized: boolean
  authorized?: boolean
  isPlaying?: boolean
  playbackState?: number | null
  positionSeconds?: number
  durationSeconds?: number | null
  resourceId?: string | null
  title?: string | null
  artist?: string | null
  album?: string | null
  currentItem?: PlaybackWorkerItem | null
  queueItems?: readonly PlaybackWorkerItem[]
  queueResourceIds?: readonly string[]
  queuePosition?: number
  shuffleMode?: PlaybackShuffleMode
  repeatMode?: PlaybackRepeatMode
  canSetShuffleMode?: boolean
  canSetRepeatMode?: boolean
  canSeek?: boolean
  canSkipNext?: boolean
  canSkipPrevious?: boolean
  lastErrorCode?: string | null
  commandSequence?: number
  completedCommandSequence?: number
  audioQuality?: AudioQuality | null
}

export type PlaybackWorkerSource =
  | { type: "finite" }
  | { type: "station"; stationId: string; title: string; isLive: boolean }

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
  | {
      type: "play-station"
      requestId: number
      loadId: number
      stationResourceId: string
      title: string
      isLive: boolean
    }
  | { type: "set-audio-analysis-enabled"; requestId: number; enabled: boolean }
  | { type: "set-shuffle-mode"; requestId: number; mode: PlaybackShuffleMode }
  | { type: "set-repeat-mode"; requestId: number; mode: PlaybackRepeatMode }
  | { type: "pause" | "resume" | "previous" | "next" | "stop"; requestId: number }
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
      queueResourceIds: readonly string[]
      currentItem: PlaybackWorkerItem | null
      queueItems: readonly PlaybackWorkerItem[]
      queuePosition: number
      source: PlaybackWorkerSource | null
      dynamicQueue: boolean
      status: "idle" | "playing" | "paused"
      positionSeconds: number
      durationSeconds: number | null
      errorCode: string | null
      audioQuality: AudioQuality | null
      shuffleMode: PlaybackShuffleMode
      repeatMode: PlaybackRepeatMode
      canSetShuffleMode: boolean
      canSetRepeatMode: boolean
      canSeek: boolean
      canSkipNext: boolean
      canSkipPrevious: boolean
    }
  | {
      type: "spectrum"
      loadId: number
      sequence: number
      bands: readonly number[]
      rms: number
      peak: number
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
    if (!isSafeInteger(value.loadId) || !Array.isArray(value.tracks) || value.tracks.length === 0 || value.tracks.length > MAX_PLAYBACK_QUEUE_ITEMS) return null
    if (value.tracks.some((track) => !isWorkerTrack(track))) return null
    return value as unknown as PlaybackWorkerRequest
  }
  if (value.type === "play-station") {
    if (
      !hasOnlyKeys(value, [
        "type",
        "requestId",
        "loadId",
        "stationResourceId",
        "title",
        "isLive",
      ]) ||
      !isSafeInteger(value.loadId) ||
      !isResourceId(value.stationResourceId) ||
      !isSafeText(value.title, MAX_PLAYBACK_METADATA_LENGTH, false) ||
      typeof value.isLive !== "boolean"
    ) return null
    return value as unknown as PlaybackWorkerRequest
  }
  if (value.type === "seek") {
    if (typeof value.positionSeconds !== "number" || !Number.isFinite(value.positionSeconds) || value.positionSeconds < 0) return null
    return value as unknown as PlaybackWorkerRequest
  }
  if (value.type === "set-audio-analysis-enabled") {
    if (typeof value.enabled !== "boolean") return null
    return value as unknown as PlaybackWorkerRequest
  }
  if (value.type === "set-shuffle-mode") {
    if (!isShuffleMode(value.mode)) return null
    return value as unknown as PlaybackWorkerRequest
  }
  if (value.type === "set-repeat-mode") {
    if (!isRepeatMode(value.mode)) return null
    return value as unknown as PlaybackWorkerRequest
  }
  if (["pause", "resume", "previous", "next", "stop", "shutdown"].includes(value.type)) {
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
      !isResourceIdArray(value.queueResourceIds) ||
      !(value.currentItem === null || isWorkerItem(value.currentItem)) ||
      !isWorkerItemArray(value.queueItems) ||
      !isQueuePosition(value.queuePosition, value.queueResourceIds) ||
      !(value.source === null || isWorkerSource(value.source)) ||
      typeof value.dynamicQueue !== "boolean" ||
      !["idle", "playing", "paused"].includes(String(value.status)) ||
      !isFiniteNonNegative(value.positionSeconds) ||
      !(value.durationSeconds === null || isFiniteNonNegative(value.durationSeconds)) ||
      !(value.errorCode === null || isSafeCode(value.errorCode)) ||
      !(value.audioQuality === null || isPlaybackAudioQuality(value.audioQuality)) ||
      !isShuffleMode(value.shuffleMode) ||
      !isRepeatMode(value.repeatMode) ||
      typeof value.canSetShuffleMode !== "boolean" ||
      typeof value.canSetRepeatMode !== "boolean" ||
      typeof value.canSeek !== "boolean" ||
      typeof value.canSkipNext !== "boolean" ||
      typeof value.canSkipPrevious !== "boolean"
    ) return null
    return value as unknown as PlaybackWorkerResponse
  }
  if (value.type === "spectrum") {
    if (
      !isSafeInteger(value.loadId) ||
      !isSafeInteger(value.sequence) ||
      !isByteArray(value.bands, PLAYBACK_SPECTRUM_BAND_COUNT) ||
      !isByte(value.rms) ||
      !isByte(value.peak)
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

function isByteArray(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(isByte)
}

function isByte(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255
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

function isWorkerItem(value: unknown): value is PlaybackWorkerItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return isResourceId(item.resourceId) &&
    isNullableString(item.title, MAX_PLAYBACK_METADATA_LENGTH) &&
    isNullableString(item.artist, MAX_PLAYBACK_METADATA_LENGTH) &&
    isNullableString(item.album, MAX_PLAYBACK_METADATA_LENGTH) &&
    (item.durationSeconds === null || isFiniteNonNegative(item.durationSeconds))
}

function isWorkerItemArray(value: unknown): value is PlaybackWorkerItem[] {
  return Array.isArray(value) && value.length <= MAX_PLAYBACK_QUEUE_ITEMS && value.every(isWorkerItem)
}

function isWorkerSource(value: unknown): value is PlaybackWorkerSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const source = value as Record<string, unknown>
  if (source.type === "finite") return true
  return source.type === "station" &&
    isResourceId(source.stationId) &&
    isSafeText(source.title, MAX_PLAYBACK_METADATA_LENGTH, false) &&
    typeof source.isLive === "boolean"
}

function isResourceId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= MAX_PLAYBACK_RESOURCE_ID_LENGTH &&
    /^[A-Za-z0-9._-]+$/.test(value)
}

function isResourceIdArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_PLAYBACK_QUEUE_ITEMS && value.every(isResourceId)
}

function isQueuePosition(value: unknown, resourceIds: string[]): value is number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= -1 &&
    value < resourceIds.length
}

function isShuffleMode(value: unknown): value is PlaybackShuffleMode {
  return value === "off" || value === "songs"
}

function isRepeatMode(value: unknown): value is PlaybackRepeatMode {
  return value === "none" || value === "all" || value === "one"
}

function isSafeCode(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9_.:-]{1,64}$/i.test(value)
}

function isNonEmptyString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength
}

function isNullableString(value: unknown, maximumLength: number): value is string | null {
  return value === null || isSafeText(value, maximumLength, true)
}

function isSafeText(value: unknown, maximumLength: number, allowEmpty: boolean): value is string {
  return typeof value === "string" &&
    (allowEmpty || value.length > 0) &&
    value.length <= maximumLength &&
    !/[\u0000-\u001f\u007f]/.test(value)
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}
