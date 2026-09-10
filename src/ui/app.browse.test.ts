import { afterEach, describe, expect, test } from "bun:test"

import type {
  AppleArtistSectionName,
  AppleArtistSectionPage,
  AppleCatalogAlbum,
  AppleCatalogAlbumSummary,
  AppleCatalogArtist,
  AppleSongContext,
} from "../core/types"
import {
  deferred,
  catalogTracks,
  testAlbum,
  browseAlbum,
  testArtists,
  testSongContext,
  artistSectionPage,
} from "./test-support/app-data"
import { FakePlaybackController } from "./test-support/fake-playback"
import { createAppFixture } from "./test-support/app-fixture"

const fixture = createAppFixture()
const { createApp } = fixture
afterEach(fixture.destroy)

describe("Nutka TUI: browse", () => {
  test("opens pinned track info and traps background keys", async () => {
    let quitCount = 0
    await createApp(
      { kittyKeyboard: true, tracks: catalogTracks },
      () => quitCount++,
    )
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("l")

    fixture.setup.mockInput.pressKey("i")
    await fixture.setup.renderOnce()
    const frame = fixture.setup.captureCharFrame()
    expect(frame).toContain("track info")
    expect(frame).toContain("First Track")
    expect(frame).toContain("Released      2026-02-13")
    expect(frame).toContain("Genres        Alternative, Electronic")
    expect(frame).toContain("Audio         LOSSLESS")
    expect(frame).toContain("A focused track note.")

    fixture.setup.mockInput.pressKey("q")
    fixture.setup.mockInput.pressKey("j")
    expect(quitCount).toBe(0)
    expect(fixture.app.getState().lists.library.selectedTrackId).toBe("apple:song:1")

    fixture.setup.mockInput.pressKey("i")
    fixture.setup.mockInput.pressKey("j")
    expect(fixture.app.getState().lists.library.selectedTrackId).toBe("apple:song:2")
  })

  test("includes loaded album context in selected track info", async () => {
    await createApp({
      kittyKeyboard: true,
      searchSongs: async () => ({ items: catalogTracks, nextCursor: null }),
      getAlbumForSong: async () => testAlbum,
    })
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("s")
    await fixture.setup.mockInput.typeText("first")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    fixture.setup.mockInput.pressKey("a")
    await Bun.sleep(0)
    fixture.setup.mockInput.pressKey("i")
    await fixture.setup.renderOnce()

    const frame = fixture.setup.captureCharFrame()
    expect(frame).toContain("track info")
    fixture.setup.mockInput.pressKey("END")
    await fixture.setup.renderOnce()
    const albumFrame = fixture.setup.captureCharFrame()
    expect(albumFrame).toContain("ALBUM")
    expect(albumFrame).toContain("The Album")
    expect(albumFrame).toContain("Label         Example Records")
    expect(albumFrame).toContain("A focused album note.")
  })

  test("browses the pinned confirmed song while playback advances", async () => {
    const playback = new FakePlaybackController()
    const context = deferred<AppleSongContext>()
    const contextSongIds: string[] = []
    const albumIds: string[] = []
    const pinnedAlbum: AppleCatalogAlbum = {
      ...testAlbum,
      tracks: [catalogTracks[1]!, catalogTracks[0]!],
    }
    await createApp({
      kittyKeyboard: true,
      playback,
      getSongContext: (songResourceId) => {
        contextSongIds.push(songResourceId)
        return context.promise
      },
      getAlbum: async (albumResourceId) => {
        albumIds.push(albumResourceId)
        return pinnedAlbum
      },
      getArtistSection: async (_artistResourceId, section) => artistSectionPage(section),
    })
    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [catalogTracks[1]!],
      positionSeconds: 5,
      durationSeconds: 180,
      errorCode: null,
      canSetShuffleMode: true,
      canSetRepeatMode: true,
    })

    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("n")
    await Bun.sleep(0)
    expect(contextSongIds).toEqual(["1"])

    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[1]!,
      queue: [],
      positionSeconds: 2,
      durationSeconds: 240,
      errorCode: null,
    })
    context.resolve(testSongContext)
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    const picker = fixture.setup.captureCharFrame()
    expect(picker).toContain("browse now playing")
    expect(picker).toContain("The Album")
    expect(picker).toContain("The Artist")
    expect(picker).toContain("Guest Artist")
    expect(picker).toContain("Second Track")

    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    expect(albumIds).toEqual(["album-1"])
    expect(fixture.setup.captureCharFrame()).toContain("nutka  /  album")

    fixture.setup.mockInput.pressKey("s")
    expect(playback.shuffleModeChanges).toEqual(["songs"])
    expect(playback.plays).toHaveLength(0)

    fixture.setup.mockInput.pressEnter()
    expect(playback.plays.at(-1)?.track.id).toBe("apple:song:1")
    fixture.setup.mockInput.pressEscape()
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("browse now playing")
    fixture.setup.mockInput.pressEscape()
    expect(fixture.app.getState().destination).toBe("home")
  })

  test("opens artist sections, paginates the selected section, and restores history", async () => {
    const playback = new FakePlaybackController()
    const sectionRequests: Array<{
      artistId: string
      section: AppleArtistSectionName
      cursor?: string
    }> = []
    const secondAlbum: AppleCatalogAlbumSummary = {
      ...browseAlbum,
      id: "apple:album:album-2",
      title: "Second Album",
      apple: { ...browseAlbum.apple, resourceId: "album-2" },
    }
    await createApp({
      kittyKeyboard: true,
      playback,
      getSongContext: async () => testSongContext,
      getAlbum: async () => testAlbum,
      getArtistSection: async (artistId, section, options) => {
        sectionRequests.push({ artistId, section, cursor: options?.cursor })
        if (section === "full-albums") {
          return options?.cursor
            ? { section, items: [secondAlbum], nextCursor: null }
            : { section, items: [browseAlbum], nextCursor: "/next-full-albums" }
        }
        return artistSectionPage(section)
      },
    })
    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [catalogTracks[1]!],
      positionSeconds: 5,
      durationSeconds: 180,
      errorCode: null,
      canSetShuffleMode: true,
      canSetRepeatMode: true,
    })

    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("n")
    await Bun.sleep(0)
    fixture.setup.mockInput.pressKey("j")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    await fixture.setup.renderOnce()

    const artistPage = fixture.setup.captureCharFrame()
    expect(artistPage).toContain("nutka  /  artist")
    expect(artistPage).toContain("TOP SONGS")
    expect(artistPage).toContain("LATEST RELEASE")
    expect(artistPage).toContain("ALBUMS")
    expect(artistPage).toContain("SINGLES & EPS")
    expect(artistPage).toContain("SIMILAR ARTISTS")
    expect(artistPage).toContain("Guest Artist")
    const songRow = artistPage.split("\n").find((line) => line.includes("First Track"))
    const albumRow = artistPage.split("\n").find((line) => line.includes("The Album"))
    expect(songRow).toMatch(/song\s+2026/u)
    expect(albumRow).toMatch(/album\s+2026/u)
    expect(songRow).not.toContain("·")
    expect(albumRow).not.toContain("·")
    expect(sectionRequests.map(({ artistId }) => artistId)).toEqual(
      Array.from({ length: 5 }, () => "artist-1"),
    )

    fixture.setup.mockInput.pressEnter()
    expect(playback.plays.at(-1)?.track.id).toBe("apple:song:1")
    fixture.setup.mockInput.pressKey("j")
    fixture.setup.mockInput.pressKey("j")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("nutka  /  album")

    fixture.setup.mockInput.pressEscape()
    fixture.setup.mockInput.pressKey("j")
    fixture.setup.mockInput.pressKey("m")
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    expect(sectionRequests.at(-1)).toEqual({
      artistId: "artist-1",
      section: "full-albums",
      cursor: "/next-full-albums",
    })
    expect(fixture.setup.captureCharFrame()).toContain("Second Album")

    fixture.setup.mockInput.pressKey("o", { ctrl: true })
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("browse now playing")
    fixture.setup.mockInput.pressEscape()
    expect(fixture.app.getState().destination).toBe("home")
  })

  test("prefers top songs when artist sections finish out of order", async () => {
    const playback = new FakePlaybackController()
    const topSongs = deferred<AppleArtistSectionPage>()
    await createApp({
      playback,
      getSongContext: async () => testSongContext,
      getAlbum: async () => testAlbum,
      getArtistSection: async (_artistResourceId, section) =>
        section === "top-songs" ? topSongs.promise : artistSectionPage(section),
    })
    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [],
      positionSeconds: 1,
      durationSeconds: 180,
      errorCode: null,
    })
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("n")
    await Bun.sleep(0)
    fixture.setup.mockInput.pressKey("j")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)

    topSongs.resolve(artistSectionPage("top-songs"))
    await Bun.sleep(0)
    fixture.setup.mockInput.pressEnter()

    expect(playback.plays.at(-1)?.track.id).toBe("apple:song:1")
  })

  test("aborts pending artist requests when navigating back", async () => {
    const playback = new FakePlaybackController()
    const sectionSignals: AbortSignal[] = []
    await createApp({
      playback,
      getSongContext: async () => testSongContext,
      getAlbum: async () => testAlbum,
      getArtistSection: (_artistResourceId, _section, options) => {
        if (options?.signal) sectionSignals.push(options.signal)
        return new Promise<AppleArtistSectionPage>(() => {})
      },
    })
    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [],
      positionSeconds: 1,
      durationSeconds: 180,
      errorCode: null,
    })
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("n")
    await Bun.sleep(0)
    fixture.setup.mockInput.pressKey("j")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)

    fixture.setup.mockInput.pressKey("o", { ctrl: true })

    expect(sectionSignals).toHaveLength(5)
    expect(sectionSignals.every((signal) => signal.aborted)).toBe(true)
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("browse now playing")
  })

  test("keeps the now-playing picker usable in a short terminal", async () => {
    const playback = new FakePlaybackController()
    const artists = Array.from({ length: 8 }, (_, index): AppleCatalogArtist => ({
      ...testArtists[0]!,
      id: `apple:artist:artist-${index + 1}`,
      name: `Artist ${index + 1}`,
      apple: {
        ...testArtists[0]!.apple,
        resourceId: `artist-${index + 1}`,
      },
    }))
    await createApp({
      width: 60,
      height: 10,
      playback,
      getSongContext: async () => ({ albums: [browseAlbum], artists }),
      getAlbum: async () => testAlbum,
      getArtistSection: async (_artistResourceId, section) => artistSectionPage(section),
    })
    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [],
      positionSeconds: 1,
      durationSeconds: 180,
      errorCode: null,
    })
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("n")
    await Bun.sleep(0)
    for (let index = 0; index < 8; index++) fixture.setup.mockInput.pressKey("j")
    await fixture.setup.renderOnce()

    const frame = fixture.setup.captureCharFrame()
    expect(frame).toContain("browse now playing")
    expect(frame).toContain("Artist 8")
    expect(frame).toContain("esc cancel")
  })

  test("aborts artist browsing when Apple authorization changes", async () => {
    const playback = new FakePlaybackController()
    const sectionSignals: AbortSignal[] = []
    await createApp({
      getHomeSections: async () => ({ items: [], nextCursor: null }),
      playback,
      getSongContext: async () => testSongContext,
      getAlbum: async () => testAlbum,
      getArtistSection: (_artistResourceId, _section, options) => {
        if (options?.signal) sectionSignals.push(options.signal)
        return new Promise<AppleArtistSectionPage>(() => {})
      },
    })
    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [],
      positionSeconds: 1,
      durationSeconds: 180,
      errorCode: null,
    })
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("n")
    await Bun.sleep(0)
    fixture.setup.mockInput.pressKey("j")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)

    expect(sectionSignals).toHaveLength(5)
    expect(sectionSignals.every((signal) => !signal.aborted)).toBe(true)
    fixture.app.setAppleAuthStatus({ state: "signedOut" })
    expect(sectionSignals.every((signal) => signal.aborted)).toBe(true)
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).not.toContain("TOP SONGS")
  })

  test("exposes Browse Now Playing only for a confirmed catalog song", async () => {
    const playback = new FakePlaybackController()
    await createApp({
      kittyKeyboard: true,
      playback,
      getSongContext: async () => testSongContext,
      getAlbum: async () => testAlbum,
      getArtistSection: async (_artistResourceId, section) => artistSectionPage(section),
    })

    fixture.setup.mockInput.pressKey("p", { ctrl: true })
    await fixture.setup.mockInput.typeText("now playing")
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("no matching commands")
    fixture.setup.mockInput.pressEscape()

    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [],
      positionSeconds: 1,
      durationSeconds: 180,
      errorCode: null,
    })
    fixture.setup.mockInput.pressKey("p", { ctrl: true })
    await fixture.setup.mockInput.typeText("now playing")
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("Browse Now Playing")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("browse now playing")
  })
})
