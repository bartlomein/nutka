import { afterEach, describe, expect, test } from "bun:test"

import type { AppleLibrarySong } from "../../core/types"
import type { LibraryServices } from "./library-controller"
import { catalogTracks, testTracks } from "../test-support/app-data"
import { createAppFixture } from "../test-support/app-fixture"
import { FakePlaybackController } from "../test-support/fake-playback"

const fixture = createAppFixture()
afterEach(fixture.destroy)

const savedSongs: readonly AppleLibrarySong[] = testTracks.map((track, index) => ({
  kind: "song",
  resourceId: `library-${index}`,
  ...track,
  id: `apple:library-song:${index}`,
  playback: catalogTracks[index % catalogTracks.length],
}))

const library: LibraryServices = {
  getSongs: async () => ({ items: savedSongs, nextCursor: null }),
  getAlbums: async () => ({ items: [], nextCursor: null }),
  getArtists: async () => ({ items: [], nextCursor: null }),
  getAlbumTracks: async () => ({ items: [], nextCursor: null }),
  getArtistAlbums: async () => ({ items: [], nextCursor: null }),
}

function gotoLibrary(): void {
  fixture.setup.mockInput.pressKey("g")
  fixture.setup.mockInput.pressKey("l")
}

function hasLine(frame: string, text: string): boolean {
  return frame.split("\n").some((line) => line.includes(text))
}

describe("Nutka TUI: v3 rail and queue fidelity", () => {
  test("shows supported library sections and maps their existing shortcuts", async () => {
    await fixture.createApp({ library })
    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    gotoLibrary()
    await Bun.sleep(0)
    await fixture.setup.renderOnce()

    let frame = fixture.setup.captureCharFrame()
    expect(frame).toContain("NAVIGATION")
    expect(frame).toContain("LIBRARY")
    expect(frame).toContain("Songs")
    expect(frame).toContain("Albums")
    expect(frame).toContain("Artists")
    expect(frame).toContain("CONTROLS")
    expect(frame).toContain("Visualizer")
    expect(hasLine(frame, "Shuffle")).toBe(false)
    expect(hasLine(frame, "Repeat")).toBe(false)

    fixture.setup.mockInput.pressKey("2")
    await fixture.setup.renderOnce()
    frame = fixture.setup.captureCharFrame()
    expect(frame).toContain("› Albums 2")
    expect(frame).toContain("LIBRARY / ALBUMS")

    fixture.setup.mockInput.pressKey("3")
    await fixture.setup.renderOnce()
    frame = fixture.setup.captureCharFrame()
    expect(frame).toContain("› Artists 3")
    expect(frame).toContain("LIBRARY / ARTISTS")
  })

  test("only renders and wires shuffle/repeat rail rows after playback confirms capability", async () => {
    const playback = new FakePlaybackController()
    await fixture.createApp({ playback })
    await fixture.setup.renderOnce()
    expect(hasLine(fixture.setup.captureCharFrame(), "Shuffle")).toBe(false)
    expect(hasLine(fixture.setup.captureCharFrame(), "Repeat")).toBe(false)

    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [catalogTracks[1]!],
      positionSeconds: 4,
      durationSeconds: catalogTracks[0]!.durationSeconds,
      errorCode: null,
      canSetShuffleMode: true,
      canSetRepeatMode: true,
    })
    await fixture.setup.renderOnce()
    const frame = fixture.setup.captureCharFrame()
    expect(hasLine(frame, "Shuffle")).toBe(true)
    expect(hasLine(frame, "Repeat")).toBe(true)
    expect(frame).toContain("s OFF")
    expect(frame).toContain("r OFF")

    fixture.setup.mockInput.pressKey("s")
    fixture.setup.mockInput.pressKey("r")
    expect(playback.shuffleModeChanges).toEqual(["songs"])
    expect(playback.repeatModeChanges).toEqual(["all"])

    playback.confirm({ ...playback.snapshot, canSetShuffleMode: false, canSetRepeatMode: false })
    await fixture.setup.renderOnce()
    expect(hasLine(fixture.setup.captureCharFrame(), "Shuffle")).toBe(false)
    expect(hasLine(fixture.setup.captureCharFrame(), "Repeat")).toBe(false)
  })

  test("keeps queue metadata truthful when artist, album, duration, or source is missing", async () => {
    const playback = new FakePlaybackController()
    await fixture.createApp({ playback })
    const sparseTrack = { ...catalogTracks[1]!, title: "Untitled", artist: "", album: "", durationSeconds: 0 }
    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [sparseTrack],
      positionSeconds: 0,
      durationSeconds: catalogTracks[0]!.durationSeconds,
      errorCode: null,
    })
    await fixture.setup.renderOnce()

    const frame = fixture.setup.captureCharFrame()
    expect(frame).toContain("NEXT Untitled")
    expect(frame).not.toContain("01")
    expect(frame).not.toContain("undefined")
    expect(frame).not.toContain("SOURCE  ")

    playback.confirm({
      ...playback.snapshot,
      source: { type: "station", id: "station-1", title: "Daily Station", isLive: false },
    })
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("SOURCE RADIO")
  })

  test("keeps the three-column shell bounded at wide and short sizes", async () => {
    for (const [width, height] of [[150, 32], [120, 22]] as const) {
      const local = createAppFixture()
      const playback = new FakePlaybackController()
      await local.createApp({ width, height, playback, library })
      local.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
      local.setup.mockInput.pressKey("g")
      local.setup.mockInput.pressKey("l")
      await Bun.sleep(0)
      await local.setup.renderOnce()
      const frame = local.setup.captureCharFrame()
      expect(frame.split("\n").every((line) => line.length <= width)).toBe(true)
      if (height >= 23) {
        expect(frame).toContain("NAVIGATION")
        expect(frame).toContain("QUEUE")
      } else {
        expect(frame).not.toContain("NAVIGATION")
        expect(frame).not.toContain("QUEUE")
      }
      local.destroy()
    }
  })
})
