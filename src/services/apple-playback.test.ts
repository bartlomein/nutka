import { describe, expect, test } from "bun:test"
import { mkdtemp, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type {
  AppleCatalogStation,
  AppleCatalogTrack,
  PlaybackRepeatMode,
  PlaybackShuffleMode,
} from "../core/types"
import type {
  PlaybackWorkerResponse,
  PlaybackWorkerTrack,
} from "./apple-playback-protocol"
import {
  ApplePlaybackError,
  ApplePlaybackController,
  type PlaybackWorkerClient,
} from "./apple-playback"
import type { PlaybackLogger } from "./playback-log"

const tracks = [
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

describe("ApplePlaybackController", () => {
  test("publishes generated station songs and keeps next available with an empty queue", async () => {
    const { controller, workers } = setupController()
    const station = appleStation(false)
    await controller.playStation(station)
    const worker = workers[0]!
    expect(worker.stations).toEqual([{
      loadId: 1,
      stationResourceId: "ra.123",
      title: "Discovery Station",
      isLive: false,
    }])
    expect(controller.snapshot.status).toBe("idle")

    worker.emit({
      loadId: 1,
      resourceId: "generated-song",
      queueResourceIds: [],
      queuePosition: -1,
      currentItem: {
        resourceId: "generated-song",
        title: "A Generated Song",
        artist: "A Generated Artist",
        album: null,
        durationSeconds: 201,
      },
      queueItems: [],
      source: {
        type: "station",
        stationId: "ra.123",
        title: "Discovery Station",
        isLive: false,
      },
      dynamicQueue: true,
      status: "playing",
      positionSeconds: 3,
      durationSeconds: 201,
      errorCode: null,
      audioQuality: null,
      canSeek: true,
      canSkipNext: true,
      canSkipPrevious: false,
    })

    expect(controller.snapshot).toMatchObject({
      source: {
        type: "station",
        id: "ra.123",
        title: "Discovery Station",
        isLive: false,
      },
      dynamicQueue: true,
      queue: [],
      currentTrack: {
        id: "apple:song:generated-song",
        title: "A Generated Song",
        artist: "A Generated Artist",
        album: "Discovery Station",
        durationSeconds: 201,
        apple: {
          resourceId: "generated-song",
          resourceType: "songs",
          playParams: { id: "generated-song", kind: "song" },
        },
      },
    })
    await controller.next()
    await controller.previous()
    expect(worker.nextCount).toBe(1)
    expect(worker.previousCount).toBe(0)
    await controller.dispose()
  })

  test("plays catalog stations without optional play parameters and logs confirmation", async () => {
    const events: Array<{ event: string; code?: string; resourceId?: string }> = []
    const { controller, workers } = setupController({
      logger: {
        log: (event, details) => events.push({ event, ...details }),
      },
    })
    const station = appleStation(false)
    delete station.apple.playParams

    await controller.playStation(station)

    expect(workers[0]!.stations).toEqual([{
      loadId: 1,
      stationResourceId: "ra.123",
      title: "Discovery Station",
      isLive: false,
    }])
    expect(events).toEqual([
      { event: "station_play_requested", resourceId: "ra.123" },
      { event: "station_play_confirmed", resourceId: "ra.123" },
    ])
    await controller.dispose()
  })

  test("rejects known unavailable external live streams without starting the worker", async () => {
    const events: Array<{ event: string; code?: string; resourceId?: string }> = []
    const { controller, workers } = setupController({
      logger: {
        log: (event, details) => events.push({ event, ...details }),
      },
    })
    const station = appleStation(true)
    station.apple.externalLiveStream = true

    await expect(controller.playStation(station)).rejects.toMatchObject({
      code: "external_station_unsupported",
    })

    expect(workers).toHaveLength(0)
    expect(controller.snapshot.errorCode).toBe("external_station_unsupported")
    expect(events.at(-1)).toEqual({
      event: "station_play_failed",
      resourceId: "ra.123",
      code: "external_station_unsupported",
    })
    await controller.dispose()
  })

  test("gates live station transport using confirmed conservative capabilities", async () => {
    const { controller, workers } = setupController()
    await controller.playStation(appleStation(true))
    const worker = workers[0]!
    worker.emit({
      loadId: 1,
      resourceId: "live-song",
      queueResourceIds: [],
      queuePosition: -1,
      source: {
        type: "station",
        stationId: "ra.123",
        title: "Discovery Station",
        isLive: true,
      },
      dynamicQueue: true,
      status: "playing",
      positionSeconds: 3,
      durationSeconds: null,
      errorCode: null,
      audioQuality: null,
      canSeek: false,
      canSkipNext: false,
      canSkipPrevious: false,
    })
    await controller.seek(20)
    await controller.next()
    await controller.previous()
    expect(worker.nextCount).toBe(0)
    expect(worker.previousCount).toBe(0)
    expect(controller.snapshot.dynamicQueue).toBe(true)
    await controller.dispose()
  })

  test("maps worker-confirmed resource IDs back to tracks without optimistic state", async () => {
    const { controller, workers } = setupController()
    const snapshots: string[] = []
    controller.subscribe((snapshot) => snapshots.push(snapshot.status))

    await controller.play(tracks[0], tracks.slice(1))
    const worker = workers[0]!
    expect(controller.snapshot.status).toBe("idle")
    expect(worker.plays[0]).toEqual({
      loadId: 1,
      tracks: [
        { trackId: "apple:song:one", resourceId: "1" },
        { trackId: "apple:song:two", resourceId: "2" },
        { trackId: "apple:song:three", resourceId: "3" },
      ],
    })

    worker.emit({
      loadId: 1,
      resourceId: "1",
      status: "playing",
      positionSeconds: 7,
      durationSeconds: 180,
      errorCode: null,
      audioQuality: { format: "aac", bitrateKbps: 256, source: "playback" },
    })
    expect(controller.snapshot).toMatchObject({
      status: "playing",
      currentTrack: tracks[0],
      queue: [tracks[1], tracks[2]],
      positionSeconds: 7,
    })
    expect(controller.snapshot.currentTrack?.audioQuality).toEqual({
      format: "aac",
      bitrateKbps: 256,
      source: "playback",
    })

    worker.emit({
      loadId: 1,
      resourceId: "2",
      status: "playing",
      positionSeconds: 1,
      durationSeconds: 180,
      errorCode: null,
      audioQuality: null,
    })
    expect(controller.snapshot.currentTrack).toBe(tracks[1])
    expect(controller.snapshot.queue).toEqual([tracks[2]])
    expect(snapshots).toEqual(["idle", "playing", "playing"])
    await controller.dispose()
  })

  test("maps shuffled queue order and confirms playback modes without optimism", async () => {
    const { controller, workers } = setupController()
    await controller.play(tracks[0], tracks.slice(1))
    const worker = workers[0]!
    worker.emit({
      loadId: 1,
      resourceId: "1",
      queueResourceIds: ["1", "3", "2"],
      queuePosition: 0,
      status: "playing",
      positionSeconds: 2,
      durationSeconds: 180,
      errorCode: null,
      audioQuality: null,
      shuffleMode: "songs",
      repeatMode: "none",
    })

    expect(controller.snapshot.queue).toEqual([tracks[2], tracks[1]])
    expect(controller.snapshot.shuffleMode).toBe("songs")
    await controller.setShuffleMode("off")
    expect(worker.shuffleModeChanges).toEqual(["off"])
    expect(controller.snapshot.shuffleMode).toBe("songs")

    worker.emit({
      loadId: 1,
      resourceId: "1",
      status: "playing",
      positionSeconds: 2,
      durationSeconds: 180,
      errorCode: null,
      audioQuality: null,
      shuffleMode: "off",
      repeatMode: "none",
    })
    await controller.setRepeatMode("all")
    expect(worker.repeatModeChanges).toEqual(["all"])
    expect(controller.snapshot.repeatMode).toBe("none")
    await controller.dispose()
  })

  test("preserves unknown finite-queue items and their queue positions", async () => {
    const { controller, workers } = setupController()
    await controller.play(tracks[0], tracks.slice(1))
    const worker = workers[0]!
    worker.emit({
      loadId: 1,
      resourceId: "generated",
      queueResourceIds: ["1", "generated", "3"],
      queuePosition: 1,
      currentItem: {
        resourceId: "generated",
        title: "Generated Song",
        artist: "Generated Artist",
        album: "Generated Album",
        durationSeconds: 210,
      },
      status: "playing",
      positionSeconds: 4,
      durationSeconds: 210,
      errorCode: null,
      audioQuality: null,
    })

    expect(controller.snapshot.currentTrack).toMatchObject({
      id: "apple:song:generated",
      title: "Generated Song",
      artist: "Generated Artist",
    })
    expect(controller.snapshot.queue).toEqual([tracks[2]])
    await controller.dispose()
  })

  test("allows previous to follow repeat behavior at the start of the queue", async () => {
    const { controller, workers } = setupController()
    await controller.play(tracks[0], tracks.slice(1))
    const worker = workers[0]!
    worker.emit({
      loadId: 1,
      resourceId: "1",
      status: "playing",
      positionSeconds: 2,
      durationSeconds: 180,
      errorCode: null,
      audioQuality: null,
    })

    await controller.previous()
    expect(worker.previousCount).toBe(0)

    worker.emit({
      loadId: 1,
      resourceId: "1",
      status: "playing",
      positionSeconds: 2,
      durationSeconds: 180,
      errorCode: null,
      audioQuality: null,
      repeatMode: "one",
    })
    await controller.previous()
    expect(worker.previousCount).toBe(1)

    worker.emit({
      loadId: 1,
      resourceId: "1",
      status: "playing",
      positionSeconds: 2,
      durationSeconds: 180,
      errorCode: null,
      audioQuality: null,
      repeatMode: "all",
    })
    await controller.previous()
    expect(worker.previousCount).toBe(2)
    await controller.dispose()
  })

  test("does not restart a retained repeat queue after playback becomes idle", async () => {
    const { controller, workers } = setupController()
    await controller.play(tracks[0], [])
    const worker = workers[0]!
    worker.emit({
      loadId: null,
      resourceId: null,
      queueResourceIds: [],
      queuePosition: -1,
      status: "idle",
      positionSeconds: 0,
      durationSeconds: null,
      errorCode: null,
      audioQuality: null,
      repeatMode: "one",
    })

    await controller.next()
    expect(worker.nextCount).toBe(0)
    await controller.dispose()
  })

  test("does not change pause or resume state until the worker confirms it", async () => {
    const { controller, workers } = setupController()
    await controller.play(tracks[0], [])
    const worker = workers[0]!
    worker.emit({
      loadId: 1,
      resourceId: "1",
      status: "playing",
      positionSeconds: 2,
      durationSeconds: 180,
      errorCode: null,
      audioQuality: null,
    })

    await controller.pause()
    expect(worker.pauseCount).toBe(1)
    expect(controller.snapshot.status).toBe("playing")
    worker.emit({
      loadId: 1,
      resourceId: "1",
      status: "paused",
      positionSeconds: 3,
      durationSeconds: 180,
      errorCode: null,
      audioQuality: null,
    })
    await controller.resume()
    expect(worker.resumeCount).toBe(1)
    expect(controller.snapshot.status).toBe("paused")
    await controller.dispose()
  })

  test("publishes only analysis frames for the active confirmed load", async () => {
    const { controller, workers } = setupController()
    const frames: Array<readonly number[] | null> = []
    controller.audioAnalysis.subscribe((frame) => frames.push(frame?.bands ?? null))

    await controller.play(tracks[0], [])
    const worker = workers[0]!
    worker.emitSpectrum({
      loadId: 1,
      sequence: 0,
      bands: Array.from({ length: 64 }, () => 100),
      rms: 100,
      peak: 120,
    })
    expect(frames).toEqual([null])

    worker.emit({
      loadId: 1,
      resourceId: "1",
      status: "playing",
      positionSeconds: 1,
      durationSeconds: 180,
      errorCode: null,
      audioQuality: null,
    })
    worker.emitSpectrum({
      loadId: 1,
      sequence: 1,
      bands: Array.from({ length: 64 }, () => 140),
      rms: 130,
      peak: 180,
    })
    expect(frames.at(-1)?.[0]).toBe(140)

    await controller.play(tracks[1], [])
    worker.emitSpectrum({
      loadId: 1,
      sequence: 2,
      bands: Array.from({ length: 64 }, () => 220),
      rms: 200,
      peak: 240,
    })
    expect(frames.at(-1)).toBeNull()

    worker.emit({
      loadId: 2,
      resourceId: "2",
      status: "playing",
      positionSeconds: 1,
      durationSeconds: 180,
      errorCode: null,
      audioQuality: null,
    })
    worker.emitSpectrum({
      loadId: 2,
      sequence: 3,
      bands: Array.from({ length: 64 }, () => 200),
      rms: 180,
      peak: 230,
    })
    expect(frames.at(-1)?.[0]).toBe(200)

    await controller.disconnect()
    expect(frames.at(-1)).toBeNull()
    await controller.dispose()
  })

  test("isolates throwing analysis listeners from playback updates", async () => {
    const { controller, workers } = setupController()
    const received: number[] = []
    controller.audioAnalysis.subscribe(() => {
      throw new Error("renderer failed")
    })
    controller.audioAnalysis.subscribe((frame) => {
      if (frame) received.push(frame.sequence)
    })
    await controller.play(tracks[0], [])
    const worker = workers[0]!
    worker.emit({
      loadId: 1,
      resourceId: "1",
      status: "playing",
      positionSeconds: 1,
      durationSeconds: 180,
      errorCode: null,
      audioQuality: null,
    })
    worker.emitSpectrum({
      loadId: 1,
      sequence: 4,
      bands: Array.from({ length: 64 }, () => 100),
      rms: 100,
      peak: 120,
    })

    expect(received).toEqual([4])
    expect(controller.snapshot.status).toBe("playing")
    await controller.dispose()
  })

  test("suspends analysis without starting a worker and restores it on demand", async () => {
    const { controller, workers } = setupController()
    const frames: Array<readonly number[] | null> = []
    controller.audioAnalysis.subscribe((frame) => frames.push(frame?.bands ?? null))

    await controller.audioAnalysis.setEnabled(false)
    expect(workers).toHaveLength(0)
    await controller.play(tracks[0], [])
    const worker = workers[0]!
    expect(worker.analysisEnabledChanges).toEqual([false])
    worker.emit({
      loadId: 1,
      resourceId: "1",
      status: "playing",
      positionSeconds: 1,
      durationSeconds: 180,
      errorCode: null,
      audioQuality: null,
    })
    worker.emitSpectrum({
      loadId: 1,
      sequence: 1,
      bands: Array.from({ length: 64 }, () => 180),
      rms: 160,
      peak: 220,
    })
    expect(frames).toEqual([null])

    await controller.audioAnalysis.setEnabled(true)
    expect(worker.analysisEnabledChanges).toEqual([false, true])
    worker.emitSpectrum({
      loadId: 1,
      sequence: 2,
      bands: Array.from({ length: 64 }, () => 200),
      rms: 180,
      peak: 230,
    })
    expect(frames.at(-1)?.[0]).toBe(200)

    let releaseAnalysis!: () => void
    worker.analysisGate = new Promise<void>((resolve) => (releaseAnalysis = resolve))
    const disabling = controller.audioAnalysis.setEnabled(false)
    const enabling = controller.audioAnalysis.setEnabled(true)
    worker.emitSpectrum({
      loadId: 1,
      sequence: 3,
      bands: Array.from({ length: 64 }, () => 230),
      rms: 210,
      peak: 245,
    })
    expect(frames.at(-1)).toBeNull()
    releaseAnalysis()
    await Promise.all([disabling, enabling])
    worker.analysisGate = undefined
    worker.emitSpectrum({
      loadId: 1,
      sequence: 4,
      bands: Array.from({ length: 64 }, () => 210),
      rms: 190,
      peak: 235,
    })
    expect(frames.at(-1)?.[0]).toBe(210)

    await controller.audioAnalysis.setEnabled(false)
    expect(frames.at(-1)).toBeNull()
    worker.emitSpectrum({
      loadId: 1,
      sequence: 5,
      bands: Array.from({ length: 64 }, () => 240),
      rms: 220,
      peak: 250,
    })
    expect(frames.at(-1)).toBeNull()
    await controller.dispose()
  })

  test("moves through the loaded queue without optimistic track changes", async () => {
    const { controller, workers } = setupController()
    await controller.play(tracks[0], tracks.slice(1))
    const worker = workers[0]!
    worker.emit({
      loadId: 1,
      resourceId: "1",
      status: "playing",
      positionSeconds: 2,
      durationSeconds: 180,
      errorCode: null,
      audioQuality: null,
    })

    await controller.previous()
    expect(worker.previousCount).toBe(0)
    await controller.next()
    expect(worker.nextCount).toBe(1)
    expect(controller.snapshot.currentTrack).toBe(tracks[0])

    worker.emit({
      loadId: 1,
      resourceId: "2",
      status: "playing",
      positionSeconds: 1,
      durationSeconds: 180,
      errorCode: null,
      audioQuality: null,
    })
    await controller.previous()
    expect(worker.previousCount).toBe(1)
    expect(controller.snapshot.currentTrack).toBe(tracks[1])
    await controller.dispose()
  })

  test("clears state after a crash and starts a fresh worker on retry", async () => {
    const { controller, workers } = setupController()
    await controller.play(tracks[0], [])
    workers[0]!.emit({
      loadId: 1,
      resourceId: "1",
      status: "playing",
      positionSeconds: 2,
      durationSeconds: 180,
      errorCode: null,
      audioQuality: null,
    })
    workers[0]!.exit()

    expect(controller.snapshot).toEqual({
      status: "idle",
      currentTrack: null,
      queue: [],
      positionSeconds: 0,
      durationSeconds: null,
      errorCode: "worker_crashed",
      shuffleMode: "off",
      repeatMode: "none",
      canSetShuffleMode: false,
      canSetRepeatMode: false,
      source: null,
      dynamicQueue: false,
      canSeek: false,
      canSkipNext: false,
      canSkipPrevious: false,
    })

    await controller.play(tracks[1], [])
    expect(workers).toHaveLength(2)
    expect(workers[1]!.plays[0]?.tracks[0]?.resourceId).toBe("2")
    await controller.dispose()
  })

  test("ignores delayed callbacks from a replaced crashed worker", async () => {
    const { controller, workers } = setupController()
    await controller.play(tracks[0], [])
    const firstWorker = workers[0]!
    firstWorker.exit()

    await controller.play(tracks[1], [])
    const replacement = workers[1]!
    replacement.emit({
      loadId: 2,
      resourceId: "2",
      status: "playing",
      positionSeconds: 8,
      durationSeconds: 180,
      errorCode: null,
      audioQuality: null,
    })
    firstWorker.emit({
      loadId: 1,
      resourceId: "1",
      status: "playing",
      positionSeconds: 40,
      durationSeconds: 180,
      errorCode: null,
      audioQuality: null,
    })
    firstWorker.exit("late_worker_exit")

    expect(controller.snapshot).toMatchObject({
      status: "playing",
      currentTrack: tracks[1],
      positionSeconds: 8,
      errorCode: null,
    })
    await controller.dispose()
  })

  test("injects credentials only through worker initialization and disconnects cleanly", async () => {
    const { controller, workers } = setupController()
    await controller.play(tracks[0], [])
    expect(workers[0]!.initialization).toEqual({
      executablePath: "/test/chromium",
      playbackUrl: "http://127.0.0.1:8787/playback",
      profilePath: "/test/profile",
      developerToken: "developer-token",
      musicUserToken: "music-user-token",
    })

    await controller.disconnect()
    expect(workers[0]!.disposeCount).toBe(1)
    expect(controller.snapshot).toEqual({
      status: "idle",
      currentTrack: null,
      queue: [],
      positionSeconds: 0,
      durationSeconds: null,
      errorCode: null,
      shuffleMode: "off",
      repeatMode: "none",
      canSetShuffleMode: false,
      canSetRepeatMode: false,
      source: null,
      dynamicQueue: false,
      canSeek: false,
      canSkipNext: false,
      canSkipPrevious: false,
    })
    await controller.dispose()
  })

  test("rejects a non-loopback playback origin before fetching or injecting tokens", async () => {
    let fetchCount = 0
    const controller = new ApplePlaybackController({
      serviceUrl: "https://music.example.test",
      fetch: async () => {
        fetchCount++
        return Response.json({})
      },
      useMusicUserToken: () => Promise.reject(new Error("must not run")),
    })

    await expect(controller.play(tracks[0], [])).rejects.toMatchObject({
      code: "untrusted_playback_origin",
    })
    expect(fetchCount).toBe(0)
    await controller.dispose()
  })

  test("rejects overlapping commands instead of timing them out in the worker queue", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { controller, workers } = setupController({ playGate: gate })
    const firstPlay = controller.play(tracks[0], [])
    const secondPlay = controller.play(tracks[1], [])

    await expect(secondPlay).rejects.toMatchObject({ code: "command_in_progress" })
    release()
    await firstPlay
    expect(workers[0]!.plays).toHaveLength(1)
    await controller.dispose()
  })

  test("removes the dedicated playback profile when authorization is cleared", async () => {
    const profilePath = await mkdtemp(join(tmpdir(), "nutka-profile-test-"))
    await writeFile(join(profilePath, "authorization-state"), "private")
    const { controller } = setupController({ profilePath })

    await controller.clearAuthorization()
    await expect(stat(profilePath)).rejects.toBeDefined()
    expect(controller.snapshot.status).toBe("idle")
    await expect(controller.play(tracks[0], [])).rejects.toMatchObject({
      code: "authorization_invalid",
    })
    controller.enableAuthorization()
    await controller.dispose()
  })

  test("keeps playback authorization enabled if profile removal fails", async () => {
    const { controller, workers } = setupController({
      removeProfile: async () => {
        throw new Error("profile removal failed")
      },
    })

    await expect(controller.clearAuthorization()).rejects.toBeDefined()
    await controller.play(tracks[0], [])
    expect(workers[0]!.plays).toHaveLength(1)
    await controller.dispose()
  })

  test("does not apply a stale command error after disconnect", async () => {
    let rejectPlay!: (error: unknown) => void
    const gate = new Promise<void>((_resolve, reject) => (rejectPlay = reject))
    const { controller, workers } = setupController({ playGate: gate })
    const playing = controller.play(tracks[0], [])
    while (workers[0]?.plays.length !== 1) await Bun.sleep(0)

    await controller.disconnect()
    rejectPlay(new ApplePlaybackError("control_failed"))
    await expect(playing).rejects.toMatchObject({ code: "control_failed" })
    expect(controller.snapshot).toEqual({
      status: "idle",
      currentTrack: null,
      queue: [],
      positionSeconds: 0,
      durationSeconds: null,
      errorCode: null,
      shuffleMode: "off",
      repeatMode: "none",
      canSetShuffleMode: false,
      canSetRepeatMode: false,
      source: null,
      dynamicQueue: false,
      canSeek: false,
      canSkipNext: false,
      canSkipPrevious: false,
    })
    await controller.dispose()
  })

  test("rejects a delayed successful command from a disconnected worker", async () => {
    let releasePlay!: () => void
    const gate = new Promise<void>((resolve) => (releasePlay = resolve))
    const { controller, workers } = setupController({ playGate: gate })
    const playing = controller.play(tracks[0], [])
    while (workers[0]?.plays.length !== 1) await Bun.sleep(0)

    await controller.disconnect()
    releasePlay()

    await expect(playing).rejects.toMatchObject({ code: "worker_disconnected" })
    expect(controller.snapshot).toEqual({
      status: "idle",
      currentTrack: null,
      queue: [],
      positionSeconds: 0,
      durationSeconds: null,
      errorCode: null,
      shuffleMode: "off",
      repeatMode: "none",
      canSetShuffleMode: false,
      canSetRepeatMode: false,
      source: null,
      dynamicQueue: false,
      canSeek: false,
      canSkipNext: false,
      canSkipPrevious: false,
    })
    await controller.dispose()
  })

  test("records sanitized diagnostics for swallowed listener failures", async () => {
    const entries: Array<{ event: string; code?: string }> = []
    const { controller } = setupController({
      logger: {
        log(event, details) {
          entries.push({ event, ...(details?.code ? { code: details.code } : {}) })
        },
      },
    })
    controller.subscribe(() => {
      throw new Error("private listener details")
    })

    expect(entries).toEqual([{ event: "snapshot_listener_failed", code: "control_failed" }])
    expect(JSON.stringify(entries)).not.toContain("private listener details")
    await controller.dispose()
  })
})

function setupController(overrides: {
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

function appleStation(isLive: boolean): AppleCatalogStation {
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
