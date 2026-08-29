import { expect, test } from "bun:test"

import type {
  AppleArtistSectionName,
  AppleCatalogAlbum,
  AppleCatalogArtist,
  AppleCatalogTrack,
  AppleSongContext,
} from "../../core/types"
import { CatalogBrowseController } from "./catalog-browse-controller"

test("search album drill-down restores selection and releases its tracks", async () => {
  const albumRequest = deferred<AppleCatalogAlbum>()
  const selected: Array<string | null> = []
  const restored: Array<{ id: string | null; filter: string }> = []
  const albumSources: string[][] = []
  const controller = new CatalogBrowseController({
    getAlbumForSong: async () => albumRequest.promise,
  }, host({
    getSearchState: () => ({
      destination: "search",
      selectedTrackId: "apple:song:song-1",
      filter: "needle",
      visibleTracks: [song("song-1")],
    }),
    selectSearchTrack: (id: string | null) => selected.push(id),
    restoreSearch: (id: string | null, filter: string) => restored.push({ id, filter }),
    replaceAlbumTracks: (tracks: readonly AppleCatalogTrack[]) => {
      albumSources.push(tracks.map((track) => track.id))
    },
  }))

  const opening = controller.openSelectedAlbum()
  expect(controller.albumView?.status).toBe("loading")
  albumRequest.resolve(album("album-1", [song("song-2")]))
  await opening

  expect(controller.albumView?.status).toBe("ready")
  expect(selected).toEqual(["apple:song:song-2"])
  expect(albumSources).toEqual([["apple:song:song-2"]])

  controller.leaveAlbumView()
  expect(controller.albumView).toBeUndefined()
  expect(albumSources).toEqual([["apple:song:song-2"], []])
  expect(restored).toEqual([{ id: "apple:song:song-1", filter: "needle" }])
})

test("reset aborts context loading and ignores its delayed result", async () => {
  const contextRequest = deferred<AppleSongContext>()
  let signal: AbortSignal | undefined
  const controller = new CatalogBrowseController({
    getSongContext: async (_id, options) => {
      signal = options?.signal
      return contextRequest.promise
    },
    getAlbum: async () => album("album-1", []),
  }, host({ getCurrentTrack: () => song("song-1") }))

  const opening = controller.openNowPlayingContext()
  expect(controller.contextPicker?.status).toBe("loading")
  controller.reset()
  expect(signal?.aborted).toBe(true)

  contextRequest.resolve({ albums: [album("album-1", [])], artists: [] })
  await opening
  expect(controller.contextPicker).toBeUndefined()
})

test("popping an artist page aborts every section request", async () => {
  const artist = artistResource("artist-1")
  const sectionRequests: Array<{
    section: AppleArtistSectionName
    signal: AbortSignal | undefined
    request: ReturnType<typeof deferred<{
      section: AppleArtistSectionName
      items: []
      nextCursor: null
    }>>
  }> = []
  const controller = new CatalogBrowseController({
    getSongContext: async () => ({ albums: [], artists: [artist] }),
    getArtistSection: async (_id, section, options) => {
      const request = deferred<{
        section: AppleArtistSectionName
        items: []
        nextCursor: null
      }>()
      sectionRequests.push({ section, signal: options?.signal, request })
      return request.promise
    },
  }, host({ getCurrentTrack: () => song("song-1") }))

  await controller.openNowPlayingContext()
  await controller.chooseContextTarget()
  expect(controller.currentPage()?.kind).toBe("artist")
  expect(sectionRequests).toHaveLength(5)

  expect(controller.popBrowsePage()).toBe(true)
  expect(sectionRequests.every(({ signal }) => signal?.aborted)).toBe(true)
  for (const { section, request } of sectionRequests) {
    request.resolve({ section, items: [], nextCursor: null })
  }
})

function host(overrides: Record<string, unknown> = {}) {
  return {
    getCurrentTrack: () => undefined,
    getSearchState: () => ({
      destination: "home",
      selectedTrackId: null,
      filter: "",
      visibleTracks: [],
    }),
    prepareSearchAlbum() {},
    selectSearchTrack() {},
    restoreSearch() {},
    replaceBrowseTracks() {},
    replaceAlbumTracks() {},
    closeMode() {},
    render() {},
    ...overrides,
  } as ConstructorParameters<typeof CatalogBrowseController>[1]
}

function song(id: string): AppleCatalogTrack {
  return {
    id: `apple:song:${id}`,
    title: id,
    artist: "Artist",
    album: "Album",
    durationSeconds: 1,
    apple: { resourceId: id, resourceType: "songs" },
  }
}

function album(id: string, tracks: readonly AppleCatalogTrack[]): AppleCatalogAlbum {
  return {
    id: `apple:album:${id}`,
    title: id,
    artist: "Artist",
    tracks,
    apple: { resourceId: id, resourceType: "albums" },
  }
}

function artistResource(id: string): AppleCatalogArtist {
  return {
    id: `apple:artist:${id}`,
    name: id,
    apple: { resourceId: id, resourceType: "artists" },
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
} {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>((done) => resolve = done), resolve }
}
