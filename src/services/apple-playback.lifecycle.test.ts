import { describe, expect, test } from "bun:test"
import { mkdtemp, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ApplePlaybackError, ApplePlaybackController } from "./apple-playback"
import { tracks, setupController } from "./test-support/playback-fixtures"

describe("ApplePlaybackController: lifecycle", () => {
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
