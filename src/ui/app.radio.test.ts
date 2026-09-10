import { afterEach, describe, expect, test } from "bun:test"

import type { AppleCatalogStation, SearchPage } from "../core/types"
import {
  deferred,
  catalogTracks,
  testAlbum,
  testSongContext,
  station,
  artistSectionPage,
} from "./test-support/app-data"
import { FakePlaybackController } from "./test-support/fake-playback"
import { createAppFixture } from "./test-support/app-fixture"

const fixture = createAppFixture()
const { createApp } = fixture
afterEach(fixture.destroy)

describe("Nutka TUI: radio", () => {
  test("opens Radio with g r, renders ordered deduplicated sections, and starts a station", async () => {
    const playback = new FakePlaybackController()
    const personal = station("personal", "My Discovery Station")
    const live = station("live", "Apple Music 1", true)
    await createApp({
      playback,
      getPersonalStation: async () => personal,
      getLiveRadioStations: async () => ({ items: [personal, live], nextCursor: null }),
      getRecentlyPlayedStations: async () => ({ items: [live], nextCursor: null }),
    })
    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("r")
    await Bun.sleep(0)
    await fixture.setup.renderOnce()

    const frame = fixture.setup.captureCharFrame()
    expect(fixture.app.getState().destination).toBe("radio")
    expect(frame.indexOf("MY STATION")).toBeLessThan(frame.indexOf("LIVE NOW"))
    expect(frame.indexOf("LIVE NOW")).toBeLessThan(frame.indexOf("RECENTLY PLAYED"))
    expect(frame.match(/My Discovery Station/g)).toHaveLength(1)
    expect(frame.match(/Apple Music 1/g)).toHaveLength(1)

    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    expect(playback.stationPlays).toEqual([personal])
    expect(fixture.setup.captureCharFrame()).toContain("nothing playing")

    fixture.setup.mockInput.pressArrow("down")
    expect(fixture.app.getState().lists.radio.selectedTrackId).toBe(live.id)
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("h")
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("r")
    await Bun.sleep(0)
    expect(fixture.app.getState().lists.radio.selectedTrackId).toBe(live.id)
  })

  test("keeps the initial Radio selection deterministic when sections resolve out of order", async () => {
    const playback = new FakePlaybackController()
    const personal = station("personal", "My Discovery Station")
    const live = station("live", "Apple Music 1", true)
    const recent = station("recent", "Recently Played")
    const personalRequest = deferred<AppleCatalogStation>()
    const liveRequest = deferred<SearchPage<AppleCatalogStation>>()
    const recentRequest = deferred<SearchPage<AppleCatalogStation>>()
    await createApp({
      playback,
      getPersonalStation: () => personalRequest.promise,
      getLiveRadioStations: () => liveRequest.promise,
      getRecentlyPlayedStations: () => recentRequest.promise,
    })
    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("r")

    liveRequest.resolve({ items: [live], nextCursor: null })
    await Bun.sleep(0)
    expect(fixture.app.getState().lists.radio.selectedTrackId).toBe(live.id)
    recentRequest.resolve({ items: [recent], nextCursor: null })
    await Bun.sleep(0)
    personalRequest.resolve(personal)
    await Bun.sleep(0)

    expect(fixture.app.getState().lists.radio.selectedTrackId).toBe(personal.id)
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    expect(playback.stationPlays).toEqual([personal])
  })

  test("searches Apple radio stations from Radio and plays the selected result", async () => {
    const playback = new FakePlaybackController()
    const npr = station("npr", "NPR News and Culture", true)
    const queries: string[] = []
    await createApp({
      playback,
      searchStations: async (query) => {
        queries.push(query)
        return { items: [npr], nextCursor: null }
      },
      getStationGenres: async () => [],
    })
    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("r")
    fixture.setup.mockInput.pressKey("/")
    await fixture.setup.mockInput.typeText("NPR")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    await fixture.setup.renderOnce()

    expect(queries).toEqual(["NPR"])
    expect(fixture.setup.captureCharFrame()).toContain("NPR News and Culture")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    expect(playback.stationPlays).toEqual([npr])
  })

  test("marks external Radio streams unavailable and does not attempt playback", async () => {
    const playback = new FakePlaybackController()
    const npr = station("npr", "NPR News and Culture", true)
    npr.apple.externalLiveStream = true
    await createApp({
      playback,
      searchStations: async () => ({ items: [npr], nextCursor: null }),
      getStationGenres: async () => [],
    })
    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("r")
    fixture.setup.mockInput.pressKey("/")
    await fixture.setup.mockInput.typeText("NPR")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    await fixture.setup.renderOnce()

    expect(fixture.setup.captureCharFrame()).toContain("unavailable in MusicKit")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    expect(playback.stationPlays).toEqual([])
  })

  test("keeps only the latest overlapping Radio search", async () => {
    const requests = new Map<string, ReturnType<typeof deferred<SearchPage<AppleCatalogStation>>>>()
    await createApp({
      searchStations: (query) => {
        const request = deferred<SearchPage<AppleCatalogStation>>()
        requests.set(query, request)
        return request.promise
      },
      getStationGenres: async () => [],
    })
    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("r")
    fixture.setup.mockInput.pressKey("/")
    await fixture.setup.mockInput.typeText("first")
    fixture.setup.mockInput.pressEnter()
    fixture.setup.mockInput.pressKey("/")
    await fixture.setup.mockInput.typeText("second")
    fixture.setup.mockInput.pressEnter()

    requests.get("second")!.resolve({
      items: [station("second", "Second Station")],
      nextCursor: null,
    })
    await Bun.sleep(0)
    requests.get("first")!.resolve({
      items: [station("first", "First Station")],
      nextCursor: null,
    })
    await Bun.sleep(0)
    await fixture.setup.renderOnce()

    expect(fixture.setup.captureCharFrame()).toContain("Second Station")
    expect(fixture.setup.captureCharFrame()).not.toContain("First Station")
  })

  test("clears an aborted search when Radio reloads", async () => {
    const request = deferred<SearchPage<AppleCatalogStation>>()
    await createApp({
      searchStations: () => request.promise,
      getStationGenres: async () => [],
    })
    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("r")
    fixture.setup.mockInput.pressKey("/")
    await fixture.setup.mockInput.typeText("pending")
    fixture.setup.mockInput.pressEnter()
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("r")
    await Bun.sleep(0)
    await fixture.setup.renderOnce()

    expect(fixture.setup.captureCharFrame()).not.toContain("SEARCH RESULTS")
  })

  test("browses station genres and opens their stations", async () => {
    const playback = new FakePlaybackController()
    const jazz = {
      id: "apple:station-genre:jazz",
      name: "Jazz",
      apple: { resourceId: "jazz", resourceType: "station-genres" as const },
    }
    const jazzStation = station("jazz-radio", "Jazz Radio")
    await createApp({
      playback,
      getStationGenres: async () => [jazz],
      getStationsForGenre: async (resourceId) => {
        expect(resourceId).toBe("jazz")
        return { items: [jazzStation], nextCursor: null }
      },
    })
    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("r")
    await Bun.sleep(0)
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    await fixture.setup.renderOnce()

    expect(fixture.setup.captureCharFrame()).toContain("Jazz Radio")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    expect(playback.stationPlays).toEqual([jazzStation])
  })

  test("loads and toggles storefront-scoped favorite stations", async () => {
    const npr = station("npr", "NPR News and Culture", true)
    const writes: Array<[string, string, boolean]> = []
    await createApp({
      loadFavoriteStationIds: (storefront) => storefront === "us" ? ["npr"] : [],
      getStationsByIds: async (ids) => {
        expect(ids).toEqual(["npr"])
        return [npr]
      },
      setStationFavorite: (storefront, resourceId, favorite) => {
        writes.push([storefront, resourceId, favorite])
      },
      getStationGenres: async () => [],
    })
    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    await Bun.sleep(0)
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("r")
    await Bun.sleep(0)
    await fixture.setup.renderOnce()

    const frame = fixture.setup.captureCharFrame()
    expect(frame).toContain("FAVORITE STATIONS")
    expect(frame).toContain("★ NPR News and Culture")
    fixture.setup.mockInput.pressKey("f")
    expect(writes).toEqual([["us", "npr", false]])
  })

  test("keeps a station favorited while existing favorites are hydrating", async () => {
    const hydration = deferred<readonly AppleCatalogStation[]>()
    const existing = station("existing", "Existing Favorite")
    const live = station("live-new", "New Favorite", true)
    await createApp({
      loadFavoriteStationIds: () => ["existing"],
      getStationsByIds: () => hydration.promise,
      setStationFavorite: () => {},
      getLiveRadioStations: async () => ({ items: [live], nextCursor: null }),
      getStationGenres: async () => [],
    })
    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("r")
    await Bun.sleep(0)
    fixture.setup.mockInput.pressKey("f")
    hydration.resolve([existing])
    await Bun.sleep(0)
    await fixture.setup.renderOnce()

    const frame = fixture.setup.captureCharFrame()
    expect(frame).toContain("★ Existing Favorite")
    expect(frame).toContain("★ New Favorite")
  })

  test("renders recommended stations on Home and plays them", async () => {
    const playback = new FakePlaybackController()
    const recommended = station("recommended", "Ambient Radio")
    await createApp({
      playback,
      getHomeSections: async () => ({
        items: [{ id: "radio", title: "Explore Radio", items: [recommended] }],
        nextCursor: null,
      }),
    })
    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    await Bun.sleep(0)
    await fixture.setup.renderOnce()

    expect(fixture.setup.captureCharFrame()).toContain("Ambient Radio")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    expect(playback.stationPlays).toEqual([recommended])
  })

  test("starts song and artist stations from confirmed now-playing context", async () => {
    const playback = new FakePlaybackController()
    const requested: Array<["songs" | "artists", string]> = []
    await createApp({
      playback,
      getSongContext: async () => testSongContext,
      getAlbum: async () => testAlbum,
      getArtistSection: async (_id, section) => artistSectionPage(section),
      getStationForResource: async (type, id) => {
        requested.push([type, id])
        return station(`${type}-${id}`, `${type} station`)
      },
    })
    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [],
      positionSeconds: 0,
      durationSeconds: 180,
      errorCode: null,
    })

    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("n")
    await Bun.sleep(0)
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("Start Station from This Song")
    fixture.setup.mockInput.pressArrow("down")
    fixture.setup.mockInput.pressArrow("down")
    fixture.setup.mockInput.pressArrow("down")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    expect(requested[0]).toEqual(["songs", "1"])

    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("n")
    await Bun.sleep(0)
    for (let index = 0; index < 4; index++) fixture.setup.mockInput.pressArrow("down")
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("Start Station from The Artist")
    fixture.setup.mockInput.pressEnter()
    await Bun.sleep(0)
    expect(requested[1]).toEqual(["artists", "artist-1"])
  })

  test("cancels radio catalog work on signout", async () => {
    const pending = deferred<AppleCatalogStation>()
    const signals: AbortSignal[] = []
    await createApp({
      getPersonalStation: (options) => {
        signals.push(options!.signal!)
        return pending.promise
      },
      getLiveRadioStations: (options) => {
        signals.push(options!.signal!)
        return new Promise(() => {})
      },
      getRecentlyPlayedStations: (options) => {
        signals.push(options!.signal!)
        return new Promise(() => {})
      },
    })
    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("r")
    expect(signals).toHaveLength(3)

    fixture.app.setAppleAuthStatus({ state: "signedOut" })
    expect(signals.every((signal) => signal.aborted)).toBe(true)
  })

  test("gates seek, previous, and next on confirmed playback capabilities", async () => {
    const playback = new FakePlaybackController()
    await createApp({ playback })
    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [],
      positionSeconds: 10,
      durationSeconds: 180,
      errorCode: null,
      canSeek: false,
      canSkipNext: false,
      canSkipPrevious: false,
    })

    fixture.setup.mockInput.pressArrow("right")
    fixture.setup.mockInput.pressKey("b")
    fixture.setup.mockInput.pressKey("n")
    await Bun.sleep(0)
    expect(playback.seekPositions).toEqual([])
    expect(playback.previousCount).toBe(0)
    expect(playback.nextCount).toBe(0)

    playback.confirm({
      ...playback.snapshot,
      canSeek: true,
      canSkipNext: true,
      canSkipPrevious: true,
    })
    fixture.setup.mockInput.pressArrow("right")
    fixture.setup.mockInput.pressKey("b")
    fixture.setup.mockInput.pressKey("n")
    await Bun.sleep(0)
    expect(playback.seekPositions).toEqual([15])
    expect(playback.previousCount).toBe(1)
    expect(playback.nextCount).toBe(1)
  })

  test("describes an empty dynamic queue as continuing radio", async () => {
    const playback = new FakePlaybackController()
    await createApp({ playback })
    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [],
      positionSeconds: 0,
      durationSeconds: null,
      errorCode: null,
      source: { type: "station", id: "radio", title: "Discovery", isLive: false },
      dynamicQueue: true,
    })
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("q")
    await fixture.setup.renderOnce()

    const frame = fixture.setup.captureCharFrame()
    expect(frame).toContain("0 tracks · radio continues")
    expect(frame).toContain("radio continues as songs are chosen")
    expect(frame).not.toContain("queue is empty")
  })
})
