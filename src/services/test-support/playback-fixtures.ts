import type {
  AppleCatalogStation,
  AppleCatalogTrack,
  PlaybackRepeatMode,
  PlaybackShuffleMode,
} from "../../core/types"
import type {
  PlaybackWorkerResponse,
  PlaybackWorkerTrack,
} from "../apple-playback-protocol"
import { ApplePlaybackController, type PlaybackWorkerClient } from "../apple-playback"
import type { PlaybackLogger } from "../playback-log"

export const tracks = [
  appleTrack("one", "1"),
  appleTrack("two", "2"),
  appleTrack("three", "3"),
] as const

class FakeWorker implements PlaybackWorkerClient {
  initialization?: {
    executablePath: string
    playbackUrl: string
    profilePath: string
    developerToken: string
    musicUserToken: string
  }
  plays: Array<{ loadId: number; tracks: readonly PlaybackWorkerTrack[] }> = []
  stations: Array<{
    loadId: number
    stationResourceId: string
    title: string
    isLive: boolean
  }> = []
  pauseCount = 0
  resumeCount = 0
  previousCount = 0
  nextCount = 0
  shuffleModeChanges: PlaybackShuffleMode[] = []
  repeatModeChanges: PlaybackRepeatMode[] = []
  analysisEnabledChanges: boolean[] = []
  stopCount = 0
  disposeCount = 0
  playGate?: Promise<void>
  analysisGate?: Promise<void>

  constructor(
    private readonly onSnapshot: (
      snapshot: Extract<PlaybackWorkerResponse, { type: "snapshot" }>,
    ) => void,
    private readonly onExit: (errorCode: string) => void,
    private readonly onSpectrum: (
      frame: Extract<PlaybackWorkerResponse, { type: "spectrum" }>,
    ) => void,
  ) {}

  async initialize(options: NonNullable<FakeWorker["initialization"]>): Promise<void> {
    this.initialization = options
  }

  async setAudioAnalysisEnabled(enabled: boolean): Promise<void> {
    this.analysisEnabledChanges.push(enabled)
    await this.analysisGate
  }

  async play(loadId: number, workerTracks: readonly PlaybackWorkerTrack[]): Promise<void> {
    this.plays.push({ loadId, tracks: workerTracks })
    await this.playGate
  }

  async playStation(
    loadId: number,
    stationResourceId: string,
    title: string,
    isLive: boolean,
  ): Promise<void> {
    this.stations.push({ loadId, stationResourceId, title, isLive })
    await this.playGate
  }

  async pause(): Promise<void> {
    this.pauseCount++
  }

  async resume(): Promise<void> {
    this.resumeCount++
  }

  async previous(): Promise<void> {
    this.previousCount++
  }

  async next(): Promise<void> {
    this.nextCount++
  }

  async setShuffleMode(mode: PlaybackShuffleMode): Promise<void> {
    this.shuffleModeChanges.push(mode)
  }

  async setRepeatMode(mode: PlaybackRepeatMode): Promise<void> {
    this.repeatModeChanges.push(mode)
  }

  async seek(): Promise<void> {}

  async stop(): Promise<void> {
    this.stopCount++
  }

  async dispose(): Promise<void> {
    this.disposeCount++
  }

