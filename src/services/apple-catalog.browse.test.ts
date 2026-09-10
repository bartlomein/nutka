import { describe, expect, test } from "bun:test"

import { AppleCatalogProvider } from "./apple-catalog"
import type { Fetch } from "./token-service"
import {
  serviceUrl,
  tokenResponse,
  songWithAlbumResponse,
  albumResponse,
  albumSummaryResource,
  artistResource,
  songResource,
} from "./test-support/catalog-fixtures"

describe("AppleCatalogProvider: browse", () => {
  test("resolves a song's album relationship and decodes its tracks", async () => {
    const requests: string[] = []
    const fetchImpl: Fetch = async (input) => {
      const url = String(input)
      requests.push(url)
      if (url.endsWith("/developer-token")) return Response.json(tokenResponse)
      return url.includes("/songs/") ? songWithAlbumResponse() : albumResponse()
    }
    const provider = new AppleCatalogProvider(serviceUrl, "us", { fetch: fetchImpl })

    const album = await provider.getAlbumForSong("12345")

    expect(requests).toEqual([
      `${serviceUrl}/v1/apple/developer-token`,
      "https://api.music.apple.com/v1/catalog/us/songs/12345?include=albums",
      "https://api.music.apple.com/v1/catalog/us/albums/album-1?include=tracks",
    ])
    expect(album).toEqual({
      id: "apple:album:album-1",
      title: "An Album",
      artist: "An Artist",
      tracks: [{
        id: "apple:song:12345",
        title: "A Song",
        artist: "An Artist",
        album: "An Album",
        durationSeconds: 123.456,
        audioQuality: { format: "hi-res-lossless", source: "catalog" },
        apple: {
          resourceId: "12345",
          resourceType: "songs",
          playParams: { id: "12345", kind: "song" },
          audioTraits: ["lossless", "hi-res-lossless"],
        },
      }],
      apple: {
        resourceId: "album-1",
        resourceType: "albums",
        artwork: { url: "https://album/{w}x{h}.jpg", width: 1200, height: 1200 },
        details: {
          releaseDate: "2026-02-13",
          genreNames: ["Alternative"],
          trackCount: 1,
          recordLabel: "Example Records",
          copyright: "2026 Example Records",
          contentRating: "clean",
          editorialNotes: "An album editorial note.",
          isCompilation: false,
          isSingle: true,
        },
      },
    })
  })

  test("resolves every album and artist for a catalog song", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const nextArtists = "/v1/catalog/us/songs/12345/artists?offset=10"
    const fetchImpl: Fetch = async (input, init) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.endsWith("/developer-token")) return Response.json(tokenResponse)
      if (url.includes("/albums")) {
        return Response.json({ data: [albumSummaryResource()] })
      }
      return url.includes("offset=10")
        ? Response.json({ data: [artistResource("artist-2", "Second Artist")] })
        : Response.json({
            data: [artistResource("artist-1", "First Artist")],
            next: nextArtists,
          })
    }
    const provider = new AppleCatalogProvider(serviceUrl, "us", { fetch: fetchImpl })

    const context = await provider.getSongContext("12345")

    expect(context.albums).toEqual([{
      id: "apple:album:album-1",
      title: "An Album",
      artist: "An Artist",
      apple: {
        resourceId: "album-1",
        resourceType: "albums",
        details: {
          releaseDate: "2026-02-13",
          genreNames: ["Alternative"],
          trackCount: 10,
          isSingle: false,
        },
      },
    }])
    expect(context.artists.map((artist) => artist.name)).toEqual([
      "First Artist",
      "Second Artist",
    ])
    expect(context.artists[0]).toMatchObject({
      id: "apple:artist:artist-1",
      apple: {
        resourceId: "artist-1",
        resourceType: "artists",
        details: {
          genreNames: ["Jazz"],
          editorialNotes: "First Artist editorial note.",
        },
      },
    })
    expect(requests.map(({ url }) => url)).toContain(
      "https://api.music.apple.com/v1/catalog/us/songs/12345/albums?limit=10",
    )
    expect(requests.map(({ url }) => url)).toContain(
      `https://api.music.apple.com${nextArtists}`,
    )
    for (const request of requests.slice(1)) {
      expect(new Headers(request.init?.headers).has("music-user-token")).toBe(false)
    }
  })

  test("aborts the sibling song-context relationship when one fails", async () => {
    let artistSignal: AbortSignal | undefined
    const fetchImpl: Fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith("/developer-token")) return Response.json(tokenResponse)
      if (url.includes("/albums")) return Response.json({ data: "wrong" })
      artistSignal = init?.signal ?? undefined
      return new Promise<Response>(() => {})
    }
    const provider = new AppleCatalogProvider(serviceUrl, "us", { fetch: fetchImpl })

    await expect(provider.getSongContext("12345")).rejects.toMatchObject({
      code: "invalid_response",
    })
    expect(artistSignal?.aborted).toBe(true)
  })

  test("loads catalog albums, artist profiles, and typed artist sections", async () => {
    const requests: string[] = []
    const fetchImpl: Fetch = async (input) => {
      const url = String(input)
      requests.push(url)
      if (url.endsWith("/developer-token")) return Response.json(tokenResponse)
      if (url.includes("/albums/album-1")) return albumResponse()
      if (url.endsWith("/artists/artist-1")) {
        return Response.json({ data: [artistResource("artist-1", "First Artist")] })
      }
      if (url.includes("/view/top-songs")) {
        return Response.json({ data: [songResource()] })
      }
      if (url.includes("/view/similar-artists")) {
        return Response.json({ data: [artistResource("artist-2", "Second Artist")] })
      }
      return Response.json({ data: [albumSummaryResource()] })
    }
    const provider = new AppleCatalogProvider(serviceUrl, "us", { fetch: fetchImpl })

    const album = await provider.getAlbum("album-1")
    const artist = await provider.getArtist("artist-1")
    const sections = await Promise.all([
      provider.getArtistSection("artist-1", "top-songs"),
      provider.getArtistSection("artist-1", "latest-release"),
      provider.getArtistSection("artist-1", "full-albums"),
      provider.getArtistSection("artist-1", "singles"),
      provider.getArtistSection("artist-1", "similar-artists"),
    ])

    expect(album.id).toBe("apple:album:album-1")
    expect(artist.name).toBe("First Artist")
    expect(sections.map((section) => section.section)).toEqual([
      "top-songs",
      "latest-release",
      "full-albums",
      "singles",
      "similar-artists",
    ])
    expect(sections.map((section) => section.items[0]?.id)).toEqual([
      "apple:song:12345",
      "apple:album:album-1",
      "apple:album:album-1",
      "apple:album:album-1",
      "apple:artist:artist-2",
    ])
    expect(requests).toContain(
      "https://api.music.apple.com/v1/catalog/us/albums/album-1?include=tracks",
    )
    expect(requests).toContain(
      "https://api.music.apple.com/v1/catalog/us/artists/artist-1/view/full-albums?limit=25",
    )
  })

  test("skips album music videos and follows paginated album tracks", async () => {
    const next = "/v1/catalog/us/albums/album-1/tracks?offset=1"
    const requests: string[] = []
    const fetchImpl: Fetch = async (input) => {
      const url = String(input)
      requests.push(url)
      if (url.endsWith("/developer-token")) return Response.json(tokenResponse)
      if (url.includes("/tracks?offset=1")) {
        return Response.json({
          data: [
            { id: "video-2", type: "music-videos", attributes: { name: "Video" } },
            songResource("67890", "Second Song"),
          ],
        })
      }
      return albumResponse(next, true)
    }
    const provider = new AppleCatalogProvider(serviceUrl, "us", { fetch: fetchImpl })

    const album = await provider.getAlbum("album-1")

    expect(album.tracks.map((track) => track.id)).toEqual([
      "apple:song:12345",
      "apple:song:67890",
    ])
    expect(requests).toContain(`https://api.music.apple.com${next}`)
  })

  test("scopes artist section cursors to one artist and view", async () => {
    const next = "/v1/catalog/us/artists/artist-1/view/full-albums?offset=25"
    const requests: string[] = []
    const fetchImpl: Fetch = async (input) => {
      const url = String(input)
      requests.push(url)
      if (url.endsWith("/developer-token")) return Response.json(tokenResponse)
      return Response.json({
        data: [albumSummaryResource()],
        ...(url.includes("offset=25") ? {} : { next }),
      })
    }
    const provider = new AppleCatalogProvider(serviceUrl, "us", { fetch: fetchImpl })

    const first = await provider.getArtistSection("artist-1", "full-albums")
    const second = await provider.getArtistSection("artist-1", "full-albums", {
      cursor: first.nextCursor!,
    })

    expect(first.nextCursor).toBe(next)
    expect(second.nextCursor).toBeNull()
    expect(requests).toContain(`https://api.music.apple.com${next}`)
    await expect(provider.getArtistSection("artist-1", "full-albums", {
      cursor: "/v1/catalog/us/artists/artist-2/view/full-albums?offset=25",
    })).rejects.toMatchObject({ code: "invalid_request" })
    await expect(provider.getArtistSection("artist-1", "full-albums", {
      cursor: "/v1/catalog/us/artists/artist-1/view/singles?offset=25",
    })).rejects.toMatchObject({ code: "invalid_request" })
    await expect(provider.getArtistSection(
      "artist-1",
      "featured-albums" as "full-albums",
    )).rejects.toMatchObject({ code: "invalid_request" })
  })
})
