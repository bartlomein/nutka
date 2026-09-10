import { afterEach, describe, expect, test } from "bun:test"

import type {
  AppleCatalogPlaylist,
  AppleCatalogTrack,
  AppleHomeSection,
  AppleLibraryPlaylist,
  ApplePlaylist,
  SearchPage,
} from "../core/types"
import {
  deferred,
  catalogTracks,
  recommendedPlaylists,
  homeSections,
  savedPlaylists,
} from "./test-support/app-data"
import { FakePlaybackController } from "./test-support/fake-playback"
import { createAppFixture } from "./test-support/app-fixture"

const fixture = createAppFixture()
const { createApp } = fixture
afterEach(fixture.destroy)

describe("Nutka TUI: playlists", () => {
  test("starts on Home and renders Apple's titled recommendation sections", async () => {
    await createApp({
      getHomeSections: async () => ({ items: homeSections, nextCursor: null }),
    })
    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    const frame = fixture.setup.captureCharFrame()

    expect(frame).toContain("nutka  /  home")
    expect(frame).toContain("Home")
    expect(frame).toContain("Made for You")
    expect(frame).toContain("More Like Chill")
    expect(frame).toContain("Favorites Mix")
    expect(frame).toContain("Chill Mix")
    expect(frame).not.toContain("First Track")
    expect(frame).toContain("nothing playing")
    expect(frame).not.toContain("up next")
  })

  test("shows playlist details and scrolls a long description", async () => {
    const longPlaylist: AppleCatalogPlaylist = {
      ...recommendedPlaylists[0]!,
      description: `Opening note. ${"More playlist context. ".repeat(80)}Ending marker.`,
    }
    await createApp({
      width: 60,
      height: 12,
      kittyKeyboard: true,
      getHomeSections: async () => ({
        items: [{ ...homeSections[0]!, items: [longPlaylist] }],
        nextCursor: null,
      }),
    })
    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    await Bun.sleep(0)
    fixture.setup.mockInput.pressKey("i")
    await fixture.setup.renderOnce()

    const firstFrame = fixture.setup.captureCharFrame()
    expect(firstFrame).toContain("playlist info")
    expect(firstFrame).toContain("Source        For You")
    expect(firstFrame).toContain("Type          Personal Mix")
    expect(firstFrame).toContain("Updated       2026-08-25")
    expect(firstFrame).not.toContain("Ending marker.")

    fixture.setup.mockInput.pressKey("END")
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("Ending marker.")
    fixture.setup.mockInput.pressEscape()
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).not.toContain("playlist info")
  })

  test("keeps Home recommendations separate from saved playlists and opens tracks", async () => {
    const playback = new FakePlaybackController()
    const opened: ApplePlaylist[] = []
    await createApp({
      kittyKeyboard: true,
      playback,
      getHomeSections: async () => ({
        items: homeSections,
        nextCursor: null,
      }),
      getLibraryPlaylists: async () => ({
        items: savedPlaylists,
        nextCursor: null,
      }),
      getPlaylistTracks: async (playlist) => {
        opened.push(playlist)
        return { items: catalogTracks, nextCursor: null }
      },
    })

    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    const home = fixture.setup.captureCharFrame()

    expect(home).toContain("nutka  /  home")
    expect(home).toContain("Made for You")
    expect(home).toContain("More Like Chill")
    expect(home).toContain("Favorites Mix")
    expect(home).toContain("Chill Mix")
    expect(home).not.toContain("Coding")

    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("p")
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    const landing = fixture.setup.captureCharFrame()

    expect(landing).toContain("nutka  /  playlists")
    expect(landing).toContain("YOUR LIBRARY")
    expect(landing).toContain("Coding")
    expect(landing.match(/Favorites Mix/g)).toHaveLength(1)
    expect(landing).not.toContain("Chill Mix")

    fixture.setup.mockInput.pressKey("/")
    await fixture.setup.mockInput.typeText("Coding")
    fixture.setup.mockInput.pressEnter()
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    await fixture.setup.renderOnce()

    expect(opened).toEqual([savedPlaylists[1]!])
    expect(fixture.setup.captureCharFrame()).toContain("nutka  /  playlists  /  playlist")
    expect(fixture.setup.captureCharFrame()).toContain("First Track")
    fixture.setup.mockInput.pressEnter()
    expect(playback.plays[0]?.track.id).toBe("apple:song:1")
    expect(playback.plays[0]?.upcomingTracks.map((track) => track.id)).toEqual([
      "apple:song:2",
    ])

    fixture.setup.mockInput.pressEscape()
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("Coding")
    expect(fixture.setup.captureCharFrame()).not.toContain("First Track")
  })

  test("shuffle-plays a selected playlist without opening it", async () => {
    const playback = new FakePlaybackController()
    const cursors: Array<string | undefined> = []
    await createApp({
      playback,
      getHomeSections: async () => ({
        items: [homeSections[1]!],
        nextCursor: null,
      }),
      getPlaylistTracks: async (_playlist, options) => {
        cursors.push(options?.cursor)
        return options?.cursor
          ? { items: [catalogTracks[1]!], nextCursor: null }
          : { items: [catalogTracks[0]!], nextCursor: "/next-tracks" }
      },
    })

    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    await Bun.sleep(0)
    fixture.setup.mockInput.pressKey("s")
    await Bun.sleep(0)
    await Bun.sleep(0)
    await fixture.setup.renderOnce()

    expect(cursors).toEqual([undefined, "/next-tracks"])
    expect(playback.plays).toHaveLength(1)
    expect([
      playback.plays[0]!.track.id,
      ...playback.plays[0]!.upcomingTracks.map((track) => track.id),
    ].sort()).toEqual(["apple:song:1", "apple:song:2"])
    expect(playback.shuffleModeChanges).toEqual(["songs"])
    expect(fixture.app.getState().destination).toBe("home")
    expect(fixture.app.getState().lists.home.selectedTrackId).toBe(
      recommendedPlaylists[1]!.id,
    )
    expect(fixture.setup.captureCharFrame()).not.toContain("home  /  playlist")
    expect(fixture.setup.captureCharFrame()).not.toContain("First Track")
  })

  test("loads the next page of Home sections", async () => {
    const cursors: Array<string | undefined> = []
    await createApp({
      getHomeSections: async (options) => {
        cursors.push(options?.cursor)
        return options?.cursor
          ? {
              items: [{
                ...homeSections[1]!,
                items: recommendedPlaylists,
              }],
              nextCursor: null,
            }
          : { items: [homeSections[0]!], nextCursor: "/next-home-page" }
      },
    })

    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    await Bun.sleep(0)
    fixture.setup.mockInput.pressKey("m")
    await Bun.sleep(0)
    await fixture.setup.renderOnce()

    expect(cursors).toEqual([undefined, "/next-home-page"])
    const frame = fixture.setup.captureCharFrame()
    expect(frame).toContain("Made for You")
    expect(frame).toContain("More Like Chill")
    expect(frame).toContain("Favorites Mix")
    expect(frame).toContain("Chill Mix")
    expect(frame.match(/Favorites Mix/g)).toHaveLength(1)
    fixture.setup.mockInput.pressKey("j")
    expect(fixture.app.getState().lists.home.selectedTrackId).toBe(
      recommendedPlaylists[1]!.id,
    )
  })

  test("loads the next page for the selected playlist section", async () => {
    const cursors: Array<string | undefined> = []
    await createApp({
      getLibraryPlaylists: async (options) => {
        cursors.push(options?.cursor)
        return options?.cursor
          ? {
              items: [{
                id: "apple:library-playlist:p.later",
                title: "Later Playlist",
                curator: "Your Library",
                apple: {
                  resourceId: "p.later",
                  resourceType: "library-playlists" as const,
                },
              }],
              nextCursor: null,
            }
          : { items: [savedPlaylists[1]!], nextCursor: "/next-library-page" }
      },
    })

    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    await Bun.sleep(0)
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("p")
    await Bun.sleep(0)
    fixture.setup.mockInput.pressKey("m")
    await Bun.sleep(0)
    await fixture.setup.renderOnce()

    expect(cursors).toEqual([undefined, "/next-library-page"])
    expect(fixture.setup.captureCharFrame()).toContain("Later Playlist")
  })

  test("aborts and clears Home and playlist requests when authorization changes", async () => {
    const pendingHome = deferred<SearchPage<AppleHomeSection>>()
    const pendingLibrary = deferred<SearchPage<AppleLibraryPlaylist>>()
    let homeSignal: AbortSignal | undefined
    let librarySignal: AbortSignal | undefined
    await createApp({
      getHomeSections: (_options) => {
        homeSignal = _options?.signal
        return pendingHome.promise
      },
      getLibraryPlaylists: (_options) => {
        librarySignal = _options?.signal
        return pendingLibrary.promise
      },
    })

    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("p")
    await Bun.sleep(0)
    fixture.app.setAppleAuthStatus({ state: "signedOut" })

    expect(homeSignal?.aborted).toBe(true)
    expect(librarySignal?.aborted).toBe(true)
    pendingHome.resolve({ items: [homeSections[0]!], nextCursor: null })
    pendingLibrary.resolve({ items: [savedPlaylists[1]!], nextCursor: null })
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    const frame = fixture.setup.captureCharFrame()
    expect(frame).not.toContain("Chill Mix")
    expect(frame).not.toContain("Coding")
  })

  test("aborts a playlist track request when authorization changes", async () => {
    const pendingTracks = deferred<SearchPage<AppleCatalogTrack>>()
    let trackSignal: AbortSignal | undefined
    await createApp({
      kittyKeyboard: true,
      getHomeSections: async () => ({
        items: [homeSections[1]!],
        nextCursor: null,
      }),
      getPlaylistTracks: (_playlist, _options) => {
        trackSignal = _options?.signal
        return pendingTracks.promise
      },
    })

    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    await Bun.sleep(0)
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    fixture.app.setAppleAuthStatus({ state: "signedOut" })

    expect(trackSignal?.aborted).toBe(true)
    pendingTracks.resolve({ items: catalogTracks, nextCursor: null })
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).not.toContain("First Track")
  })
})
