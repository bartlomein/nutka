import { afterEach, describe, expect, test } from "bun:test"
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing"

import type {
  AudioSpectrumFrame,
  AppleArtistSectionName,
  AppleArtistSectionPage,
  AppleCatalogAlbum,
  AppleCatalogAlbumSummary,
  AppleCatalogArtist,
  AppleCatalogPlaylist,
  AppleCatalogTrack,
  AppleHomeSection,
  AppleLibraryPlaylist,
  ApplePlaylist,
  AppleSongContext,
  PlaybackController,
  PlaybackSnapshot,
  SearchOptions,
  SearchPage,
  Track,
} from "../core/types"
import { createNutkaApp, type NutkaApp } from "./app"
import type { VisualizerSettings } from "./visualizer"

let setup: TestRendererSetup | undefined
let app: NutkaApp | undefined

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}
const testTracks = [
  {
    id: "track-a",
    title: "First Track",
    artist: "Artist One",
    album: "First Album",
    durationSeconds: 180,
  },
  {
    id: "track-b",
    title: "Second Track",
    artist: "Artist Two",
    album: "Second Album",
    durationSeconds: 240,
  },
  {
    id: "track-c",
    title: "Third Track",
    artist: "Artist Three",
    album: "Third Album",
    durationSeconds: 300,
  },
  {
    id: "track-d",
    title: "Fourth Track",
    artist: "Artist Four",
    album: "Fourth Album",
    durationSeconds: 360,
  },
] as const satisfies readonly Track[]

const catalogTracks = testTracks.slice(0, 2).map((track, index) => ({
  ...track,
  id: `apple:song:${index + 1}`,
  audioQuality: { format: "lossless" as const, source: "catalog" as const },
  apple: {
    resourceId: String(index + 1),
    resourceType: "songs" as const,
    playParams: { id: String(index + 1), kind: "song" as const },
    audioTraits: ["lossless" as const],
    ...(index === 0
      ? { details: {
          releaseDate: "2026-02-13",
          genreNames: ["Alternative", "Electronic"],
          trackNumber: 3,
          discNumber: 1,
          composerName: "A Composer",
          contentRating: "explicit" as const,
          hasLyrics: true,
          isAppleDigitalMaster: true,
          editorialNotes: "A focused track note.",
        } }
      : {}),
  },
})) satisfies readonly AppleCatalogTrack[]

const testAlbum: AppleCatalogAlbum = {
  id: "apple:album:album-1",
  title: "The Album",
  artist: "The Artist",
  tracks: catalogTracks,
  apple: {
    resourceId: "album-1",
    resourceType: "albums",
    details: {
      releaseDate: "2026-02-13",
      genreNames: ["Alternative"],
      trackCount: 2,
      recordLabel: "Example Records",
      copyright: "2026 Example Records",
      contentRating: "clean",
      editorialNotes: "A focused album note.",
      isCompilation: false,
      isSingle: false,
    },
  },
}

const browseAlbum: AppleCatalogAlbumSummary = {
  id: testAlbum.id,
  title: testAlbum.title,
  artist: testAlbum.artist,
  apple: testAlbum.apple,
}

const testArtists = [
  {
    id: "apple:artist:artist-1",
    name: "The Artist",
    apple: {
      resourceId: "artist-1",
      resourceType: "artists" as const,
      details: { genreNames: ["Alternative"] },
    },
  },
  {
    id: "apple:artist:artist-2",
    name: "Guest Artist",
    apple: {
      resourceId: "artist-2",
      resourceType: "artists" as const,
      details: { genreNames: ["Electronic"] },
    },
  },
] satisfies readonly AppleCatalogArtist[]

const testSongContext: AppleSongContext = {
  albums: [browseAlbum],
  artists: testArtists,
}

function artistSectionPage(
  section: AppleArtistSectionName,
  nextCursor: string | null = null,
): AppleArtistSectionPage {
  switch (section) {
    case "top-songs":
      return { section, items: catalogTracks, nextCursor }
    case "latest-release":
    case "full-albums":
      return { section, items: [browseAlbum], nextCursor }
    case "singles":
      return { section, items: [], nextCursor }
    case "similar-artists":
      return { section, items: [testArtists[1]!], nextCursor }
  }
}

const recommendedPlaylists = [
  {
    id: "apple:playlist:pl.mix-1",
    title: "Favorites Mix",
    curator: "Apple Music for Me",
    description: "Songs selected for you.",
    apple: {
      resourceId: "pl.mix-1",
      resourceType: "playlists" as const,
      details: {
        lastModifiedDate: "2026-08-25T12:00:00Z",
        playlistType: "personal-mix",
        isChart: false,
      },
    },
  },
  {
    id: "apple:playlist:pl.chill-1",
    title: "Chill Mix",
    curator: "Apple Music for Me",
    apple: { resourceId: "pl.chill-1", resourceType: "playlists" as const },
  },
] satisfies readonly AppleCatalogPlaylist[]

const homeSections = [
  {
    id: "recommendation:made-for-you",
    title: "Made for You",
    items: [recommendedPlaylists[0]!],
  },
  {
    id: "recommendation:more-like-chill",
    title: "More Like Chill",
    items: [recommendedPlaylists[1]!],
  },
] satisfies readonly AppleHomeSection[]

const savedPlaylists = [
  {
    id: "apple:library-playlist:p.favorites",
    title: "Favorites Mix",
    curator: "Your Library",
    apple: {
      resourceId: "p.favorites",
      resourceType: "library-playlists" as const,
      globalId: "pl.mix-1",
      details: {
        dateAdded: "2026-08-20T09:30:00Z",
        canEdit: true,
        isPublic: false,
        hasCatalog: true,
      },
    },
  },
  {
    id: "apple:library-playlist:p.coding",
    title: "Coding",
    curator: "Your Library",
    apple: {
      resourceId: "p.coding",
      resourceType: "library-playlists" as const,
    },
  },
] satisfies readonly AppleLibraryPlaylist[]

