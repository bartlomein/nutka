import { expect, test } from "bun:test"
import { AppleCatalogProvider } from "./apple-catalog"
import { decodeLibrarySong } from "./apple-library-decoders"

const serviceUrl = "http://127.0.0.1:8787"
const song = (id = "i.saved", catalogId: string | null = "123") => ({
  id, type: "library-songs",
  attributes: {
    name: "Saved Song", artistName: "An Artist", albumName: "An Album", durationInMillis: 123456,
    ...(catalogId ? { playParams: { id, kind: "song", isLibrary: true, catalogId } } : {}),
  },
})

test("library requests use both tokens, keep library IDs, and paginate each exact collection", async () => {
  const requests: URL[] = []
  const provider = new AppleCatalogProvider(serviceUrl, "us", {
    useMusicUserToken: async (use) => use("user-secret"),
    fetch: async (input, init) => {
      const url = new URL(String(input))
      if (url.origin === serviceUrl) return Response.json({
        token: "developer-secret", expiresAt: "2030-01-01T00:00:00.000Z", mode: "apple",
      })
      requests.push(url)
      const headers = new Headers(init?.headers)
      expect(headers.get("Authorization")).toBe("Bearer developer-secret")
      expect(headers.get("Music-User-Token")).toBe("user-secret")
      const data = url.pathname.endsWith("/artists")
        ? [{ id: "r.artist", type: "library-artists", attributes: { name: "An Artist" } }]
        : url.pathname.endsWith("/albums")
          ? [{ id: "l.album", type: "library-albums", attributes: { name: "An Album", artistName: "An Artist" } }]
          : [song(), song("i.upload", null)]
      return Response.json({ data, ...(url.searchParams.has("offset") ? {} : {
        next: `${url.pathname}?offset=25`,
      }) })
    },
  })
  const loaders = [
    () => provider.getLibrarySongs(),
    () => provider.getLibraryAlbums(),
    () => provider.getLibraryArtists(),
    () => provider.getLibraryAlbumTracks("l.album"),
    () => provider.getLibraryArtistAlbums("r.artist"),
  ]
  for (const load of loaders) expect((await load()).items.length).toBeGreaterThan(0)
  expect(requests.map((url) => url.pathname)).toEqual([
    "/v1/me/library/songs", "/v1/me/library/albums", "/v1/me/library/artists",
    "/v1/me/library/albums/l.album/tracks", "/v1/me/library/artists/r.artist/albums",
  ])
  const page = await provider.getLibrarySongs({ cursor: "/v1/me/library/songs?offset=25" })
  expect(page.nextCursor).toBeNull()
  expect(page.items.map((item) => item.resourceId)).toEqual(["i.saved", "i.upload"])
  expect(page.items[0]!.playback?.apple.resourceId).toBe("123")
  expect(page.items[0]!.id).toBe("apple:library-song:i.saved")
  expect(page.items[1]!.playback).toBeUndefined()
  expect(requests.at(-1)!.searchParams.get("offset")).toBe("25")
})

test("rejects invalid IDs and cross-collection or foreign cursors before any network request", async () => {
  const provider = new AppleCatalogProvider(serviceUrl, "us", {
    fetch: async () => { throw new Error("Must not fetch") },
  })
  for (const cursor of ["https://evil.example/v1/me/library/songs", "/v1/me/library/albums?offset=25"]) {
    await expect(provider.getLibrarySongs({ cursor })).rejects.toMatchObject({ code: "invalid_request" })
  }
  await expect(provider.getLibraryAlbumTracks("../songs")).rejects.toMatchObject({ code: "invalid_request" })
  await expect(provider.getLibraryArtistAlbums("bad/id")).rejects.toMatchObject({ code: "invalid_request" })
})

test("requires authorization and rejects malformed library resources and response cursors", async () => {
  let value: unknown = { data: [{ ...song(), id: "../bad" }] }
  const fetcher = async (input: Parameters<typeof fetch>[0]) => String(input).startsWith(serviceUrl)
    ? Response.json({ token: "dev", expiresAt: "2030-01-01T00:00:00.000Z", mode: "apple" })
    : Response.json(value)
  const unauthorized = new AppleCatalogProvider(serviceUrl, "us", { fetch: fetcher })
  await expect(unauthorized.getLibrarySongs()).rejects.toMatchObject({ code: "unavailable" })
  const provider = new AppleCatalogProvider(serviceUrl, "us", {
    fetch: fetcher, useMusicUserToken: async (use) => use("user"),
  })
  await expect(provider.getLibrarySongs()).rejects.toMatchObject({ code: "invalid_response" })
  value = { data: [song()], next: "/v1/me/library/artists?offset=1" }
  await expect(provider.getLibrarySongs()).rejects.toMatchObject({ code: "invalid_response" })
  value = { data: [] }
  expect(await provider.getLibrarySongs()).toEqual({ items: [], nextCursor: null })
})

test("uploaded or unmatched songs remain visible without inventing a playback ID", () => {
  expect(decodeLibrarySong(song("i.upload", null))).toMatchObject({
    title: "Saved Song", resourceId: "i.upload", durationSeconds: 123.456,
  })
  expect(decodeLibrarySong(song("i.upload", null))?.playback).toBeUndefined()
  expect(decodeLibrarySong(song("i.bad", "../../123"))?.playback).toBeUndefined()
  expect(decodeLibrarySong({ ...song(), attributes: { ...song().attributes, durationInMillis: -1 } })).toBeNull()
})

test("saved albums containing music videos still load songs and retain their next page", async () => {
  const path = "/v1/me/library/albums/l.album/tracks"
  const provider = new AppleCatalogProvider(serviceUrl, "us", {
    useMusicUserToken: async (use) => use("user"),
    fetch: async (input) => String(input).startsWith(serviceUrl)
      ? Response.json({ token: "dev", expiresAt: "2030-01-01T00:00:00.000Z", mode: "apple" })
      : Response.json({ data: [{ type: "library-music-videos", id: "i.video" }, song()], next: `${path}?offset=25` }),
  })
  const page = await provider.getLibraryAlbumTracks("l.album")
  expect(page.items.map((item) => item.resourceId)).toEqual(["i.saved"])
  expect(page.nextCursor).toBe(`${path}?offset=25`)
})
