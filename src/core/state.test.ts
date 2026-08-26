import { describe, expect, test } from "bun:test"

import { fakeTracks } from "../data/fake-tracks"
import { filterTracks, initialState, reduceAppState } from "./state"

describe("filterTracks", () => {
  test("matches titles, artists, and albums without case sensitivity", () => {
    expect(filterTracks(fakeTracks, "glass").map((track) => track.id)).toEqual([
      "glass-horizon",
    ])
    expect(filterTracks(fakeTracks, "MIRA VALE")).toHaveLength(3)
    expect(filterTracks(fakeTracks, "liminal paths")).toHaveLength(3)
  })
})

describe("reduceAppState", () => {
  test("keeps track selection inside the available rows", () => {
    const atTop = reduceAppState(initialState, {
      type: "move",
      delta: -1,
      itemCount: 3,
    })
    const atBottom = reduceAppState(
      { ...initialState, selectedIndex: 2 },
      { type: "move", delta: 1, itemCount: 3 },
    )

    expect(atTop.selectedIndex).toBe(0)
    expect(atBottom.selectedIndex).toBe(2)
  })

  test("plays a selected track and toggles pause", () => {
    const playing = reduceAppState(initialState, {
      type: "play",
      trackId: "soft-static",
    })
    const paused = reduceAppState(playing, {
      type: "toggle-playback",
      selectedTrackId: null,
    })

    expect(playing.currentTrackId).toBe("soft-static")
    expect(playing.playbackStatus).toBe("playing")
    expect(paused.playbackStatus).toBe("paused")
  })

  test("resets selection when the search changes", () => {
    const searching = reduceAppState(
      { ...initialState, selectedIndex: 5 },
      { type: "set-query", query: "glass" },
    )

    expect(searching.query).toBe("glass")
    expect(searching.selectedIndex).toBe(0)
  })
})