class FakePlaybackController implements PlaybackController<AppleCatalogTrack> {
  snapshot: PlaybackSnapshot<AppleCatalogTrack> = {
    status: "idle",
    currentTrack: null,
    queue: [],
    positionSeconds: 0,
    durationSeconds: null,
    errorCode: null,
    shuffleMode: "off",
    repeatMode: "none",
    canSetShuffleMode: false,
    canSetRepeatMode: false,
  }
  readonly plays: Array<{
    track: AppleCatalogTrack
    upcomingTracks: readonly AppleCatalogTrack[]
  }> = []
  pauseCount = 0
  resumeCount = 0
  previousCount = 0
  nextCount = 0
  readonly shuffleModeChanges: Array<"off" | "songs"> = []
  readonly repeatModeChanges: Array<"none" | "all" | "one"> = []
  readonly analysisEnabledChanges: boolean[] = []
  readonly seekPositions: number[] = []
  disconnectCount = 0
  private readonly listeners = new Set<(
    snapshot: PlaybackSnapshot<AppleCatalogTrack>,
  ) => void>()
  private readonly analysisListeners = new Set<(
    frame: AudioSpectrumFrame | null,
  ) => void>()
  readonly audioAnalysis = {
    subscribe: (listener: (frame: AudioSpectrumFrame | null) => void): (() => void) => {
      this.analysisListeners.add(listener)
      listener(null)
      return () => this.analysisListeners.delete(listener)
    },
    setEnabled: async (enabled: boolean): Promise<void> => {
      this.analysisEnabledChanges.push(enabled)
    },
  }

  subscribe(listener: (snapshot: PlaybackSnapshot<AppleCatalogTrack>) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => this.listeners.delete(listener)
  }

  async play(
    track: AppleCatalogTrack,
    upcomingTracks: readonly AppleCatalogTrack[],
  ): Promise<void> {
    this.plays.push({ track, upcomingTracks })
  }

  async pause(): Promise<void> {
    this.pauseCount++
  }

  async resume(): Promise<void> {
    this.resumeCount++
  }

  async previous(): Promise<void> {
    this.previousCount++
  }

  async next(): Promise<void> {
    this.nextCount++
  }

  async setShuffleMode(mode: "off" | "songs"): Promise<void> {
    this.shuffleModeChanges.push(mode)
  }

  async setRepeatMode(mode: "none" | "all" | "one"): Promise<void> {
    this.repeatModeChanges.push(mode)
  }

  async seek(positionSeconds: number): Promise<void> {
    this.seekPositions.push(positionSeconds)
  }
  async stop(): Promise<void> {}

  async disconnect(): Promise<void> {
    this.disconnectCount++
    this.confirm({
      status: "idle",
      currentTrack: null,
      queue: [],
      positionSeconds: 0,
      durationSeconds: null,
      errorCode: null,
    })
  }

  async dispose(): Promise<void> {}

  confirm(snapshot: Omit<
    PlaybackSnapshot<AppleCatalogTrack>,
    | "shuffleMode"
    | "repeatMode"
    | "canSetShuffleMode"
    | "canSetRepeatMode"
  > & Partial<Pick<
    PlaybackSnapshot<AppleCatalogTrack>,
    | "shuffleMode"
    | "repeatMode"
    | "canSetShuffleMode"
    | "canSetRepeatMode"
  >>): void {
    this.snapshot = { ...this.snapshot, ...snapshot }
    for (const listener of this.listeners) listener(this.snapshot)
  }

  confirmAnalysis(frame: AudioSpectrumFrame | null): void {
    for (const listener of this.analysisListeners) listener(frame)
  }
}

afterEach(() => {
  app?.destroy()
  setup?.renderer.destroy()
  app = undefined
  setup = undefined
})

async function createApp(
  options: {
    width?: number
    height?: number
    kittyKeyboard?: boolean
    tracks?: readonly Track[]
    searchSongs?: (
      query: string,
      options?: SearchOptions,
    ) => Promise<SearchPage<Track>>
    getAlbumForSong?: (
      songResourceId: string,
      options?: Pick<SearchOptions, "signal">,
    ) => Promise<AppleCatalogAlbum>
    getSongContext?: (
      songResourceId: string,
      options?: Pick<SearchOptions, "signal">,
    ) => Promise<AppleSongContext>
    getAlbum?: (
      albumResourceId: string,
      options?: Pick<SearchOptions, "signal">,
    ) => Promise<AppleCatalogAlbum>
    getArtistSection?: (
      artistResourceId: string,
      section: AppleArtistSectionName,
      options?: SearchOptions,
    ) => Promise<AppleArtistSectionPage>
    getHomeSections?: (
      options?: SearchOptions,
    ) => Promise<SearchPage<AppleHomeSection>>
    getLibraryPlaylists?: (
      options?: SearchOptions,
    ) => Promise<SearchPage<AppleLibraryPlaylist>>
    getPlaylistTracks?: (
      playlist: ApplePlaylist,
      options?: SearchOptions,
    ) => Promise<SearchPage<AppleCatalogTrack>>
    getSongLiked?: (
      songResourceId: string,
      options?: Pick<SearchOptions, "signal">,
    ) => Promise<boolean>
    setSongLiked?: (
      songResourceId: string,
      liked: boolean,
      options?: Pick<SearchOptions, "signal">,
    ) => Promise<void>
    playback?: PlaybackController<AppleCatalogTrack>
    visualizerSettings?: VisualizerSettings
    saveVisualizerSettings?: (settings: VisualizerSettings) => void
  } = {},
  onQuit = () => {},
  apple: {
    onSignIn?: () => void
    onSignOut?: () => void
    onCancel?: () => void
    onRestore?: () => void
  } = {},
): Promise<void> {
  setup = await createTestRenderer({
    width: options.width ?? 120,
    height: options.height ?? 32,
    kittyKeyboard: options.kittyKeyboard,
  })
  app = createNutkaApp(setup.renderer, {
    tracks: options.tracks ?? testTracks,
    onSearchSongs: options.searchSongs,
    onGetAlbumForSong: options.getAlbumForSong,
    onGetSongContext: options.getSongContext,
    onGetAlbum: options.getAlbum,
    onGetArtistSection: options.getArtistSection,
    onGetHomeSections: options.getHomeSections,
    onGetLibraryPlaylists: options.getLibraryPlaylists,
    onGetPlaylistTracks: options.getPlaylistTracks,
    onGetSongLiked: options.getSongLiked,
    onSetSongLiked: options.setSongLiked,
    onQuit,
    onAppleSignIn: apple.onSignIn,
    onAppleSignOut: apple.onSignOut,
    onAppleSignInCancel: apple.onCancel,
    onAppleRestore: apple.onRestore,
    playback: options.playback,
    visualizerSettings: options.visualizerSettings,
    onSaveVisualizerSettings: options.saveVisualizerSettings,
  })
}

