import { describe, expect, test } from "bun:test"

import type { AppleCatalogTrack } from "../../core/types"
import { appendUniqueTracks, getRowStart } from "./browse"

function track(id: string): AppleCatalogTrack {
  return {
    id: `apple:song:${id}`,
    title: `Track ${id}`,
    artist: "Artist",
    album: "Album",
    durationSeconds: 180,
    apple: {
      resourceId: id,
      resourceType: "songs",
      playParams: { id, kind: "song" },
    },
  }
}

describe("browse list helpers", () => {
  test("deduplicates tracks already loaded and repeated within a page", () => {
    const first = track("1")
    const second = track("2")

    expect(appendUniqueTracks([first], [first, second, second])).toEqual([first, second])
  })

  test("keeps a selected row centered without scrolling past the end", () => {
    expect(getRowStart(7, 20, 5)).toBe(5)
    expect(getRowStart(19, 20, 5)).toBe(15)
    expect(getRowStart(2, 4, 5)).toBe(0)
  })
})
