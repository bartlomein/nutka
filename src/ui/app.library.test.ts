import { afterEach, describe, expect, test } from "bun:test"

import type {
  AppleLibrarySong,
  AppleLibraryAlbum,
  AppleLibraryArtist,
  SearchPage,
} from "../core/types"
import type { LibraryServices } from "./app/library-controller"
import { deferred, catalogTracks } from "./test-support/app-data"
import { FakePlaybackController } from "./test-support/fake-playback"
import { createAppFixture } from "./test-support/app-fixture"

const fixture = createAppFixture()
const { createApp } = fixture
afterEach(fixture.destroy)

const savedSongs: readonly AppleLibrarySong[] = catalogTracks.map((track, index) => ({
  kind: "song", id: `apple:library-song:i.${index}`, resourceId: `i.${index}`,
  title: track.title, artist: track.artist, album: track.album,
  durationSeconds: track.durationSeconds, playback: track,
}))
const savedAlbum: AppleLibraryAlbum = {
  kind: "album", id: "apple:library-album:l.saved", resourceId: "l.saved",
  title: "My Saved Album", artist: "My Saved Artist",
}
const savedArtist: AppleLibraryArtist = {
  kind: "artist", id: "apple:library-artist:r.saved", resourceId: "r.saved", name: "My Saved Artist",
}
function libraryServices(overrides: Partial<LibraryServices> = {}): LibraryServices {
  return {
    getSongs: async () => ({ items: savedSongs, nextCursor: null }),
    getAlbums: async () => ({ items: [savedAlbum], nextCursor: null }),
    getArtists: async () => ({ items: [savedArtist], nextCursor: null }),
    getAlbumTracks: async () => ({ items: savedSongs, nextCursor: null }),
    getArtistAlbums: async () => ({ items: [savedAlbum], nextCursor: null }),
    ...overrides,
  }
}
function gotoLibrary(): void {
  fixture.setup.mockInput.pressKey("g")
  fixture.setup.mockInput.pressKey("l")
}

