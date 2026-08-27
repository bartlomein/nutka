import { describe, expect, test } from "bun:test"

import type { Track } from "./types"
import {
  createInitialState,
  filterTracks,
  reduceAppState,
  type AppState,
} from "./state"

const trackIds = ["a", "b", "c"] as const
const tracks = [
  {
    id: "track-a",
    title: "First Track",
    artist: "Artist One",
    album: "First Album",
    durationSeconds: 180,
  },
  {
    id: "track-b",
    title: "Second Track",
    artist: "Artist Two",
    album: "Second Album",
    durationSeconds: 240,
  },
] as const satisfies readonly Track[]

function reduce(state: AppState, ...actions: Parameters<typeof reduceAppState>[1][]) {
  return actions.reduce(reduceAppState, state)
}

describe("createInitialState", () => {
  test("starts at Home while preserving the first Library track", () => {
    expect(createInitialState(trackIds)).toEqual({
      destination: "home",
      mode: { type: "normal", pendingKey: null },
      lists: {
        home: { selectedTrackId: null, filter: "" },
        library: { selectedTrackId: "a", filter: "" },
        playlists: { selectedTrackId: null, filter: "" },
        search: { selectedTrackId: null, filter: "" },
        queue: { selectedTrackId: null, filter: "" },
      },
      playback: {
        currentTrackId: null,
        status: "idle",
        queueTrackIds: [],
        positionSeconds: 0,
        durationSeconds: null,
        errorCode: null,
      },
    })
  })

  test("supports an empty library and creates fresh nested state", () => {
    const first = createInitialState([])
    const second = createInitialState([])

    expect(first.lists.home.selectedTrackId).toBeNull()
    expect(first.lists.library.selectedTrackId).toBeNull()
    expect(first.lists).not.toBe(second.lists)
    expect(first.playback.queueTrackIds).not.toBe(second.playback.queueTrackIds)
  })
})

describe("filterTracks", () => {
  test("matches title, artist, and album case-insensitively", () => {
    expect(filterTracks(tracks, "second").map((track) => track.id)).toEqual([
      "track-b",
    ])
    expect(filterTracks(tracks, "ARTIST ONE")).toHaveLength(1)
    expect(filterTracks(tracks, "second album")).toHaveLength(1)
  })

  test("trims the query and returns the original list for a blank query", () => {
    expect(filterTracks(tracks, "  SECOND  ")[0]?.id).toBe("track-b")
    expect(filterTracks(tracks, " \t ")).toBe(tracks)
  })

  test("returns an empty list when nothing matches", () => {
    expect(filterTracks(tracks, "not a real track")).toEqual([])
  })

  test("fuzzy matches ordered characters without reordering results", () => {
    expect(filterTracks(tracks, "frst trk").map((track) => track.id)).toEqual([
      "track-a",
    ])
  })
})

describe("list navigation", () => {
  test("moves and clamps selection using visible track IDs", () => {
    const initial = reduceAppState(createInitialState(trackIds), {
      type: "navigate",
      destination: "library",
    })
    const bottom = reduce(
      initial,
      { type: "move-selection", delta: 2, visibleTrackIds: trackIds },
      { type: "move-selection", delta: 5, visibleTrackIds: trackIds },
    )
    const top = reduceAppState(bottom, {
      type: "move-selection",
      delta: -10,
      visibleTrackIds: trackIds,
    })

    expect(bottom.lists.library.selectedTrackId).toBe("c")
    expect(top.lists.library.selectedTrackId).toBe("a")
  })

  test("recovers missing selection and clears selection for an empty list", () => {
    const missing = reduce(
      createInitialState(["gone"]),
      { type: "navigate", destination: "library" },
      { type: "move-selection", delta: 1, visibleTrackIds: ["a", "b"] },
    )
    const backwards = reduce(
      createInitialState(["gone"]),
      { type: "navigate", destination: "library" },
      { type: "move-selection", delta: -1, visibleTrackIds: ["a", "b"] },
    )
    const empty = reduceAppState(missing, {
      type: "move-selection",
      delta: 1,
      visibleTrackIds: [],
    })

    expect(missing.lists.library.selectedTrackId).toBe("a")
    expect(backwards.lists.library.selectedTrackId).toBe("b")
    expect(empty.lists.library.selectedTrackId).toBeNull()
  })

  test("keeps selection and filters independent per destination", () => {
    const state = reduce(
      createInitialState(trackIds),
      { type: "navigate", destination: "library" },
      { type: "select-track", trackId: "b" },
      { type: "navigate", destination: "queue" },
      { type: "select-track", trackId: "c" },
      { type: "navigate", destination: "library" },
    )

    expect(state.destination).toBe("library")
    expect(state.lists.library.selectedTrackId).toBe("b")
    expect(state.lists.queue.selectedTrackId).toBe("c")
  })

  test("preserves Home selection and filter across navigation", () => {
    const state = reduce(
      createInitialState(trackIds),
      { type: "select-track", trackId: "home-a" },
      { type: "open-filter" },
      {
        type: "edit-filter",
        draft: "featured",
        visibleTrackIds: ["home-b"],
      },
      { type: "submit-filter" },
      { type: "navigate", destination: "library" },
      { type: "move-selection", delta: 1, visibleTrackIds: trackIds },
      { type: "navigate", destination: "home" },
    )

    expect(state.destination).toBe("home")
    expect(state.lists.home).toEqual({
      selectedTrackId: "home-b",
      filter: "featured",
    })
    expect(state.lists.library.selectedTrackId).toBe("b")
  })
})

