import type { PlaybackRepeatMode, PlaybackShuffleMode } from "../core/types"
import {
  MAX_PLAYBACK_METADATA_LENGTH,
  MAX_PLAYBACK_QUEUE_ITEMS,
  MAX_PLAYBACK_RESOURCE_ID_LENGTH,
  PLAYBACK_DYNAMIC_QUEUE_WINDOW,
  type PlaybackBrowserSnapshot,
  type PlaybackWorkerItem,
} from "./apple-playback-protocol"

interface PlaybackPageLimits {
  queueItems: number
  metadataLength: number
  resourceIdLength: number
  dynamicQueueWindow: number
}

interface PlaybackPageElement {
  addEventListener(name: "click", listener: () => void): void
}

interface PlaybackPageDocument {
  querySelector(selector: string): PlaybackPageElement | null
}

interface PlaybackPageWindow {
  __nutkaPlayback?: PlaybackPageApi
}

interface MusicKitPlayer {
  musicUserToken: string
  readonly isAuthorized?: boolean
  readonly isPlaying?: boolean
  readonly playbackState?: number
  readonly currentPlaybackTime?: number
  readonly currentPlaybackDuration?: number
  readonly nowPlayingItem?: unknown
  readonly queue?: { readonly items?: unknown; readonly position?: unknown }
  shuffleMode?: unknown
  repeatMode?: unknown
  readonly capabilities?: {
    readonly canSetShuffleMode?: boolean
    readonly canSetRepeatMode?: boolean
    readonly canSeek?: boolean
    readonly canSkipToNextItem?: boolean
    readonly canSkipToPreviousItem?: boolean
  }
  addEventListener(name: "playbackError", listener: (event: unknown) => void): void
  setQueue(options: { station: string } | { song: string } | { songs: string[] }): Promise<unknown>
  play(): Promise<unknown>
  pause(): Promise<unknown>
  stop(): Promise<unknown>
  skipToPreviousItem(): Promise<unknown>
  skipToNextItem(): Promise<unknown>
  seekToTime(positionSeconds: number): Promise<unknown>
}

interface MusicKitBrowserApi {
  readonly PlayerShuffleMode: { readonly off: unknown; readonly songs: unknown }
  readonly PlayerRepeatMode: { readonly none: unknown; readonly all: unknown; readonly one: unknown }
  configure(options: {
    developerToken: string
    app: { name: string; build: string }
  }): Promise<unknown>
  getInstance(): MusicKitPlayer
}

interface PlaybackPageApi {
  initialize(developerToken: string, musicUserToken: string): Promise<{ authorized: boolean }>
  setQueue(resourceIds: readonly string[]): void
  setStation(resourceId: string): void
  setShuffleMode(mode: PlaybackShuffleMode): void
  setRepeatMode(mode: PlaybackRepeatMode): void
  snapshot(): PlaybackBrowserSnapshot
  seek(positionSeconds: number): Promise<void>
}

const playbackPageLimits: PlaybackPageLimits = {
  queueItems: MAX_PLAYBACK_QUEUE_ITEMS,
  metadataLength: MAX_PLAYBACK_METADATA_LENGTH,
  resourceIdLength: MAX_PLAYBACK_RESOURCE_ID_LENGTH,
  dynamicQueueWindow: PLAYBACK_DYNAMIC_QUEUE_WINDOW,
}

export const PLAYBACK_JS = `(${playbackPageMain.toString()})(window, MusicKit, document, ${JSON.stringify(playbackPageLimits)});`

