import { expect, test } from "bun:test"

import type { Track } from "../../core/types"
import { TrackStore } from "./track-store"

test("retains tracks until every owning source releases them", () => {
  const shared = track("shared")
  const store = new TrackStore([shared])
  store.replace("search", [shared, track("search")])
  store.replace("playback", [shared, track("playing")])

  store.clear("search")
  expect(store.get("search")).toBeUndefined()
  expect(store.get("shared")).toBe(shared)
  expect(store.get("playing")?.id).toBe("playing")

  store.clear("playback")
  expect(store.get("playing")).toBeUndefined()
  expect(store.get("shared")).toBe(shared)
})

test("replacing one source does not disturb another source", () => {
  const store = new TrackStore([])
  store.replace("browse", [track("browse")])
  store.add("playlist", [track("first"), track("second")])
  store.replace("playlist", [track("second")])

  expect(store.get("first")).toBeUndefined()
  expect(store.get("second")?.id).toBe("second")
  expect(store.get("browse")?.id).toBe("browse")
})

function track(id: string): Track {
  return { id, title: id, artist: "artist", album: "album", durationSeconds: 1 }
}
