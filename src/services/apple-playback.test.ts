import { describe, expect, test } from "bun:test"

import { tracks, setupController } from "./test-support/playback-fixtures"

describe("ApplePlaybackController: queue and transport", () => {
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
})
