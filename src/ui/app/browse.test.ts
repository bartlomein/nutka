import { describe, expect, test } from "bun:test"

import type {
  AppleCatalogPlaylist,
  AppleCatalogStation,
  AppleCatalogTrack,
  Station,
} from "../../core/types"
import {
  appendUniqueTracks,
  createRadioSectionStates,
  getRowStart,
  homeDisplayRows,
  homeItems,
  radioDisplayRows,
} from "./browse"

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
  test("renders ordered radio sections and deduplicates stations across them", () => {
    const sections = createRadioSectionStates()
    const shared: Station = { id: "shared", title: "Shared", isLive: false }
    sections.personal = { status: "ready", stations: [shared] }
    sections.live = {
      status: "ready",
      stations: [shared, { id: "live", title: "Apple Music 1", isLive: true }],
    }
    sections.recent = { status: "ready", stations: [shared] }

    const rows = radioDisplayRows(sections)
    expect(rows.filter((row) => row.kind === "heading").map((row) => row.title)).toEqual([
      "FAVORITE STATIONS",
      "MY STATION",
      "LIVE NOW",
      "RECENTLY PLAYED",
      "BROWSE BY GENRE",
    ])
    expect(rows.filter((row) => row.kind === "station").map((row) => row.station.id)).toEqual([
      "shared",
      "live",
    ])
    expect(rows).toContainEqual({ kind: "message", title: "already shown above" })
  })

  test("renders favorite and recommended stations as mixed Home rows", () => {
    const favorite: AppleCatalogStation = {
      id: "apple:station:npr",
      title: "NPR",
      isLive: true,
      apple: {
        resourceId: "npr",
        resourceType: "stations",
        playParams: { id: "npr", kind: "radioStation" },
        artwork: { url: "https://example.test/npr", width: 100, height: 100 },
      },
    }
    const playlist: AppleCatalogPlaylist = {
      id: "apple:playlist:mix",
      title: "Mix",
      curator: "Apple Music",
      apple: { resourceId: "mix", resourceType: "playlists" },
    }
    const sections = [{ id: "made", title: "Made for You", items: [playlist, favorite] }]
    const items = homeItems([favorite], sections)
    const rows = homeDisplayRows([favorite], sections, items)

    expect(items.map((item) => item.id)).toEqual([favorite.id, playlist.id])
    expect(rows.map((row) => row.kind === "heading" ? row.title : row.kind)).toEqual([
      "FAVORITE STATIONS",
      "station",
      "Made for You",
      "playlist",
    ])
  })

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