describe("Nutka TUI", () => {
  test("starts with an honest empty Apple Music workspace", async () => {
    await createApp({ tracks: [] })
    await setup!.renderOnce()
    const frame = setup!.captureCharFrame()

    expect(frame).toContain("Apple Music Home is not loaded yet")
    expect(frame).not.toContain("First Track")

    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("s")
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("Type a search and press Enter")
  })

  test("starts on Home and renders Apple's titled recommendation sections", async () => {
    await createApp({
      getHomeSections: async () => ({ items: homeSections, nextCursor: null }),
    })
    app!.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    await Bun.sleep(0)
    await setup!.renderOnce()
    const frame = setup!.captureCharFrame()

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

  test("opens pinned track info and traps background keys", async () => {
    let quitCount = 0
    await createApp(
      { kittyKeyboard: true, tracks: catalogTracks },
      () => quitCount++,
    )
    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("l")

    setup!.mockInput.pressKey("i")
    await setup!.renderOnce()
    const frame = setup!.captureCharFrame()
    expect(frame).toContain("track info")
    expect(frame).toContain("First Track")
    expect(frame).toContain("Released      2026-02-13")
    expect(frame).toContain("Genres        Alternative, Electronic")
    expect(frame).toContain("Audio         LOSSLESS")
    expect(frame).toContain("A focused track note.")

    setup!.mockInput.pressKey("q")
    setup!.mockInput.pressKey("j")
    expect(quitCount).toBe(0)
    expect(app!.getState().lists.library.selectedTrackId).toBe("apple:song:1")

    setup!.mockInput.pressKey("i")
    setup!.mockInput.pressKey("j")
    expect(app!.getState().lists.library.selectedTrackId).toBe("apple:song:2")
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
    app!.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    await Bun.sleep(0)
    setup!.mockInput.pressKey("i")
    await setup!.renderOnce()

    const firstFrame = setup!.captureCharFrame()
    expect(firstFrame).toContain("playlist info")
    expect(firstFrame).toContain("Source        For You")
    expect(firstFrame).toContain("Type          Personal Mix")
    expect(firstFrame).toContain("Updated       2026-08-25")
    expect(firstFrame).not.toContain("Ending marker.")

    setup!.mockInput.pressKey("END")
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("Ending marker.")
    setup!.mockInput.pressEscape()
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).not.toContain("playlist info")
  })

  test("includes loaded album context in selected track info", async () => {
    await createApp({
      kittyKeyboard: true,
      searchSongs: async () => ({ items: catalogTracks, nextCursor: null }),
      getAlbumForSong: async () => testAlbum,
    })
    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("s")
    await setup!.mockInput.typeText("first")
    setup!.mockInput.pressEnter()
    await Bun.sleep(0)
    setup!.mockInput.pressKey("a")
    await Bun.sleep(0)
    setup!.mockInput.pressKey("i")
    await setup!.renderOnce()

    const frame = setup!.captureCharFrame()
    expect(frame).toContain("track info")
    setup!.mockInput.pressKey("END")
    await setup!.renderOnce()
    const albumFrame = setup!.captureCharFrame()
    expect(albumFrame).toContain("ALBUM")
    expect(albumFrame).toContain("The Album")
    expect(albumFrame).toContain("Label         Example Records")
    expect(albumFrame).toContain("A focused album note.")
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

    app!.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    await Bun.sleep(0)
    await setup!.renderOnce()
    const home = setup!.captureCharFrame()

    expect(home).toContain("nutka  /  home")
    expect(home).toContain("Made for You")
    expect(home).toContain("More Like Chill")
    expect(home).toContain("Favorites Mix")
    expect(home).toContain("Chill Mix")
    expect(home).not.toContain("Coding")

    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("p")
    await Bun.sleep(0)
    await setup!.renderOnce()
    const landing = setup!.captureCharFrame()

    expect(landing).toContain("nutka  /  playlists")
    expect(landing).toContain("YOUR LIBRARY")
    expect(landing).toContain("Coding")
    expect(landing.match(/Favorites Mix/g)).toHaveLength(1)
    expect(landing).not.toContain("Chill Mix")

    setup!.mockInput.pressKey("/")
    await setup!.mockInput.typeText("Coding")
    setup!.mockInput.pressEnter()
    setup!.mockInput.pressEnter()
    await Bun.sleep(0)
    await setup!.renderOnce()

    expect(opened).toEqual([savedPlaylists[1]!])
    expect(setup!.captureCharFrame()).toContain("nutka  /  playlists  /  playlist")
    expect(setup!.captureCharFrame()).toContain("First Track")
    setup!.mockInput.pressEnter()
    expect(playback.plays[0]?.track.id).toBe("apple:song:1")
    expect(playback.plays[0]?.upcomingTracks.map((track) => track.id)).toEqual([
      "apple:song:2",
    ])

    setup!.mockInput.pressEscape()
    await Bun.sleep(0)
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("Coding")
    expect(setup!.captureCharFrame()).not.toContain("First Track")
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

    app!.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    await Bun.sleep(0)
    setup!.mockInput.pressKey("s")
    await Bun.sleep(0)
    await Bun.sleep(0)
    await setup!.renderOnce()

    expect(cursors).toEqual([undefined, "/next-tracks"])
    expect(playback.plays).toHaveLength(1)
    expect([
      playback.plays[0]!.track.id,
      ...playback.plays[0]!.upcomingTracks.map((track) => track.id),
    ].sort()).toEqual(["apple:song:1", "apple:song:2"])
    expect(playback.shuffleModeChanges).toEqual(["songs"])
    expect(app!.getState().destination).toBe("home")
    expect(app!.getState().lists.home.selectedTrackId).toBe(
      recommendedPlaylists[1]!.id,
    )
    expect(setup!.captureCharFrame()).not.toContain("home  /  playlist")
    expect(setup!.captureCharFrame()).not.toContain("First Track")
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

    app!.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    await Bun.sleep(0)
    setup!.mockInput.pressKey("m")
    await Bun.sleep(0)
    await setup!.renderOnce()

    expect(cursors).toEqual([undefined, "/next-home-page"])
    const frame = setup!.captureCharFrame()
    expect(frame).toContain("Made for You")
    expect(frame).toContain("More Like Chill")
    expect(frame).toContain("Favorites Mix")
    expect(frame).toContain("Chill Mix")
    expect(frame.match(/Favorites Mix/g)).toHaveLength(1)
    setup!.mockInput.pressKey("j")
    expect(app!.getState().lists.home.selectedTrackId).toBe(
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

    app!.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    await Bun.sleep(0)
    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("p")
    await Bun.sleep(0)
    setup!.mockInput.pressKey("m")
    await Bun.sleep(0)
    await setup!.renderOnce()

    expect(cursors).toEqual([undefined, "/next-library-page"])
    expect(setup!.captureCharFrame()).toContain("Later Playlist")
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

    app!.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("p")
    await Bun.sleep(0)
    app!.setAppleAuthStatus({ state: "signedOut" })

    expect(homeSignal?.aborted).toBe(true)
    expect(librarySignal?.aborted).toBe(true)
    pendingHome.resolve({ items: [homeSections[0]!], nextCursor: null })
    pendingLibrary.resolve({ items: [savedPlaylists[1]!], nextCursor: null })
    await Bun.sleep(0)
    await setup!.renderOnce()
    const frame = setup!.captureCharFrame()
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

    app!.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    await Bun.sleep(0)
    setup!.mockInput.pressEnter()
    await Bun.sleep(0)
    app!.setAppleAuthStatus({ state: "signedOut" })

    expect(trackSignal?.aborted).toBe(true)
    pendingTracks.resolve({ items: catalogTracks, nextCursor: null })
    await Bun.sleep(0)
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).not.toContain("First Track")
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

    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("n")
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
    await setup!.renderOnce()
    const picker = setup!.captureCharFrame()
    expect(picker).toContain("browse now playing")
    expect(picker).toContain("The Album")
    expect(picker).toContain("The Artist")
    expect(picker).toContain("Guest Artist")
    expect(picker).toContain("Second Track")

    setup!.mockInput.pressEnter()
    await Bun.sleep(0)
    await setup!.renderOnce()
    expect(albumIds).toEqual(["album-1"])
    expect(setup!.captureCharFrame()).toContain("nutka  /  album")

    setup!.mockInput.pressKey("s")
    expect(playback.shuffleModeChanges).toEqual(["songs"])
    expect(playback.plays).toHaveLength(0)

    setup!.mockInput.pressEnter()
    expect(playback.plays.at(-1)?.track.id).toBe("apple:song:1")
    setup!.mockInput.pressEscape()
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("browse now playing")
    setup!.mockInput.pressEscape()
    expect(app!.getState().destination).toBe("home")
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

    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("n")
    await Bun.sleep(0)
    setup!.mockInput.pressKey("j")
    setup!.mockInput.pressEnter()
    await Bun.sleep(0)
    await setup!.renderOnce()

    const artistPage = setup!.captureCharFrame()
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

    setup!.mockInput.pressEnter()
    expect(playback.plays.at(-1)?.track.id).toBe("apple:song:1")
    setup!.mockInput.pressKey("j")
    setup!.mockInput.pressKey("j")
    setup!.mockInput.pressEnter()
    await Bun.sleep(0)
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("nutka  /  album")

    setup!.mockInput.pressEscape()
    setup!.mockInput.pressKey("j")
    setup!.mockInput.pressKey("m")
    await Bun.sleep(0)
    await setup!.renderOnce()
    expect(sectionRequests.at(-1)).toEqual({
      artistId: "artist-1",
      section: "full-albums",
      cursor: "/next-full-albums",
    })
    expect(setup!.captureCharFrame()).toContain("Second Album")

    setup!.mockInput.pressKey("o", { ctrl: true })
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("browse now playing")
    setup!.mockInput.pressEscape()
    expect(app!.getState().destination).toBe("home")
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
    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("n")
    await Bun.sleep(0)
    setup!.mockInput.pressKey("j")
    setup!.mockInput.pressEnter()
    await Bun.sleep(0)

    topSongs.resolve(artistSectionPage("top-songs"))
    await Bun.sleep(0)
    setup!.mockInput.pressEnter()

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
    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("n")
    await Bun.sleep(0)
    setup!.mockInput.pressKey("j")
    setup!.mockInput.pressEnter()
    await Bun.sleep(0)

    setup!.mockInput.pressKey("o", { ctrl: true })

    expect(sectionSignals).toHaveLength(5)
    expect(sectionSignals.every((signal) => signal.aborted)).toBe(true)
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("browse now playing")
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
    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("n")
    await Bun.sleep(0)
    for (let index = 0; index < 8; index++) setup!.mockInput.pressKey("j")
    await setup!.renderOnce()

    const frame = setup!.captureCharFrame()
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
    app!.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [],
      positionSeconds: 1,
      durationSeconds: 180,
      errorCode: null,
    })
    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("n")
    await Bun.sleep(0)
    setup!.mockInput.pressKey("j")
    setup!.mockInput.pressEnter()
    await Bun.sleep(0)

    expect(sectionSignals).toHaveLength(5)
    expect(sectionSignals.every((signal) => !signal.aborted)).toBe(true)
    app!.setAppleAuthStatus({ state: "signedOut" })
    expect(sectionSignals.every((signal) => signal.aborted)).toBe(true)
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).not.toContain("TOP SONGS")
  })

  test("moves selection without simulating unavailable playback", async () => {
    await createApp()

    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("l")
    setup!.mockInput.pressKey("j")
    setup!.mockInput.pressEnter()
    setup!.mockInput.pressKey(" ")

    expect(app!.getState()).toMatchObject({
      destination: "library",
      lists: { library: { selectedTrackId: "track-b" } },
      playback: {
        currentTrackId: null,
        status: "idle",
        queueTrackIds: [],
      },
    })
  })

  test("plays the selected Apple song and renders only worker-confirmed state", async () => {
    const playback = new FakePlaybackController()
    await createApp({
      playback,
      searchSongs: async () => ({ items: catalogTracks, nextCursor: null }),
    })
    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("s")
    await setup!.mockInput.typeText("tracks")
    setup!.mockInput.pressEnter()
    await Bun.sleep(0)

    setup!.mockInput.pressEnter()
    expect(playback.plays).toHaveLength(1)
    expect(playback.plays[0]?.track.id).toBe("apple:song:1")
    expect(playback.plays[0]?.upcomingTracks.map((track) => track.id)).toEqual([
      "apple:song:2",
    ])
    expect(app!.getState().playback.status).toBe("idle")

    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [catalogTracks[1]!],
      positionSeconds: 12,
      durationSeconds: 180,
      errorCode: null,
      canSetShuffleMode: true,
      canSetRepeatMode: true,
    })
    await setup!.renderOnce()
    expect(app!.getState().playback).toMatchObject({
      currentTrackId: "apple:song:1",
      status: "playing",
      queueTrackIds: ["apple:song:2"],
      positionSeconds: 12,
    })
    expect(setup!.captureCharFrame()).toContain("First Track")
    expect(setup!.captureCharFrame()).toContain("0:12  ━━━━━●")
    expect(setup!.captureCharFrame()).toContain("3:00")
    expect(setup!.captureCharFrame()).toContain("NEXT  Second Track")
    expect(setup!.captureCharFrame()).toContain("AUDIO  LOSSLESS")

    const stateBeforeAnalysis = app!.getState()
    playback.confirmAnalysis({
      sequence: 1,
      bands: Array.from({ length: 64 }, (_, index) => index * 4),
      rms: 160,
      peak: 240,
    })
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toMatch(/[▁▂▃▄▅▆▇█]/)
    expect(app!.getState()).toEqual(stateBeforeAnalysis)

    setup!.mockInput.pressArrow("right")
    await Bun.sleep(0)
    expect(playback.seekPositions).toEqual([17])
    playback.confirm({ ...playback.snapshot, positionSeconds: 17 })
    setup!.mockInput.pressArrow("left", { shift: true })
    await Bun.sleep(0)
    expect(playback.seekPositions).toEqual([17, 2])

    setup!.mockInput.pressKey(" ")
    expect(playback.pauseCount).toBe(1)
    expect(app!.getState().playback.status).toBe("playing")
    playback.confirm({ ...playback.snapshot, status: "paused", positionSeconds: 13 })
    setup!.mockInput.pressKey(" ")
    expect(playback.resumeCount).toBe(1)

    setup!.mockInput.pressKey("n")
    setup!.mockInput.pressKey("b")
    setup!.mockInput.pressKey("s")
    setup!.mockInput.pressKey("r")
    expect(playback.nextCount).toBe(1)
    expect(playback.previousCount).toBe(1)
    expect(playback.plays).toHaveLength(1)
    expect(playback.shuffleModeChanges).toEqual(["songs"])
    expect(playback.repeatModeChanges).toEqual(["all"])
    expect(app!.getState().playback.shuffleMode).toBe("off")

    playback.confirm({
      ...playback.snapshot,
      shuffleMode: "songs",
      repeatMode: "all",
    })
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("SHUFFLE ON")
    expect(setup!.captureCharFrame()).toContain("REPEAT ALL")

    setup!.mockInput.pressKey("s")
    setup!.mockInput.pressKey("r")
    expect(playback.shuffleModeChanges).toEqual(["songs", "off"])
    expect(playback.repeatModeChanges).toEqual(["all", "one"])

    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("q")
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("Second Track")
  })

  test("loads and toggles the current song like with optimistic feedback", async () => {
    const playback = new FakePlaybackController()
    const initialLike = deferred<boolean>()
    const savedLike = deferred<void>()
    const loads: string[] = []
    const saves: Array<{ resourceId: string; liked: boolean }> = []
    await createApp({
      tracks: catalogTracks,
      playback,
      getSongLiked: async (resourceId) => {
        loads.push(resourceId)
        return initialLike.promise
      },
      setSongLiked: async (resourceId, liked) => {
        saves.push({ resourceId, liked })
        return savedLike.promise
      },
    }, undefined, { onSignIn: () => {} })
    app!.setAppleAuthStatus({ state: "signedIn", storefront: "us" })

    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [],
      positionSeconds: 0,
      durationSeconds: catalogTracks[0]!.durationSeconds,
      errorCode: null,
    })
    await setup!.renderOnce()
    expect(loads).toEqual(["1"])
    expect(setup!.captureCharFrame()).toContain("◌  First Track")

    initialLike.resolve(false)
    await Bun.sleep(0)
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("☆  First Track")

    setup!.mockInput.pressKey("l")
    await setup!.renderOnce()
    expect(saves).toEqual([{ resourceId: "1", liked: true }])
    expect(setup!.captureCharFrame()).toContain("★  First Track")

    savedLike.resolve()
    await Bun.sleep(0)
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("★  First Track")

    setup!.mockInput.pressKey("l")
    await Bun.sleep(0)
    await setup!.renderOnce()
    expect(saves).toEqual([
      { resourceId: "1", liked: true },
      { resourceId: "1", liked: false },
    ])
    expect(setup!.captureCharFrame()).toContain("☆  First Track")
  })

  test("rolls back a failed like change without exposing the service error", async () => {
    const playback = new FakePlaybackController()
    await createApp({
      tracks: catalogTracks,
      playback,
      getSongLiked: async () => true,
      setSongLiked: async () => {
        throw new Error("private service details")
      },
    }, undefined, { onSignIn: () => {} })
    app!.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [],
      positionSeconds: 0,
      durationSeconds: catalogTracks[0]!.durationSeconds,
      errorCode: null,
    })
    await Bun.sleep(0)

    setup!.mockInput.pressKey("l")
    await Bun.sleep(0)
    await setup!.renderOnce()
    const frame = setup!.captureCharFrame()
    expect(frame).toContain("★  First Track")
    expect(frame).toContain("Could not update favorite")
    expect(frame).not.toContain("private service details")
  })

  test("coalesces repeated scrubbing to the latest bounded seek", async () => {
    const firstSeek = deferred<void>()
    class SlowSeekPlaybackController extends FakePlaybackController {
      override async seek(positionSeconds: number): Promise<void> {
        this.seekPositions.push(positionSeconds)
        if (this.seekPositions.length === 1) await firstSeek.promise
      }
    }
    const playback = new SlowSeekPlaybackController()
    await createApp({ playback })
    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [],
      positionSeconds: 10,
      durationSeconds: 180,
      errorCode: null,
    })

    setup!.mockInput.pressArrow("right")
    setup!.mockInput.pressArrow("right")
    setup!.mockInput.pressArrow("right", { shift: true })
    expect(playback.seekPositions).toEqual([15])

    firstSeek.resolve(undefined)
    await Bun.sleep(0)
    expect(playback.seekPositions).toEqual([15, 35])

    playback.confirm({ ...playback.snapshot, positionSeconds: 35 })
    playback.confirm({ ...playback.snapshot, positionSeconds: 178 })
    setup!.mockInput.pressArrow("right", { shift: true })
    await Bun.sleep(0)
    expect(playback.seekPositions.at(-1)).toBe(180)
  })

  test("toggles visualizer rendering and analysis capture with v", async () => {
    const playback = new FakePlaybackController()
    await createApp({ playback })
    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [],
      positionSeconds: 1,
      durationSeconds: 180,
      errorCode: null,
    })
    playback.confirmAnalysis({
      sequence: 1,
      bands: Array.from({ length: 64 }, () => 220),
      rms: 180,
      peak: 240,
    })
    await setup!.renderOnce()
    expect(setup!.captureCharFrame().match(/[▁▂▃▄▅▆▇█]/gu)?.length).toBeGreaterThanOrEqual(8)

    setup!.mockInput.pressKey("v")
    await setup!.renderOnce()
    expect(playback.analysisEnabledChanges).toEqual([false])
    expect(setup!.captureCharFrame()).not.toMatch(/[▁▂▃▄▅▆▇█]/)

    setup!.mockInput.pressKey("v")
    playback.confirmAnalysis({
      sequence: 2,
      bands: Array.from({ length: 64 }, () => 200),
      rms: 170,
      peak: 230,
    })
    await setup!.renderOnce()
    expect(playback.analysisEnabledChanges).toEqual([false, true])
    expect(setup!.captureCharFrame().match(/[▁▂▃▄▅▆▇█]/gu)?.length).toBeGreaterThanOrEqual(8)
  })

  test("previews, applies, and cancels visualizer settings with shift+v", async () => {
    const saved: VisualizerSettings[] = []
    await createApp({
      kittyKeyboard: true,
      visualizerSettings: {
        kind: "spectrum",
        style: "dense",
        palette: "theme",
        height: 3,
      },
      saveVisualizerSettings: (settings) => saved.push({ ...settings }),
    })

    setup!.mockInput.pressKey("v", { shift: true })
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("visualizer settings")
    expect(setup!.captureCharFrame()).toContain("‹ Dense ›")

    setup!.mockInput.pressArrow("down")
    setup!.mockInput.pressArrow("right")
    setup!.mockInput.pressArrow("down")
    setup!.mockInput.pressArrow("right")
    setup!.mockInput.pressArrow("down")
    setup!.mockInput.pressArrow("right")
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("‹ Spaced ›")
    expect(setup!.captureCharFrame()).toContain("‹ Monochrome ›")
    expect(setup!.captureCharFrame()).toContain("‹ 4 rows ›")

    setup!.mockInput.pressEnter()
    expect(saved).toEqual([{
      kind: "spectrum",
      style: "spaced",
      palette: "monochrome",
      height: 4,
    }])

    setup!.mockInput.pressKey("v", { shift: true })
    setup!.mockInput.pressArrow("down")
    setup!.mockInput.pressArrow("right")
    setup!.mockInput.pressEscape()
    setup!.mockInput.pressKey("v", { shift: true })
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("‹ Spaced ›")
    expect(setup!.captureCharFrame()).not.toContain("‹ Wide ›")
  })

  test("keeps visualizer settings open when persistence fails", async () => {
    await createApp({
      kittyKeyboard: true,
      visualizerSettings: {
        kind: "spectrum",
        style: "dense",
        palette: "theme",
        height: 3,
      },
      saveVisualizerSettings: () => {
        throw new Error("disk unavailable")
      },
    })

    setup!.mockInput.pressKey("v", { shift: true })
    setup!.mockInput.pressArrow("down")
    setup!.mockInput.pressArrow("right")
    setup!.mockInput.pressEnter()
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("Could not save visualizer settings")

    setup!.mockInput.pressEscape()
    setup!.mockInput.pressKey("v", { shift: true })
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("‹ Dense ›")
  })

  test("keeps visualizer controls usable in a very small terminal", async () => {
    await createApp({ width: 30, height: 8, kittyKeyboard: true })

    setup!.mockInput.pressKey("v", { shift: true })
    await setup!.renderOnce()
    const frame = setup!.captureCharFrame()
    expect(frame).toContain("Visualizer")
    expect(frame).toContain("Style")
    expect(frame).toContain("Palette")
    expect(frame).toContain("Height")
  })

  test("opens visualizer settings from an uppercase terminal key", async () => {
    await createApp()

    setup!.mockInput.pressKey("V")
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("visualizer settings")
  })

  test("disconnects confirmed playback when Apple authorization changes", async () => {
    const playback = new FakePlaybackController()
    await createApp({ playback })
    app!.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [],
      positionSeconds: 4,
      durationSeconds: 180,
      errorCode: null,
    })

    app!.setAppleAuthStatus({ state: "signedOut" })
    expect(playback.disconnectCount).toBe(1)
    expect(app!.getState().playback.status).toBe("idle")
    expect(app!.getState().playback.currentTrackId).toBeNull()
  })

  test("uses ctrl+p for commands rather than track search", async () => {
    await createApp()

    setup!.mockInput.pressKey("p", { ctrl: true })
    await setup!.mockInput.typeText("queue")
    await setup!.renderOnce()

    expect(app!.getState().mode).toEqual({
      type: "palette",
      query: "queue",
      selectedIndex: 0,
    })
    expect(setup!.captureCharFrame()).toContain("commands")
    expect(setup!.captureCharFrame()).toContain("Go to Queue")

    setup!.mockInput.pressEnter()
    await setup!.renderOnce()

    expect(app!.getState().destination).toBe("queue")
    expect(app!.getState().mode.type).toBe("normal")
    expect(setup!.captureCharFrame()).toContain("queue is empty")
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

    setup!.mockInput.pressKey("p", { ctrl: true })
    await setup!.mockInput.typeText("now playing")
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("no matching commands")
    setup!.mockInput.pressEscape()

    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [],
      positionSeconds: 1,
      durationSeconds: 180,
      errorCode: null,
    })
    setup!.mockInput.pressKey("p", { ctrl: true })
    await setup!.mockInput.typeText("now playing")
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("Browse Now Playing")
    setup!.mockInput.pressEnter()
    await Bun.sleep(0)
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("browse now playing")
  })

  test("toggles the visualizer from the command palette", async () => {
    const playback = new FakePlaybackController()
    await createApp({ playback })

    setup!.mockInput.pressKey("p", { ctrl: true })
    await setup!.mockInput.typeText("visualizer")
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("Toggle visualizer")

    setup!.mockInput.pressEnter()
    expect(app!.getState().mode.type).toBe("normal")
    expect(playback.analysisEnabledChanges).toEqual([false])

    setup!.mockInput.pressKey("p", { ctrl: true })
    await setup!.mockInput.typeText("palette color height")
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("Visualizer settings")
    setup!.mockInput.pressEnter()
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("visualizer settings")
  })

  test("exposes confirmed shuffle and repeat controls in the command palette", async () => {
    const playback = new FakePlaybackController()
    await createApp({ playback })
    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [catalogTracks[1]!],
      positionSeconds: 1,
      durationSeconds: 180,
      errorCode: null,
      canSetShuffleMode: true,
      canSetRepeatMode: true,
    })

    setup!.mockInput.pressKey("p", { ctrl: true })
    await setup!.mockInput.typeText("shuffle")
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("Toggle Shuffle")
    setup!.mockInput.pressEnter()
    expect(playback.shuffleModeChanges).toEqual(["songs"])

    setup!.mockInput.pressKey("p", { ctrl: true })
    await setup!.mockInput.typeText("repeat mode")
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("Cycle Repeat Mode")
    setup!.mockInput.pressEnter()
    expect(playback.repeatModeChanges).toEqual(["all"])
  })

  test("submits Apple search and keeps slash as a local result filter", async () => {
    const queries: string[] = []
    await createApp({
      searchSongs: async (query) => {
        queries.push(query)
        return { items: testTracks, nextCursor: "/next-page" }
      },
    })

    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("s")
    await setup!.mockInput.typeText("track")
    setup!.mockInput.pressEnter()
    await Bun.sleep(0)
    await setup!.renderOnce()

    expect(app!.getState()).toMatchObject({
      destination: "search",
      mode: { type: "normal" },
      lists: { search: { selectedTrackId: "track-a", filter: "" } },
    })
    expect(queries).toEqual(["track"])
    expect(setup!.captureCharFrame()).toContain("Search music")

    setup!.mockInput.pressKey("/")
    await setup!.mockInput.typeText("second")
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("Second Track")
    expect(setup!.captureCharFrame()).not.toContain("First Track")

    setup!.mockInput.pressEnter()

    expect(app!.getState()).toMatchObject({
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

    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("s")
    await setup!.mockInput.typeText("first")
    setup!.mockInput.pressEnter()
    await Bun.sleep(0)
    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("s")
    for (let index = 0; index < 5; index++) setup!.mockInput.pressBackspace()
    await setup!.mockInput.typeText("second")
    setup!.mockInput.pressEnter()
    expect(signals[0]?.aborted).toBe(true)

    second.resolve({ items: [testTracks[1]!], nextCursor: null })
    await Bun.sleep(0)
    first.resolve({ items: [testTracks[0]!], nextCursor: null })
    await Bun.sleep(0)
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("Second Track")
    expect(setup!.captureCharFrame()).not.toContain("First Track")

  })

  test("clears old rows while a replacement search is loading", async () => {
    const replacement = deferred<SearchPage<Track>>()
    await createApp({
      searchSongs: async (query) => query === "first"
        ? { items: [testTracks[0]!], nextCursor: null }
        : replacement.promise,
    })

    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("s")
    await setup!.mockInput.typeText("first")
    setup!.mockInput.pressEnter()
    await Bun.sleep(0)
    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("s")
    for (let index = 0; index < 5; index++) setup!.mockInput.pressBackspace()
    await setup!.mockInput.typeText("second")
    setup!.mockInput.pressEnter()
    await setup!.renderOnce()

    const frame = setup!.captureCharFrame()
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

    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("s")
    await setup!.mockInput.typeText("tracks")
    setup!.mockInput.pressEnter()
    await Bun.sleep(0)
    setup!.mockInput.pressKey("m")
    await Bun.sleep(0)
    await setup!.renderOnce()

    expect(calls).toEqual([
      { query: "tracks", cursor: undefined },
      { query: "tracks", cursor: "/next" },
    ])
    const frame = setup!.captureCharFrame()
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

    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("s")
    await setup!.mockInput.typeText("first")
    setup!.mockInput.pressEnter()
    await Bun.sleep(0)
    setup!.mockInput.pressKey("p", { ctrl: true })
    await setup!.mockInput.typeText("album")
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("Go to Album")
    setup!.mockInput.pressEscape()

    setup!.mockInput.pressKey("a")
    await setup!.renderOnce()
    expect(requests).toEqual(["1"])
    expect(setup!.captureCharFrame()).toContain("loading “First Album”")
    expect(setup!.captureCharFrame()).not.toContain("First Track")

    pendingAlbum.resolve(testAlbum)
    await Bun.sleep(0)
    await setup!.renderOnce()
    const albumFrame = setup!.captureCharFrame()
    expect(albumFrame).toContain("nutka  /  search  /  album")
    expect(albumFrame).toContain("The Album")
    expect(albumFrame).toContain("The Artist")
    expect(albumFrame).toContain("First Track")
    expect(albumFrame).toContain("Second Track")

    setup!.mockInput.pressEscape()
    await setup!.renderOnce()
    const searchFrame = setup!.captureCharFrame()
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
    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("s")
    await setup!.mockInput.typeText("first")
    setup!.mockInput.pressEnter()
    await Bun.sleep(0)
    setup!.mockInput.pressKey("a")
    await Bun.sleep(0)
    await setup!.renderOnce()

    const frame = setup!.captureCharFrame()
    expect(frame).toContain("album unavailable")
    expect(frame).not.toContain("album-response-secret")
    setup!.mockInput.pressEscape()
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("First Track")
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
    app!.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("s")
    await setup!.mockInput.typeText("private")
    setup!.mockInput.pressEnter()
    await Bun.sleep(0)

    app!.setAppleAuthStatus({ state: "signedOut" })
    expect(signal?.aborted).toBe(true)
    pending.resolve({ items: [testTracks[0]!], nextCursor: null })
    await Bun.sleep(0)
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).not.toContain("First Track")
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
    app!.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("s")
    await setup!.mockInput.typeText("first")
    setup!.mockInput.pressEnter()
    await Bun.sleep(0)
    setup!.mockInput.pressKey("a")
    await Bun.sleep(0)

    app!.setAppleAuthStatus({ state: "signedOut" })
    expect(albumSignal?.aborted).toBe(true)
    pendingAlbum.resolve(testAlbum)
    await Bun.sleep(0)
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).not.toContain("The Album")
  })

  test("shows a sanitized catalog search error", async () => {
    await createApp({
      tracks: [],
      searchSongs: async () => {
        throw new Error("developer-token-secret")
      },
    })

    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("s")
    await setup!.mockInput.typeText("failed query")
    setup!.mockInput.pressEnter()
    await Bun.sleep(0)
    await setup!.renderOnce()
    const frame = setup!.captureCharFrame()
    expect(frame).toContain("Apple Music search is unavailable")
    expect(frame).not.toContain("developer-token-secret")
  })

  test("cancels a local filter and restores the original selection", async () => {
    await createApp({ kittyKeyboard: true })

    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("l")
    setup!.mockInput.pressKey("j")
    setup!.mockInput.pressKey("/")
    await setup!.mockInput.typeText("third")
    setup!.mockInput.pressEscape()

    expect(app!.getState()).toMatchObject({
      destination: "library",
      mode: { type: "normal" },
      lists: {
        library: { selectedTrackId: "track-b", filter: "" },
      },
      playback: { currentTrackId: null },
    })
  })

  test("opens an honest empty queue before playback is connected", async () => {
    await createApp()

    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("q")
    await setup!.renderOnce()

    expect(app!.getState().destination).toBe("queue")
    expect(setup!.captureCharFrame()).toContain("Queue")
    expect(setup!.captureCharFrame()).toContain("queue is empty")
    expect(setup!.captureCharFrame()).not.toContain("up next")
  })

  test("shows contextual help without letting q quit through the overlay", async () => {
    let quitCount = 0
    await createApp({}, () => quitCount++)

    setup!.mockInput.pressKey("?")
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("keyboard help")
    expect(setup!.captureCharFrame()).toContain("g h home")
    expect(setup!.captureCharFrame()).toContain("g l library")
    expect(setup!.captureCharFrame()).toContain("b/s/n")
    expect(setup!.captureCharFrame()).toContain("r repeat")
    expect(setup!.captureCharFrame()).toContain("i           item info")
    expect(setup!.captureCharFrame()).toContain("v visualizer")
    expect(setup!.captureCharFrame()).toContain("V settings")
    expect(setup!.captureCharFrame()).toContain("shift+←/→  seek 15s")

    setup!.mockInput.pressKey("q")
    expect(app!.getState().mode.type).toBe("help")
    expect(quitCount).toBe(0)

    setup!.mockInput.pressKey("?")
    setup!.mockInput.pressKey("q")
    expect(quitCount).toBe(1)
  })

  test("adapts the same workspace across wide and narrow terminals", async () => {
    await createApp()
    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("l")
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("First Album")

    setup!.resize(60, 22)
    await setup!.renderOnce()
    const frame = setup!.captureCharFrame()

    expect(frame).toContain("First Track — Artist One")
    expect(frame).not.toContain("First Album")
    expect(frame).not.toContain("apple music")
    expect(frame).not.toContain("playlists")
  })

  test("keeps track rows visible at the visualizer layout threshold", async () => {
    await createApp({ width: 100, height: 18 })
    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("l")
    await setup!.renderOnce()

    expect(setup!.captureCharFrame()).toContain("First Track")
  })

  test("reclaims the visualizer rows for workspace content when disabled", async () => {
    const tracks = Array.from({ length: 30 }, (_, index): Track => ({
      id: `track-${index + 1}`,
      title: `Track ${String(index + 1).padStart(2, "0")}`,
      artist: "Artist",
      album: "Album",
      durationSeconds: 180,
    }))
    await createApp({ width: 100, height: 32, tracks })
    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("l")
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).not.toContain("Track 16")

    setup!.mockInput.pressKey("v")
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("Track 16")
  })

  test("keeps palette selection visible in a short terminal", async () => {
    let quitCount = 0
    await createApp({ width: 60, height: 12 }, () => quitCount++)

    setup!.mockInput.pressKey("p", { ctrl: true })
    for (let index = 0; index < 9; index++) setup!.mockInput.pressArrow("down")
    await setup!.renderOnce()
    const frame = setup!.captureCharFrame()

    expect(frame).toContain("Quit Nutka")
    expect(frame).not.toContain("Go to Library")
    setup!.mockInput.pressEnter()
    expect(quitCount).toBe(1)
  })

  test("preserves content and controls in a very short terminal", async () => {
    await createApp({ width: 60, height: 10 })
    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("l")
    await setup!.renderOnce()
    const frame = setup!.captureCharFrame()

    expect(frame).toContain("First Track — Artist One")
    expect(frame).toContain("nothing playing")
    expect(frame).toContain("NORMAL")
  })

  test("cancels a pending destination chord without running its suffix", async () => {
    let quitCount = 0
    await createApp({ kittyKeyboard: true }, () => quitCount++)

    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressKey("q")
    setup!.mockInput.pressKey("g")
    setup!.mockInput.pressEscape()

    expect(app!.getState().destination).toBe("queue")
    expect(app!.getState().mode).toEqual({ type: "normal", pendingKey: null })
    expect(quitCount).toBe(0)

    setup!.mockInput.pressKey("q", { ctrl: true })
    setup!.mockInput.pressKey("q", { shift: true })
    expect(quitCount).toBe(0)
  })

  test("does not expose a playback command before playback is connected", async () => {
    await createApp()
    setup!.mockInput.pressKey("p", { ctrl: true })
    await setup!.mockInput.typeText("pause")
    await setup!.renderOnce()

    expect(setup!.captureCharFrame()).toContain("no matching commands")
    expect(app!.getState().playback.status).toBe("idle")
  })

  test("signs in through a safe browser overlay and exposes sign out afterward", async () => {
    let signIns = 0
    let signOuts = 0
    let cancellations = 0
    await createApp(
      { kittyKeyboard: true },
      () => {},
      {
        onSignIn: () => signIns++,
        onSignOut: () => signOuts++,
        onCancel: () => cancellations++,
      },
    )

    setup!.mockInput.pressKey("p", { ctrl: true })
    await setup!.mockInput.typeText("sign in")
    setup!.mockInput.pressEnter()
    expect(signIns).toBe(1)

    app!.setAppleAuthStatus({
      state: "authorizing",
      expiresAt: "2030-01-01T00:00:00.000Z",
    })
    await setup!.renderOnce()
    const authFrame = setup!.captureCharFrame()
    expect(authFrame).toContain("apple music login")
    expect(authFrame).toContain("No pairing code is required.")
    expect(authFrame).toContain("Waiting for Apple Music")

    app!.setAppleAuthStatus({ state: "validating" })
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("Checking it with Apple Music")

    app!.setAppleAuthStatus({ state: "saving" })
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("Saving it to the system keyring")

    setup!.mockInput.pressEscape()
    expect(cancellations).toBe(1)

    app!.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("apple music connected")
    expect(setup!.captureCharFrame()).toContain("stored in the system keyring")
    setup!.mockInput.pressEnter()
    setup!.mockInput.pressKey("p", { ctrl: true })
    await setup!.mockInput.typeText("sign out")
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("Sign out of Apple Music")
    setup!.mockInput.pressEnter()
    expect(signOuts).toBe(1)
  })

  test("keeps compact authorization actionable and cancellable while connecting", async () => {
    let cancellations = 0
    await createApp(
      { width: 40, height: 10, kittyKeyboard: true },
      () => {},
      { onSignIn: () => {}, onCancel: () => cancellations++ },
    )

    app!.setAppleAuthStatus({ state: "connecting" })
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("esc cancel")
    setup!.mockInput.pressEscape()
    expect(cancellations).toBe(1)

    app!.setAppleAuthStatus({
      state: "authorizing",
      expiresAt: "2030-01-01T00:00:00.000Z",
    })
    await setup!.renderOnce()
    const frame = setup!.captureCharFrame()
    expect(frame).toContain("No pairing code")
    expect(frame).toContain("Waiting for Apple")
  })

  test("offers keyring restore and credential cleanup retries", async () => {
    let restores = 0
    let signOuts = 0
    await createApp(
      { width: 60, height: 20 },
      () => {},
      {
        onSignIn: () => {},
        onSignOut: () => signOuts++,
        onRestore: () => restores++,
      },
    )

    app!.setAppleAuthStatus({ state: "error", code: "credential_load_failed" })
    setup!.mockInput.pressKey("p", { ctrl: true })
    await setup!.mockInput.typeText("keyring")
    setup!.mockInput.pressEnter()
    expect(restores).toBe(1)

    app!.setAppleAuthStatus({ state: "error", code: "credential_save_failed" })
    setup!.mockInput.pressKey("p", { ctrl: true })
    await setup!.mockInput.typeText("incomplete")
    setup!.mockInput.pressEnter()
    expect(signOuts).toBe(1)

    app!.setAppleAuthStatus({ state: "error", code: "credential_delete_failed" })
    await setup!.renderOnce()
    expect(setup!.captureCharFrame()).toContain("apple × sign-out")
  })
})