describe("catalog search input", () => {
  test("keeps submitted search input separate from local list filters", () => {
    const initial = createInitialState([])
    const editing = reduceAppState(initial, { type: "open-search", query: "radio" })
    const changed = reduceAppState(editing, {
      type: "edit-search",
      draft: "radiohead",
    })
    const results = reduceAppState(changed, {
      type: "reset-list",
      destination: "search",
      selectedTrackId: "apple:song:1",
    })

    expect(changed.mode).toEqual({ type: "search", draft: "radiohead" })
    expect(changed.lists.search.filter).toBe("")
    expect(results.lists.search).toEqual({
      selectedTrackId: "apple:song:1",
      filter: "",
    })
  })
})

describe("goto chord", () => {
  test("requires the prefix and consumes it after navigation", () => {
    const initial = createInitialState(trackIds)
    expect(
      reduceAppState(initial, { type: "goto", destination: "queue" }),
    ).toBe(initial)

    const pending = reduceAppState(initial, { type: "begin-goto" })
    const navigated = reduceAppState(pending, {
      type: "goto",
      destination: "search",
    })

    expect(pending.mode).toEqual({ type: "normal", pendingKey: "g" })
    expect(navigated.destination).toBe("search")
    expect(navigated.mode).toEqual({ type: "normal", pendingKey: null })
  })

  test("does not begin a goto chord from an overlay", () => {
    const help = reduceAppState(createInitialState(trackIds), {
      type: "open-help",
    })
    expect(reduceAppState(help, { type: "begin-goto" })).toBe(help)
  })
})

describe("filter mode", () => {
  test("opens from the committed filter and previews visible selection", () => {
    const filtered = reduce(
      createInitialState(trackIds),
      { type: "navigate", destination: "library" },
      { type: "open-filter" },
      { type: "edit-filter", draft: "be", visibleTrackIds: ["b"] },
    )

    expect(filtered.mode).toEqual({
      type: "filter",
      draft: "be",
      originalSelectedTrackId: "a",
    })
    expect(filtered.lists.library).toEqual({
      selectedTrackId: "b",
      filter: "",
    })
  })

  test("submits the draft and keeps the preview selection", () => {
    const submitted = reduce(
      createInitialState(trackIds),
      { type: "navigate", destination: "library" },
      { type: "open-filter" },
      { type: "edit-filter", draft: "be", visibleTrackIds: ["b"] },
      { type: "submit-filter" },
    )

    expect(submitted.mode).toEqual({ type: "normal", pendingKey: null })
    expect(submitted.lists.library).toEqual({
      selectedTrackId: "b",
      filter: "be",
    })
  })

  test("preserves selection while it remains visible", () => {
    const editing = reduce(
      createInitialState(trackIds),
      { type: "navigate", destination: "library" },
      { type: "select-track", trackId: "b" },
      { type: "open-filter" },
      { type: "edit-filter", draft: "", visibleTrackIds: trackIds },
    )

    expect(editing.lists.library.selectedTrackId).toBe("b")
  })

  test("cancel and generic close restore the original selection", () => {
    const editing = reduce(
      createInitialState(trackIds),
      { type: "navigate", destination: "library" },
      { type: "select-track", trackId: "b" },
      { type: "open-filter" },
      { type: "edit-filter", draft: "c", visibleTrackIds: ["c"] },
    )
    const cancelled = reduceAppState(editing, { type: "cancel-filter" })
    const closed = reduceAppState(editing, { type: "close-mode" })

    expect(cancelled.lists.library).toEqual({
      selectedTrackId: "b",
      filter: "",
    })
    expect(closed).toEqual(cancelled)
  })

  test("keeps an existing committed filter when canceling", () => {
    const committed = reduce(
      createInitialState(trackIds),
      { type: "navigate", destination: "library" },
      { type: "open-filter" },
      { type: "edit-filter", draft: "a", visibleTrackIds: ["a"] },
      { type: "submit-filter" },
      { type: "open-filter" },
    )
    const cancelled = reduceAppState(committed, { type: "cancel-filter" })

    expect(cancelled.lists.library.filter).toBe("a")
  })
})