  emit(
    snapshot: Omit<
      Extract<PlaybackWorkerResponse, { type: "snapshot" }>,
      | "type"
      | "queueResourceIds"
      | "queuePosition"
      | "currentItem"
      | "queueItems"
      | "source"
      | "dynamicQueue"
      | "shuffleMode"
      | "repeatMode"
      | "canSetShuffleMode"
      | "canSetRepeatMode"
      | "canSeek"
      | "canSkipNext"
      | "canSkipPrevious"
    > & Partial<Pick<
      Extract<PlaybackWorkerResponse, { type: "snapshot" }>,
      | "queueResourceIds"
      | "queuePosition"
      | "currentItem"
      | "queueItems"
      | "source"
      | "dynamicQueue"
      | "shuffleMode"
      | "repeatMode"
      | "canSetShuffleMode"
      | "canSetRepeatMode"
      | "canSeek"
      | "canSkipNext"
      | "canSkipPrevious"
    >>,
  ): void {
    const queueResourceIds = snapshot.queueResourceIds ?? this.plays
      .find((play) => play.loadId === snapshot.loadId)
      ?.tracks.map((track) => track.resourceId) ?? []
    const queuePosition = snapshot.queuePosition ?? queueResourceIds.indexOf(snapshot.resourceId ?? "")
    this.onSnapshot({
      type: "snapshot",
      ...snapshot,
      queueResourceIds,
      currentItem: snapshot.currentItem ?? (snapshot.resourceId ? {
        resourceId: snapshot.resourceId,
        title: null,
        artist: null,
        album: null,
        durationSeconds: snapshot.durationSeconds,
      } : null),
      queueItems: snapshot.queueItems ?? queueResourceIds.map((resourceId) => ({
        resourceId,
        title: null,
        artist: null,
        album: null,
        durationSeconds: null,
      })),
      queuePosition,
      source: snapshot.source ?? (snapshot.loadId === null ? null : { type: "finite" }),
      dynamicQueue: snapshot.dynamicQueue ?? false,
      shuffleMode: snapshot.shuffleMode ?? "off",
      repeatMode: snapshot.repeatMode ?? "none",
      canSetShuffleMode: snapshot.canSetShuffleMode ?? true,
      canSetRepeatMode: snapshot.canSetRepeatMode ?? true,
      canSeek: snapshot.canSeek ?? true,
      canSkipNext: snapshot.canSkipNext ?? (
        queuePosition >= 0 && queuePosition < queueResourceIds.length - 1 ||
        snapshot.repeatMode === "all" || snapshot.repeatMode === "one"
      ),
      canSkipPrevious: snapshot.canSkipPrevious ?? (
        queuePosition > 0 || snapshot.repeatMode === "all" || snapshot.repeatMode === "one"
      ),
    })
  }

  exit(errorCode = "worker_crashed"): void {
    this.onExit(errorCode)
  }

  emitSpectrum(
    frame: Omit<Extract<PlaybackWorkerResponse, { type: "spectrum" }>, "type">,
  ): void {
    this.onSpectrum({ type: "spectrum", ...frame })
  }
}

export function setupController(overrides: {
  profilePath?: string
  playGate?: Promise<void>
  removeProfile?: (profilePath: string) => Promise<void>
  logger?: PlaybackLogger
} = {}): {
  controller: ApplePlaybackController
  workers: FakeWorker[]
} {
  const workers: FakeWorker[] = []
  const controller = new ApplePlaybackController({
    serviceUrl: "http://127.0.0.1:8787",
    executablePath: "/test/chromium",
    profilePath: overrides.profilePath ?? "/test/profile",
    removeProfile: overrides.removeProfile,
    logger: overrides.logger,
    fetch: async () => Response.json({
      token: "developer-token",
      expiresAt: "2030-01-01T00:00:00.000Z",
      mode: "apple",
    }),
    useMusicUserToken: (use) => Promise.resolve(use("music-user-token")),
    createWorkerClient: (onSnapshot, onExit, onSpectrum) => {
      const worker = new FakeWorker(onSnapshot, onExit, onSpectrum)
      worker.playGate = overrides.playGate
      workers.push(worker)
      return worker
    },
  })
  return { controller, workers }
}

function appleTrack(name: string, resourceId: string): AppleCatalogTrack {
  return {
    id: `apple:song:${name}`,
    title: name,
    artist: "artist",
    album: "album",
    durationSeconds: 180,
    apple: {
      resourceId,
      resourceType: "songs",
      playParams: { id: resourceId, kind: "song" },
    },
  }
}

export function appleStation(isLive: boolean): AppleCatalogStation {
  return {
    id: "apple:station:ra.123",
    title: "Discovery Station",
    isLive,
    apple: {
      resourceId: "ra.123",
      resourceType: "stations",
      playParams: { id: "ra.123", kind: "radioStation" },
      artwork: { url: "https://example.test/artwork", width: 100, height: 100 },
    },
  }
}