function playbackPageMain(
  window: PlaybackPageWindow,
  MusicKit: MusicKitBrowserApi,
  document: PlaybackPageDocument,
  limits: PlaybackPageLimits,
): void {
  "use strict"

  let music: MusicKitPlayer | undefined
  let songResourceIds: string[] | undefined
  let stationResourceId: string | undefined
  let lastErrorCode: string | undefined
  let commandSequence = 0
  let completedCommandSequence = 0

  function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined
  }

  function safeErrorCode(error: unknown): string {
    const record = asRecord(error)
    if (!record) return "unknown"
    for (const key of ["code", "errorCode", "status", "name"]) {
      const value = record[key]
      if (
        (typeof value === "string" || typeof value === "number") &&
        /^[a-z0-9_.:-]{1,64}$/i.test(String(value))
      ) return String(value)
    }
    return "unknown"
  }

  function isResourceId(value: unknown): value is string {
    return typeof value === "string" &&
      value.length > 0 &&
      value.length <= limits.resourceIdLength &&
      /^[A-Za-z0-9._-]+$/.test(value)
  }

  function safeMetadata(value: unknown): string | null {
    return typeof value === "string"
      ? value.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, limits.metadataLength)
      : null
  }

  async function run(action: () => Promise<unknown>): Promise<void> {
    lastErrorCode = undefined
    try {
      await action()
    } catch (error) {
      lastErrorCode = safeErrorCode(error)
      throw new Error("playback_command_failed")
    }
  }

  async function initialize(
    developerToken: string,
    musicUserToken: string,
  ): Promise<{ authorized: boolean }> {
    if (music) throw new Error("already_initialized")
    await MusicKit.configure({ developerToken, app: { name: "Nutka", build: "1" } })
    music = MusicKit.getInstance()
    music.musicUserToken = musicUserToken
    music.addEventListener("playbackError", (event) => {
      lastErrorCode = safeErrorCode(event)
    })
    return { authorized: music.isAuthorized === true }
  }

  function setQueue(resourceIds: readonly string[]): void {
    if (!music) throw new Error("not_initialized")
    if (
      !Array.isArray(resourceIds) ||
      resourceIds.length === 0 ||
      resourceIds.length > limits.queueItems ||
      resourceIds.some((resourceId) => !isResourceId(resourceId))
    ) throw new Error("invalid_queue")
    songResourceIds = [...resourceIds]
    stationResourceId = undefined
  }

  function setStation(resourceId: string): void {
    if (!music) throw new Error("not_initialized")
    if (!isResourceId(resourceId)) throw new Error("invalid_station")
    stationResourceId = resourceId
    songResourceIds = undefined
  }

  function setShuffleMode(mode: PlaybackShuffleMode): void {
    if (!music) throw new Error("not_initialized")
    lastErrorCode = undefined
    if (music.capabilities?.canSetShuffleMode !== true) throw new Error("shuffle_unsupported")
    if (mode === "off") music.shuffleMode = MusicKit.PlayerShuffleMode.off
    else if (mode === "songs") music.shuffleMode = MusicKit.PlayerShuffleMode.songs
    else throw new Error("invalid_shuffle_mode")
  }

  function setRepeatMode(mode: PlaybackRepeatMode): void {
    if (!music) throw new Error("not_initialized")
    lastErrorCode = undefined
    if (music.capabilities?.canSetRepeatMode !== true) throw new Error("repeat_unsupported")
    if (mode === "none") music.repeatMode = MusicKit.PlayerRepeatMode.none
    else if (mode === "all") music.repeatMode = MusicKit.PlayerRepeatMode.all
    else if (mode === "one") music.repeatMode = MusicKit.PlayerRepeatMode.one
    else throw new Error("invalid_repeat_mode")
  }

  async function play(): Promise<void> {
    if (!music || (!songResourceIds && !stationResourceId)) throw new Error("not_ready")
    await run(async () => {
      if (stationResourceId) await music!.setQueue({ station: stationResourceId })
      else {
        const resourceIds = songResourceIds!
        await music!.setQueue(resourceIds.length === 1
          ? { song: resourceIds[0]! }
          : { songs: resourceIds })
      }
      await music!.play()
    })
  }

  function itemMetadata(value: unknown): PlaybackWorkerItem | null {
    const item = asRecord(value)
    if (!item) return null
    const attributes = asRecord(item.attributes)
    const playParams = asRecord(item.playParams)
    const attributePlayParams = asRecord(attributes?.playParams)
    const resourceId = [item.id, playParams?.id, attributePlayParams?.id].find(isResourceId)
    if (!resourceId) return null
    const durationInMillis = attributes?.durationInMillis
    const playbackDuration = item.playbackDuration
    return {
      resourceId,
      title: safeMetadata(attributes?.name ?? item.title),
      artist: safeMetadata(attributes?.artistName ?? item.artistName),
      album: safeMetadata(attributes?.albumName ?? item.albumName),
      durationSeconds: typeof durationInMillis === "number" &&
          Number.isFinite(durationInMillis) && durationInMillis >= 0
        ? durationInMillis / 1000
        : typeof playbackDuration === "number" &&
            Number.isFinite(playbackDuration) && playbackDuration >= 0
          ? playbackDuration
          : null,
    }
  }

  function snapshot(): PlaybackBrowserSnapshot {
    if (!music) return { initialized: false }
    const rawQueueItems = music.queue?.items
    const queueItems = Array.isArray(rawQueueItems) ? rawQueueItems : []
    const rawQueuePosition = Number.isInteger(music.queue?.position)
      ? music.queue!.position as number
      : -1
    const dynamicQueue = Boolean(stationResourceId)
    const queueStart = dynamicQueue && rawQueuePosition >= 0
      ? Math.max(0, rawQueuePosition - 1)
      : 0
    const queueEnd = dynamicQueue
      ? queueStart + limits.dynamicQueueWindow
      : limits.queueItems
    const currentItem = itemMetadata(music.nowPlayingItem)
    const visibleQueueEntries = queueItems.slice(queueStart, queueEnd).flatMap((queueItem, index) => {
      const metadata = itemMetadata(queueItem)
      return metadata ? [{ metadata, originalIndex: queueStart + index }] : []
    })
    const visibleQueueItems = visibleQueueEntries.map((entry) => entry.metadata)
    return {
      initialized: true,
      authorized: music.isAuthorized === true,
      isPlaying: music.isPlaying === true,
      playbackState: Number.isFinite(music.playbackState) ? music.playbackState : null,
      positionSeconds: Number.isFinite(music.currentPlaybackTime) ? music.currentPlaybackTime : 0,
      durationSeconds: Number.isFinite(music.currentPlaybackDuration)
        ? music.currentPlaybackDuration
        : null,
      resourceId: currentItem?.resourceId ?? null,
      title: currentItem?.title ?? null,
      artist: currentItem?.artist ?? null,
      album: currentItem?.album ?? null,
      currentItem,
      queueItems: dynamicQueue ? visibleQueueItems : [],
      queueResourceIds: visibleQueueItems.map((queueItem) => queueItem.resourceId),
      queuePosition: visibleQueueEntries.findIndex(
        (entry) => entry.originalIndex === rawQueuePosition,
      ),
      shuffleMode: music.shuffleMode === MusicKit.PlayerShuffleMode.songs ? "songs" : "off",
      repeatMode: music.repeatMode === MusicKit.PlayerRepeatMode.one
        ? "one"
        : music.repeatMode === MusicKit.PlayerRepeatMode.all
          ? "all"
          : "none",
      canSetShuffleMode: music.capabilities?.canSetShuffleMode === true,
      canSetRepeatMode: music.capabilities?.canSetRepeatMode === true,
      canSeek: music.capabilities?.canSeek === true,
      canSkipNext: music.capabilities?.canSkipToNextItem === true,
      canSkipPrevious: music.capabilities?.canSkipToPreviousItem === true,
      lastErrorCode: lastErrorCode ?? null,
      commandSequence,
      completedCommandSequence,
    }
  }

  function trigger(action: () => Promise<unknown>): void {
    const sequence = ++commandSequence
    lastErrorCode = undefined
    void Promise.resolve()
      .then(action)
      .catch((error: unknown) => {
        lastErrorCode ??= safeErrorCode(error)
      })
      .finally(() => {
        completedCommandSequence = sequence
      })
  }

  document.querySelector("#play")?.addEventListener("click", () => trigger(play))
  document.querySelector("#pause")?.addEventListener("click", () => trigger(() => {
    if (!music) throw new Error("not_initialized")
    return run(() => music!.pause())
  }))
  document.querySelector("#resume")?.addEventListener("click", () => trigger(() => {
    if (!music) throw new Error("not_initialized")
    return run(() => music!.play())
  }))
  document.querySelector("#previous")?.addEventListener("click", () => trigger(() => {
    if (!music) throw new Error("not_initialized")
    return run(() => music!.skipToPreviousItem())
  }))
  document.querySelector("#next")?.addEventListener("click", () => trigger(() => {
    if (!music) throw new Error("not_initialized")
    return run(() => music!.skipToNextItem())
  }))
  document.querySelector("#stop")?.addEventListener("click", () => trigger(() => {
    if (!music) throw new Error("not_initialized")
    return run(() => music!.stop())
  }))

  window.__nutkaPlayback = {
    initialize,
    setQueue,
    setStation,
    setShuffleMode,
    setRepeatMode,
    snapshot,
    seek: (positionSeconds) => {
      if (!music || !Number.isFinite(positionSeconds) || positionSeconds < 0) {
        throw new Error("invalid_seek")
      }
      return run(() => music!.seekToTime(positionSeconds))
    },
  }
}
