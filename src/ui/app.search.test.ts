import { afterEach, describe, expect, test } from "bun:test"

import type { AppleCatalogAlbum, SearchPage, Track } from "../core/types"
import { deferred, testTracks, catalogTracks, testAlbum } from "./test-support/app-data"
import { createAppFixture } from "./test-support/app-fixture"

const fixture = createAppFixture()
const { createApp } = fixture
afterEach(fixture.destroy)

describe("Nutka TUI: search", () => {
  test("submits Apple search and keeps slash as a local result filter", async () => {
    const queries: string[] = []
    await createApp({
      searchSongs: async (query) => {
        queries.push(query)
        return { items: testTracks, nextCursor: "/next-page" }
      },
    })

    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("s")
    await fixture.setup.mockInput.typeText("track")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    await fixture.setup.renderOnce()

    expect(fixture.app.getState()).toMatchObject({
      destination: "search",
      mode: { type: "normal" },
      lists: { search: { selectedTrackId: "track-a", filter: "" } },
    })
    expect(queries).toEqual(["track"])
    expect(fixture.setup.captureCharFrame()).toContain("Search music")

    fixture.setup.mockInput.pressKey("/")
    await fixture.setup.mockInput.typeText("second")
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("Second Track")
    expect(fixture.setup.captureCharFrame()).not.toContain("First Track")

    fixture.setup.mockInput.pressEnter()

    expect(fixture.app.getState()).toMatchObject({
      destination: "search",
      mode: { type: "normal" },
      lists: { search: { filter: "second" } },
      playback: { currentTrackId: null, status: "idle" },
    })
    expect(queries).toEqual(["track"])
  })

  test("ignores stale catalog responses", async () => {
    const first = deferred<SearchPage<Track>>()
    const second = deferred<SearchPage<Track>>()
    const signals: AbortSignal[] = []
    await createApp({
      searchSongs: (query, options) => {
        if (options?.signal) signals.push(options.signal)
        return query === "first" ? first.promise : second.promise
      },
    })

    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("s")
    await fixture.setup.mockInput.typeText("first")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("s")
    for (let index = 0; index < 5; index++) fixture.setup.mockInput.pressBackspace()
    await fixture.setup.mockInput.typeText("second")
    fixture.setup.mockInput.pressEnter()
    expect(signals[0]?.aborted).toBe(true)

    second.resolve({ items: [testTracks[1]!], nextCursor: null })
    await Bun.sleep(0)
    first.resolve({ items: [testTracks[0]!], nextCursor: null })
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("Second Track")
    expect(fixture.setup.captureCharFrame()).not.toContain("First Track")

  })

  test("clears old rows while a replacement search is loading", async () => {
    const replacement = deferred<SearchPage<Track>>()
    await createApp({
      searchSongs: async (query) => query === "first"
        ? { items: [testTracks[0]!], nextCursor: null }
        : replacement.promise,
    })

    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("s")
    await fixture.setup.mockInput.typeText("first")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("s")
    for (let index = 0; index < 5; index++) fixture.setup.mockInput.pressBackspace()
    await fixture.setup.mockInput.typeText("second")
    fixture.setup.mockInput.pressEnter()
    await fixture.setup.renderOnce()

    const frame = fixture.setup.captureCharFrame()
    expect(frame).toContain("searching Apple Music")
    expect(frame).not.toContain("First Track")
  })

  test("loads and deduplicates the next search page", async () => {
    const calls: Array<{ query: string; cursor?: string }> = []
    await createApp({
      searchSongs: async (query, options) => {
        calls.push({ query, cursor: options?.cursor })
        return options?.cursor
          ? { items: [testTracks[0]!, testTracks[1]!], nextCursor: null }
          : { items: [testTracks[0]!], nextCursor: "/next" }
      },
    })

    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("s")
    await fixture.setup.mockInput.typeText("tracks")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    fixture.setup.mockInput.pressKey("m")
    await Bun.sleep(0)
    await fixture.setup.renderOnce()

    expect(calls).toEqual([
      { query: "tracks", cursor: undefined },
      { query: "tracks", cursor: "/next" },
    ])
    const frame = fixture.setup.captureCharFrame()
    expect(frame).toContain("First Track")
    expect(frame).toContain("Second Track")
    expect(frame.match(/First Track/g)).toHaveLength(1)
  })

  test("opens the selected song's album and returns to search results", async () => {
    const pendingAlbum = deferred<AppleCatalogAlbum>()
    const requests: string[] = []
    await createApp({
      kittyKeyboard: true,
      searchSongs: async () => ({ items: [catalogTracks[0]!], nextCursor: null }),
      getAlbumForSong: (songResourceId) => {
        requests.push(songResourceId)
        return pendingAlbum.promise
      },
    })

    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("s")
    await fixture.setup.mockInput.typeText("first")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    fixture.setup.mockInput.pressKey("p", { ctrl: true })
    await fixture.setup.mockInput.typeText("album")
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("Go to Album")
    fixture.setup.mockInput.pressEscape()

    fixture.setup.mockInput.pressKey("a")
    await fixture.setup.renderOnce()
    expect(requests).toEqual(["1"])
    expect(fixture.setup.captureCharFrame()).toContain("loading “First Album”")
    expect(fixture.setup.captureCharFrame()).not.toContain("First Track")

    pendingAlbum.resolve(testAlbum)
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    const albumFrame = fixture.setup.captureCharFrame()
    expect(albumFrame).toContain("nutka  /  search  /  album")
    expect(albumFrame).toContain("The Album")
    expect(albumFrame).toContain("The Artist")
    expect(albumFrame).toContain("First Track")
    expect(albumFrame).toContain("Second Track")

    fixture.setup.mockInput.pressEscape()
    await fixture.setup.renderOnce()
    const searchFrame = fixture.setup.captureCharFrame()
    expect(searchFrame).toContain("Search music")
    expect(searchFrame).toContain("First Track")
    expect(searchFrame).not.toContain("search  /  album")
  })

  test("sanitizes album errors and allows returning to search", async () => {
    await createApp({
      kittyKeyboard: true,
      searchSongs: async () => ({ items: [catalogTracks[0]!], nextCursor: null }),
      getAlbumForSong: async () => {
        throw new Error("album-response-secret")
      },
    })
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("s")
    await fixture.setup.mockInput.typeText("first")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    fixture.setup.mockInput.pressKey("a")
    await Bun.sleep(0)
    await fixture.setup.renderOnce()

    const frame = fixture.setup.captureCharFrame()
    expect(frame).toContain("album unavailable")
    expect(frame).not.toContain("album-response-secret")
    fixture.setup.mockInput.pressEscape()
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("First Track")
  })

  test("aborts and clears catalog results when authorization changes", async () => {
    const pending = deferred<SearchPage<Track>>()
    let signal: AbortSignal | undefined
    await createApp({
      searchSongs: (_query, options) => {
        signal = options?.signal
        return pending.promise
      },
    })
    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("s")
    await fixture.setup.mockInput.typeText("private")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)

    fixture.app.setAppleAuthStatus({ state: "signedOut" })
    expect(signal?.aborted).toBe(true)
    pending.resolve({ items: [testTracks[0]!], nextCursor: null })
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).not.toContain("First Track")
  })

  test("aborts an album request when authorization changes", async () => {
    const pendingAlbum = deferred<AppleCatalogAlbum>()
    let albumSignal: AbortSignal | undefined
    await createApp({
      searchSongs: async () => ({ items: [catalogTracks[0]!], nextCursor: null }),
      getAlbumForSong: (_songResourceId, options) => {
        albumSignal = options?.signal
        return pendingAlbum.promise
      },
    })
    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("s")
    await fixture.setup.mockInput.typeText("first")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    fixture.setup.mockInput.pressKey("a")
    await Bun.sleep(0)

    fixture.app.setAppleAuthStatus({ state: "signedOut" })
    expect(albumSignal?.aborted).toBe(true)
    pendingAlbum.resolve(testAlbum)
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).not.toContain("The Album")
  })

  test("shows a sanitized catalog search error", async () => {
    await createApp({
      tracks: [],
      searchSongs: async () => {
        throw new Error("developer-token-secret")
      },
    })

    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("s")
    await fixture.setup.mockInput.typeText("failed query")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    const frame = fixture.setup.captureCharFrame()
    expect(frame).toContain("Apple Music search is unavailable")
    expect(frame).not.toContain("developer-token-secret")
  })

  test("cancels a local filter and restores the original selection", async () => {
    await createApp({ kittyKeyboard: true })

    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("l")
    fixture.setup.mockInput.pressKey("j")
    fixture.setup.mockInput.pressKey("/")
    await fixture.setup.mockInput.typeText("third")
    fixture.setup.mockInput.pressEscape()

    expect(fixture.app.getState()).toMatchObject({
      destination: "library",
      mode: { type: "normal" },
      lists: {
        library: { selectedTrackId: "track-b", filter: "" },
      },
      playback: { currentTrackId: null },
    })
  })
})
