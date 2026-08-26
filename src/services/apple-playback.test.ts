import { describe, expect, test } from "bun:test"
import { mkdtemp, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { AppleCatalogTrack } from "../core/types"
import type {
  PlaybackWorkerResponse,
  PlaybackWorkerTrack,
} from "./apple-playback-protocol"
import {
  ApplePlaybackError,
  ApplePlaybackController,
  type PlaybackWorkerClient,
} from "./apple-playback"

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
  pauseCount = 0
  resumeCount = 0
  stopCount = 0
  disposeCount = 0
  playGate?: Promise<void>

  constructor(
    private readonly onSnapshot: (
      snapshot: Extract<PlaybackWorkerResponse, { type: "snapshot" }>,
    ) => void,
    private readonly onExit: (errorCode: string) => void,
  ) {}

  async initialize(options: NonNullable<FakeWorker["initialization"]>): Promise<void> {
    this.initialization = options
  }

  async play(loadId: number, workerTracks: readonly PlaybackWorkerTrack[]): Promise<void> {
    this.plays.push({ loadId, tracks: workerTracks })
    await this.playGate
  }

  async pause(): Promise<void> {
    this.pauseCount++
  }

  async resume(): Promise<void> {
    this.resumeCount++
  }

  async seek(): Promise<void> {}

  async stop(): Promise<void> {
    this.stopCount++
  }

  async dispose(): Promise<void> {
    this.disposeCount++
  }

  emit(snapshot: Omit<Extract<PlaybackWorkerResponse, { type: "snapshot" }>, "type">): void {
    this.onSnapshot({ type: "snapshot", ...snapshot })
  }

  exit(errorCode = "worker_crashed"): void {
    this.onExit(errorCode)
  }
}

describe("ApplePlaybackController", () => {
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
    })

    await controller.play(tracks[1], [])
    expect(workers).toHaveLength(2)
    expect(workers[1]!.plays[0]?.tracks[0]?.resourceId).toBe("2")
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
    })
    await controller.dispose()
  })
})

function setupController(overrides: {
  profilePath?: string
  playGate?: Promise<void>
  removeProfile?: (profilePath: string) => Promise<void>
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
    fetch: async () => Response.json({
      token: "developer-token",
      expiresAt: "2030-01-01T00:00:00.000Z",
      mode: "apple",
    }),
    useMusicUserToken: (use) => Promise.resolve(use("music-user-token")),
    createWorkerClient: (onSnapshot, onExit) => {
      const worker = new FakeWorker(onSnapshot, onExit)
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