describe("Nutka TUI: library", () => {
  test("loads all saved song pages automatically without losing selection, and plays confirmed catalog IDs", async () => {
    const playback = new FakePlaybackController()
    const cursors: Array<string | undefined> = []
    await createApp({ tracks: [], playback, library: libraryServices({
      getSongs: async (options) => {
        cursors.push(options?.cursor)
        return options?.cursor
          ? { items: savedSongs, nextCursor: null }
          : { items: [savedSongs[0]!], nextCursor: "page2" }
      },
    }) })
    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    gotoLibrary()
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("LIBRARY / SONGS")
    expect(fixture.setup.captureCharFrame()).toContain("First Track")
    expect(fixture.setup.captureCharFrame()).toContain("1 songs")
    expect(fixture.app.getState().lists.library.selectedTrackId).toBe(savedSongs[0]!.id)
    expect(cursors).toEqual([undefined, "page2"])
    expect(fixture.app.getState().lists.library.selectedTrackId).toBe(savedSongs[0]!.id)
    fixture.setup.mockInput.pressEnter()
    expect(playback.plays).toEqual([{ track: catalogTracks[0]!, upcomingTracks: [catalogTracks[1]!] }])
    expect(fixture.app.getState().playback.status).toBe("idle")
    fixture.setup.mockInput.pressKey("/")
    await fixture.setup.mockInput.typeText("Second")
    fixture.setup.mockInput.pressEnter()
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("Second Track")
    expect(fixture.setup.captureCharFrame()).not.toContain("First Track")
    fixture.setup.mockInput.pressEnter()
    expect(playback.plays.at(-1)).toEqual({ track: catalogTracks[1]!, upcomingTracks: [] })
    playback.confirm({ status: "playing", currentTrack: catalogTracks[1]!, queue: [], positionSeconds: 0, durationSeconds: 240, errorCode: null })
    expect(fixture.app.getState().playback.currentTrackId).toBe(catalogTracks[1]!.id)
  })

  test("browses saved artist albums and tracks, restoring filters and selection on back", async () => {
    const requests: string[] = []
    const playback = new FakePlaybackController()
    await createApp({ tracks: [], playback, kittyKeyboard: true, library: libraryServices({
      getArtistAlbums: async (id) => {
        requests.push(id)
        return { items: [savedAlbum], nextCursor: null }
      },
      getAlbumTracks: async (id) => {
        requests.push(id)
        return { items: savedSongs, nextCursor: null }
      },
    }) })
    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    gotoLibrary()
    fixture.setup.mockInput.pressKey("3")
    await Bun.sleep(0)
    fixture.setup.mockInput.pressKey("/")
    await fixture.setup.mockInput.typeText("Saved")
    fixture.setup.mockInput.pressEnter()
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("My Saved Album")
    expect(fixture.app.getState().lists.library.filter).toBe("")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    fixture.setup.mockInput.pressKey("j")
    fixture.setup.mockInput.pressEnter()
    expect(playback.plays.at(-1)?.track).toEqual(catalogTracks[1]!)
    expect(requests).toEqual(["r.saved", "l.saved"])
    fixture.setup.mockInput.pressKey("o", { ctrl: true })
    expect(fixture.app.getState().lists.library.selectedTrackId).toBe(savedAlbum.id)
    fixture.setup.mockInput.pressEscape()
    expect(fixture.app.getState().lists.library).toEqual({ filter: "Saved", selectedTrackId: savedArtist.id })
    fixture.setup.mockInput.pressKey("2")
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("LIBRARY / ALBUMS")
    expect(fixture.setup.captureCharFrame().split("\n").find((line) => line.includes("› My Saved Album"))).not.toContain("0:00")
    fixture.setup.mockInput.pressKey("3")
    expect(fixture.app.getState().lists.library.filter).toBe("Saved")
  })

  test("shows unavailable songs and retry states, refreshes, and clears personal data on sign-out", async () => {
    let calls = 0
    const playback = new FakePlaybackController()
    const { playback: unused, ...unavailable } = savedSongs[0]!
    await createApp({ tracks: [], playback, library: libraryServices({
      getSongs: async () => {
        if (++calls === 1) throw new Error("offline")
        return { items: [unavailable], nextCursor: null }
      },
    }) })
    gotoLibrary()
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("Sign in to Apple Music")
    expect(calls).toBe(0)
    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("m retry")
    fixture.setup.mockInput.pressKey("m")
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("First Track [unavailable]")
    fixture.setup.mockInput.pressEnter()
    expect(playback.plays).toHaveLength(0)
    fixture.setup.mockInput.pressKey("R")
    await Bun.sleep(0)
    expect(calls).toBe(3)
    fixture.app.setAppleAuthStatus({ state: "signedOut" })
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).not.toContain("First Track")
    expect(fixture.app.getState().lists.library.selectedTrackId).toBeNull()
  })

  test("renders Library navigation in a compact terminal and preserves typing when a page arrives", async () => {
    const pending = deferred<SearchPage<AppleLibrarySong>>()
    await createApp({ width: 60, height: 16, tracks: [], library: libraryServices({
      getSongs: () => pending.promise,
    }) })
    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    gotoLibrary()
    fixture.setup.mockInput.pressKey("/")
    await fixture.setup.mockInput.typeText("Second")
    pending.resolve({ items: savedSongs, nextCursor: null })
    await Bun.sleep(0)
    expect(fixture.app.getState().mode).toEqual({ type: "filter", draft: "Second", originalSelectedTrackId: null })
    expect(fixture.app.getState().lists.library.selectedTrackId).toBe(savedSongs[1]!.id)
    fixture.setup.mockInput.pressEnter()
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("1 songs 2 albums 3 artists")
    expect(fixture.setup.captureCharFrame()).toContain("Second Track")
    expect(fixture.setup.captureCharFrame()).not.toContain("First Track")
  })
})
