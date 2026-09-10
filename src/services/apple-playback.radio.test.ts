import { describe, expect, test } from "bun:test"

import { setupController, appleStation } from "./test-support/playback-fixtures"

describe("ApplePlaybackController: radio", () => {
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
})