describe("palette and help modes", () => {
  test("opens, edits, resets selection, and clamps palette movement", () => {
    const state = reduce(
      createInitialState(trackIds),
      { type: "open-palette" },
      { type: "move-palette", delta: 10, itemCount: 3 },
      { type: "edit-palette", query: "glass" },
      { type: "move-palette", delta: -1, itemCount: 3 },
    )

    expect(state.mode).toEqual({
      type: "palette",
      query: "glass",
      selectedIndex: 0,
    })
  })

  test("closes palette and help back to a clean normal mode", () => {
    const palette = reduceAppState(createInitialState(trackIds), {
      type: "open-palette",
    })
    const help = reduceAppState(palette, { type: "open-help" })
    const closed = reduceAppState(help, { type: "close-mode" })

    expect(help.mode).toEqual({ type: "help" })
    expect(closed.mode).toEqual({ type: "normal", pendingKey: null })
  })

  test("close mode cancels a pending goto chord", () => {
    const pending = reduceAppState(createInitialState(trackIds), {
      type: "begin-goto",
    })
    expect(reduceAppState(pending, { type: "close-mode" }).mode).toEqual({
      type: "normal",
      pendingKey: null,
    })
  })
})

describe("playback", () => {
  test("copies an exact worker-confirmed playback snapshot", () => {
    const upcoming = ["b", "c"]
    const playing = reduceAppState(createInitialState(trackIds), {
      type: "sync-playback",
      currentTrackId: "a",
      status: "playing",
      queueTrackIds: upcoming,
      positionSeconds: 12,
      durationSeconds: 180,
      errorCode: null,
    })
    upcoming.push("later")

    expect(playing.playback).toEqual({
      currentTrackId: "a",
      status: "playing",
      queueTrackIds: ["b", "c"],
      positionSeconds: 12,
      durationSeconds: 180,
      errorCode: null,
    })
    expect(playing.lists.queue.selectedTrackId).toBe("b")
  })

  test("clears a stale queue filter when playback replaces the queue", () => {
    const filteredQueue = reduce(
      createInitialState(trackIds),
      { type: "navigate", destination: "queue" },
      { type: "open-filter" },
      { type: "edit-filter", draft: "old", visibleTrackIds: [] },
      { type: "submit-filter" },
    )
    const playing = reduceAppState(filteredQueue, {
      type: "sync-playback",
      currentTrackId: "a",
      status: "playing",
      queueTrackIds: ["b", "c"],
      positionSeconds: 0,
      durationSeconds: 180,
      errorCode: null,
    })

    expect(playing.lists.queue).toEqual({
      selectedTrackId: "b",
      filter: "",
    })
  })

  test("accepts confirmed pause and error states", () => {
    const playing = reduceAppState(createInitialState(trackIds), {
      type: "sync-playback",
      currentTrackId: "a",
      status: "playing",
      queueTrackIds: ["b"],
      positionSeconds: 5,
      durationSeconds: 180,
      errorCode: null,
    })
    const paused = reduceAppState(playing, {
      type: "sync-playback",
      currentTrackId: "a",
      status: "paused",
      queueTrackIds: ["b"],
      positionSeconds: 6,
      durationSeconds: 180,
      errorCode: "control_failed",
    })

    expect(paused.playback).toEqual({
      currentTrackId: "a",
      status: "paused",
      queueTrackIds: ["b"],
      positionSeconds: 6,
      durationSeconds: 180,
      errorCode: "control_failed",
    })
  })

  test("preserves queue selection and filter across position snapshots", () => {
    const snapshot = {
      type: "sync-playback" as const,
      currentTrackId: "a",
      status: "playing" as const,
      queueTrackIds: ["b", "c"],
      positionSeconds: 1,
      durationSeconds: 180,
      errorCode: null,
    }
    const viewingQueue = reduce(
      reduceAppState(createInitialState(trackIds), snapshot),
      { type: "navigate", destination: "queue" },
      { type: "select-track", trackId: "c" },
      { type: "open-filter" },
      { type: "edit-filter", draft: "third", visibleTrackIds: ["c"] },
      { type: "submit-filter" },
    )
    const queueList = viewingQueue.lists.queue
    const progressed = reduceAppState(viewingQueue, {
      ...snapshot,
      positionSeconds: 2,
    })

    expect(progressed.lists.queue).toBe(queueList)
    expect(progressed.lists.queue).toEqual({
      selectedTrackId: "c",
      filter: "third",
    })

    const advanced = reduceAppState(progressed, {
      ...snapshot,
      currentTrackId: "b",
      queueTrackIds: ["c"],
      positionSeconds: 0,
    })
    expect(advanced.lists.queue).toEqual({
      selectedTrackId: "c",
      filter: "third",
    })

    const replaced = reduceAppState(progressed, {
      ...snapshot,
      currentTrackId: "c",
      queueTrackIds: ["a"],
      positionSeconds: 0,
    })
    expect(replaced.lists.queue.filter).toBe("")
  })
})
