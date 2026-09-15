import { afterEach, describe, expect, test } from "bun:test"

import { deferred, catalogTracks } from "./test-support/app-data"
import { FakePlaybackController } from "./test-support/fake-playback"
import { createAppFixture } from "./test-support/app-fixture"

const fixture = createAppFixture()
const { createApp } = fixture
afterEach(fixture.destroy)

describe("Nutka TUI: playback", () => {
  test("moves selection without simulating unavailable playback", async () => {
    await createApp()

    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("l")
    fixture.setup.mockInput.pressKey("j")
    fixture.setup.mockInput.pressEnter()
    fixture.setup.mockInput.pressKey(" ")

    expect(fixture.app.getState()).toMatchObject({
      destination: "library",
      lists: { library: { selectedTrackId: "track-b" } },
      playback: {
        currentTrackId: null,
        status: "idle",
        queueTrackIds: [],
      },
    })
  })

  test("plays the selected Apple song and renders only worker-confirmed state", async () => {
    const playback = new FakePlaybackController()
    await createApp({
      playback,
      searchSongs: async () => ({ items: catalogTracks, nextCursor: null }),
    })
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("s")
    await fixture.setup.mockInput.typeText("tracks")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)

    fixture.setup.mockInput.pressEnter()
    expect(playback.plays).toHaveLength(1)
    expect(playback.plays[0]?.track.id).toBe("apple:song:1")
    expect(playback.plays[0]?.upcomingTracks.map((track) => track.id)).toEqual([
      "apple:song:2",
    ])
    expect(fixture.app.getState().playback.status).toBe("idle")

    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [catalogTracks[1]!],
      positionSeconds: 12,
      durationSeconds: 180,
      errorCode: null,
      canSetShuffleMode: true,
      canSetRepeatMode: true,
    })
    await fixture.setup.renderOnce()
    expect(fixture.app.getState().playback).toMatchObject({
      currentTrackId: "apple:song:1",
      status: "playing",
      queueTrackIds: ["apple:song:2"],
      positionSeconds: 12,
    })
    expect(fixture.setup.captureCharFrame()).toContain("First Track")
    expect(fixture.setup.captureCharFrame()).toContain("0:12")
    expect(fixture.setup.captureCharFrame()).toContain("3:00")
    expect(fixture.setup.captureCharFrame()).toContain("NEXT  Second Track")
    expect(fixture.setup.captureCharFrame()).toContain("AUDIO  LOSSLESS")
    expect(fixture.setup.captureCharFrame()).toContain("DESTINATIONS")
    expect(fixture.setup.captureCharFrame()).toContain("› Search")
    expect(fixture.setup.captureCharFrame()).toContain("QUEUE")
    expect(fixture.setup.captureCharFrame()).toContain("NOW  First Track")
    expect(fixture.setup.captureCharFrame()).toContain("› Second Track")
    expect(fixture.setup.captureCharFrame()).toContain("SPECTRUM")

    const stateBeforeAnalysis = fixture.app.getState()
    playback.confirmAnalysis({
      sequence: 1,
      bands: Array.from({ length: 64 }, (_, index) => index * 4),
      rms: 160,
      peak: 240,
    })
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toMatch(/[▁▂▃▄▅▆▇█]/)
    expect(fixture.app.getState()).toEqual(stateBeforeAnalysis)

    fixture.setup.mockInput.pressArrow("right")
    await Bun.sleep(0)
    expect(playback.seekPositions).toEqual([17])
    playback.confirm({ ...playback.snapshot, positionSeconds: 17 })
    fixture.setup.mockInput.pressArrow("left", { shift: true })
    await Bun.sleep(0)
    expect(playback.seekPositions).toEqual([17, 2])

    fixture.setup.mockInput.pressKey(" ")
    expect(playback.pauseCount).toBe(1)
    expect(fixture.app.getState().playback.status).toBe("playing")
    playback.confirm({ ...playback.snapshot, status: "paused", positionSeconds: 13 })
    fixture.setup.mockInput.pressKey(" ")
    expect(playback.resumeCount).toBe(1)

    fixture.setup.mockInput.pressKey("n")
    fixture.setup.mockInput.pressKey("b")
    fixture.setup.mockInput.pressKey("s")
    fixture.setup.mockInput.pressKey("r")
    expect(playback.nextCount).toBe(1)
    expect(playback.previousCount).toBe(1)
    expect(playback.plays).toHaveLength(1)
    expect(playback.shuffleModeChanges).toEqual(["songs"])
    expect(playback.repeatModeChanges).toEqual(["all"])
    expect(fixture.app.getState().playback.shuffleMode).toBe("off")

    playback.confirm({
      ...playback.snapshot,
      shuffleMode: "songs",
      repeatMode: "all",
    })
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("S:ON")
    expect(fixture.setup.captureCharFrame()).toContain("R:ALL")

    fixture.setup.mockInput.pressKey("s")
    fixture.setup.mockInput.pressKey("r")
    expect(playback.shuffleModeChanges).toEqual(["songs", "off"])
    expect(playback.repeatModeChanges).toEqual(["all", "one"])

    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("q")
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("Second Track")
  })

  test("loads and toggles the current song like with optimistic feedback", async () => {
    const playback = new FakePlaybackController()
    const initialLike = deferred<boolean>()
    const savedLike = deferred<void>()
    const loads: string[] = []
    const saves: Array<{ resourceId: string; liked: boolean }> = []
    await createApp({
      tracks: catalogTracks,
      playback,
      getSongLiked: async (resourceId) => {
        loads.push(resourceId)
        return initialLike.promise
      },
      setSongLiked: async (resourceId, liked) => {
        saves.push({ resourceId, liked })
        return savedLike.promise
      },
    }, undefined, { onSignIn: () => {} })
    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })

    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [],
      positionSeconds: 0,
      durationSeconds: catalogTracks[0]!.durationSeconds,
      errorCode: null,
    })
    await fixture.setup.renderOnce()
    expect(loads).toEqual(["1"])
    expect(fixture.setup.captureCharFrame()).toContain("◌  First Track")

    initialLike.resolve(false)
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("☆  First Track")

    fixture.setup.mockInput.pressKey("l")
    await fixture.setup.renderOnce()
    expect(saves).toEqual([{ resourceId: "1", liked: true }])
    expect(fixture.setup.captureCharFrame()).toContain("★  First Track")

    savedLike.resolve()
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("★  First Track")

    fixture.setup.mockInput.pressKey("l")
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    expect(saves).toEqual([
      { resourceId: "1", liked: true },
      { resourceId: "1", liked: false },
    ])
    expect(fixture.setup.captureCharFrame()).toContain("☆  First Track")
  })

  test("rolls back a failed like change without exposing the service error", async () => {
    const playback = new FakePlaybackController()
    await createApp({
      tracks: catalogTracks,
      playback,
      getSongLiked: async () => true,
      setSongLiked: async () => {
        throw new Error("private service details")
      },
    }, undefined, { onSignIn: () => {} })
    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [],
      positionSeconds: 0,
      durationSeconds: catalogTracks[0]!.durationSeconds,
      errorCode: null,
    })
    await Bun.sleep(0)

    fixture.setup.mockInput.pressKey("l")
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    const frame = fixture.setup.captureCharFrame()
    expect(frame).toContain("★  First Track")
    expect(frame).toContain("Could not update favorite")
    expect(frame).not.toContain("private service details")
  })

  test("coalesces repeated scrubbing to the latest bounded seek", async () => {
    const firstSeek = deferred<void>()
    class SlowSeekPlaybackController extends FakePlaybackController {
      override async seek(positionSeconds: number): Promise<void> {
        this.seekPositions.push(positionSeconds)
        if (this.seekPositions.length === 1) await firstSeek.promise
      }
    }
    const playback = new SlowSeekPlaybackController()
    await createApp({ playback })
    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [],
      positionSeconds: 10,
      durationSeconds: 180,
      errorCode: null,
    })

    fixture.setup.mockInput.pressArrow("right")
    fixture.setup.mockInput.pressArrow("right")
    fixture.setup.mockInput.pressArrow("right", { shift: true })
    expect(playback.seekPositions).toEqual([15])

    firstSeek.resolve(undefined)
    await Bun.sleep(0)
    expect(playback.seekPositions).toEqual([15, 35])

    playback.confirm({ ...playback.snapshot, positionSeconds: 35 })
    playback.confirm({ ...playback.snapshot, positionSeconds: 178 })
    fixture.setup.mockInput.pressArrow("right", { shift: true })
    await Bun.sleep(0)
    expect(playback.seekPositions.at(-1)).toBe(180)
  })

  test("disconnects confirmed playback when Apple authorization changes", async () => {
    const playback = new FakePlaybackController()
    await createApp({ playback })
    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [],
      positionSeconds: 4,
      durationSeconds: 180,
      errorCode: null,
    })

    fixture.app.setAppleAuthStatus({ state: "signedOut" })
    expect(playback.disconnectCount).toBe(1)
    expect(fixture.app.getState().playback.status).toBe("idle")
    expect(fixture.app.getState().playback.currentTrackId).toBeNull()
  })

  test("exposes confirmed shuffle and repeat controls in the command palette", async () => {
    const playback = new FakePlaybackController()
    await createApp({ playback })
    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [catalogTracks[1]!],
      positionSeconds: 1,
      durationSeconds: 180,
      errorCode: null,
      canSetShuffleMode: true,
      canSetRepeatMode: true,
    })

    fixture.setup.mockInput.pressKey("p", { ctrl: true })
    await fixture.setup.mockInput.typeText("shuffle")
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("Toggle Shuffle")
    fixture.setup.mockInput.pressEnter()
    expect(playback.shuffleModeChanges).toEqual(["songs"])

    fixture.setup.mockInput.pressKey("p", { ctrl: true })
    await fixture.setup.mockInput.typeText("repeat mode")
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("Cycle Repeat Mode")
    fixture.setup.mockInput.pressEnter()
    expect(playback.repeatModeChanges).toEqual(["all"])
  })

  test("opens an honest empty queue before playback is connected", async () => {
    await createApp()

    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("q")
    await fixture.setup.renderOnce()

    expect(fixture.app.getState().destination).toBe("queue")
    expect(fixture.setup.captureCharFrame()).toContain("Queue")
    expect(fixture.setup.captureCharFrame()).toContain("queue is empty")
    expect(fixture.setup.captureCharFrame()).not.toContain("up next")
  })
})
