import { expect, test } from "bun:test"

import { PlaybackWorkerState } from "./apple-playback-worker-state"

test("restores the previous load when a replacement fails", () => {
  const state = new PlaybackWorkerState()
  state.beginLoad(1, { type: "finite" }, ["song-1"])
  state.confirm("playing")

  const previous = state.beginLoad(
    2,
    { type: "station", stationId: "station-1", title: "Station", isLive: false },
    [],
  )
  state.restore(previous, "paused")

  expect(state.snapshot).toEqual({
    loadId: 1,
    resourceIds: ["song-1"],
    source: { type: "finite" },
    status: "paused",
  })
})

test("reconciles unsolicited browser transitions without changing state during commands", () => {
  const state = new PlaybackWorkerState()
  state.beginLoad(3, { type: "finite" }, ["song-3"])
  state.confirm("playing")

  expect(state.reconcile({ initialized: true, playbackState: 0 }, true)).toBeNull()
  expect(state.snapshot.status).toBe("playing")

  expect(state.reconcile({ initialized: true, playbackState: 0 }, false)).toBe("stop-spectrum")
  expect(state.snapshot).toEqual({
    loadId: null,
    resourceIds: [],
    source: null,
    status: "idle",
  })
})

test("allows the worker entrypoint to be imported without starting process I/O", async () => {
  const worker = await import("./apple-playback-worker")
  expect(worker.runPlaybackWorker).toBeFunction()
})
