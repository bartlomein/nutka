import { describe, expect, test } from "bun:test"

import {
  AppleCatalogError,
  AppleCatalogProvider,
} from "./apple-catalog"
import type { Fetch } from "./token-service"

const serviceUrl = "http://127.0.0.1:8787"
const tokenResponse = {
  token: "developer-secret",
  expiresAt: "2030-01-01T00:00:00.000Z",
  mode: "apple",
} as const

function catalogResponse(next?: string): Response {
  return Response.json({
    results: {
      songs: {
        data: [
          {
            id: "12345",
            type: "songs",
            href: "/v1/catalog/us/songs/12345",
            attributes: {
              name: "A Song",
              artistName: "An Artist",
              albumName: "An Album",
              durationInMillis: 123456,
              releaseDate: "2026-02-13",
              genreNames: ["Alternative", "Music"],
              trackNumber: 3,
              discNumber: 1,
              composerName: "A Composer",
              contentRating: "explicit",
              hasLyrics: true,
              isAppleDigitalMaster: false,
              editorialNotes: { short: "A concise editorial note." },
              audioTraits: ["lossy-stereo", "lossless", "spatial", "future-trait"],
              artwork: { url: "https://img/{w}x{h}.jpg", width: 3000, height: 3000 },
              playParams: { id: "12345", kind: "song", ignored: true },
              ignored: true,
            },
          },
        ],
        ...(next === undefined ? {} : { next }),
      },
    },
  })
}

function songWithAlbumResponse(): Response {
  return Response.json({
    data: [{
      id: "12345",
      type: "songs",
      relationships: {
        albums: { data: [{ id: "album-1", type: "albums" }] },
      },
    }],
  })
}

function albumResponse(trackNext?: string, includeMusicVideo = false): Response {
  return Response.json({
    data: [{
      id: "album-1",
      type: "albums",
      attributes: {
        name: "An Album",
        artistName: "An Artist",
        releaseDate: "2026-02-13",
        genreNames: ["Alternative"],
        trackCount: 1,
        recordLabel: "Example Records",
        copyright: "2026 Example Records",
        contentRating: "clean",
        editorialNotes: { standard: "An album editorial note." },
        isCompilation: false,
        isSingle: true,
        artwork: { url: "https://album/{w}x{h}.jpg", width: 1200, height: 1200 },
      },
      relationships: {
        tracks: {
          data: [
            ...(includeMusicVideo
              ? [{ id: "video-1", type: "music-videos", attributes: { name: "A Video" } }]
              : []),
            {
              id: "12345",
              type: "songs",
              attributes: {
                name: "A Song",
                artistName: "An Artist",
                albumName: "An Album",
                durationInMillis: 123456,
                audioTraits: ["lossless", "hi-res-lossless"],
                playParams: { id: "12345", kind: "song" },
              },
            },
          ],
          ...(trackNext ? { next: trackNext } : {}),
        },
      },
    }],
  })
}

function albumSummaryResource(id = "album-1", name = "An Album") {
  return {
    id,
    type: "albums",
    attributes: {
      name,
      artistName: "An Artist",
      releaseDate: "2026-02-13",
      genreNames: ["Alternative"],
      trackCount: 10,
      isSingle: false,
    },
  }
}

function artistResource(id: string, name: string) {
  return {
    id,
    type: "artists",
    attributes: {
      name,
      genreNames: ["Jazz"],
      editorialNotes: { short: `${name} editorial note.` },
      artwork: { url: `https://artist/${id}/{w}x{h}.jpg`, width: 1000, height: 1000 },
    },
  }
}

function songResource(id = "12345", name = "A Song") {
  return {
    id,
    type: "songs",
    attributes: {
      name,
      artistName: "An Artist",
      albumName: "An Album",
      durationInMillis: 123456,
      playParams: { id, kind: "song" },
    },
  }
}

function recommendationsResponse(next?: string): Response {
  return Response.json({
    data: [{
      id: "recommendation-1",
      type: "personal-recommendation",
      attributes: { title: { stringForDisplay: "Made for You" } },
      relationships: {
        contents: {
          data: [{
            id: "pl.mix-1",
            type: "playlists",
            attributes: {
              name: "Favorites Mix",
              curatorName: "Apple Music for Me",
              description: { standard: "Songs selected for you." },
              lastModifiedDate: "2026-08-25T12:00:00Z",
              playlistType: "personal-mix",
              isChart: false,
            },
          }],
        },
      },
    }],
    ...(next ? { next } : {}),
  })
}

function playlistResource(id: string, name: string) {
  return {
    id,
    type: "playlists",
    attributes: { name, curatorName: "Apple Music" },
  }
}

function recommendationResource(id: string, title: string, contents: unknown[]) {
  return {
    id,
    type: "personal-recommendation",
    attributes: { title: { stringForDisplay: title } },
    relationships: { contents: { data: contents } },
  }
}

function libraryPlaylistsResponse(next?: string): Response {
  return Response.json({
    data: [{
      id: "p.saved-1",
      type: "library-playlists",
      attributes: {
        name: "Favorites Mix",
        description: { standard: "Saved personalized mix." },
        dateAdded: "2026-08-20T09:30:00Z",
        canEdit: true,
        isPublic: false,
        hasCatalog: true,
        playParams: {
          id: "p.saved-1",
          kind: "playlist",
          isLibrary: true,
          globalId: "pl.mix-1",
        },
      },
    }],
    ...(next ? { next } : {}),
  })
}

function catalogPlaylistTracksResponse(): Response {
  return Response.json({
    data: [{
      id: "12345",
      type: "songs",
      attributes: {
        name: "A Song",
        artistName: "An Artist",
        albumName: "An Album",
        durationInMillis: 123456,
        playParams: { id: "12345", kind: "song" },
      },
    }],
  })
}

function libraryPlaylistTracksResponse(): Response {
  return Response.json({
    data: [{
      id: "i.library-1",
      type: "library-songs",
      attributes: {
        name: "A Saved Song",
        artistName: "An Artist",
        albumName: "A Saved Album",
        durationInMillis: 180000,
        playParams: {
          id: "i.library-1",
          kind: "song",
          isLibrary: true,
          catalogId: "67890",
        },
      },
    }],
  })
}

function withCatalog(response: Response, requests: Array<{ url: string; init?: RequestInit }> = []): Fetch {
  return async (input, init) => {
    const url = String(input)
    requests.push({ url, init })
    return url.endsWith("/v1/apple/developer-token")
      ? Response.json(tokenResponse)
      : response
  }
}

describe("AppleCatalogProvider", () => {
  test("submits an encoded song search and decodes catalog metadata", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const provider = new AppleCatalogProvider(serviceUrl, "us", {
      fetch: withCatalog(catalogResponse(), requests),
      limit: 100,
    })

    const page = await provider.searchSongs("  AC/DC & friends  ")

    expect(requests[1]?.url).toBe(
      "https://api.music.apple.com/v1/catalog/us/search?term=AC%2FDC+%26+friends&types=songs&limit=25",
    )
    const init = requests[1]?.init
    expect(init?.method).toBe("GET")
    expect(init?.redirect).toBe("manual")
    expect(new Headers(init?.headers).get("accept")).toBe("application/json")
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer developer-secret")
    expect(page).toEqual({
      items: [{
        id: "apple:song:12345",
        title: "A Song",
        artist: "An Artist",
        album: "An Album",
        durationSeconds: 123.456,
        audioQuality: { format: "lossless", source: "catalog" },
        apple: {
          resourceId: "12345",
          resourceType: "songs",
          artwork: { url: "https://img/{w}x{h}.jpg", width: 3000, height: 3000 },
          playParams: { id: "12345", kind: "song" },
          audioTraits: ["lossy-stereo", "lossless", "spatial"],
          details: {
            releaseDate: "2026-02-13",
            genreNames: ["Alternative", "Music"],
            trackNumber: 3,
            discNumber: 1,
            composerName: "A Composer",
            contentRating: "explicit",
            editorialNotes: "A concise editorial note.",
            hasLyrics: true,
            isAppleDigitalMaster: false,
          },
        },
      }],
      nextCursor: null,
    })
    expect(requests.map(({ url }) => url).join(" ")).not.toContain("secret")
  })

  test("uses Apple's next URL as an opaque pagination cursor", async () => {
    const next = "/v1/catalog/us/search?types=songs&term=test&offset=25"
    const requests: Array<{ url: string; init?: RequestInit }> = []
    let catalogCalls = 0
    const fetchImpl: Fetch = async (input, init) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.endsWith("/developer-token")) return Response.json(tokenResponse)
      catalogCalls++
      return catalogCalls === 1 ? catalogResponse(next) : catalogResponse()
    }
    const provider = new AppleCatalogProvider(serviceUrl, "us", { fetch: fetchImpl })

    const first = await provider.searchSongs("test")
    await provider.searchSongs("test", { cursor: first.nextCursor! })

    expect(first.nextCursor).toBe(next)
    expect(requests[3]?.url).toBe(`https://api.music.apple.com${next}`)
  })

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

  test("loads personalized and saved playlists with correctly scoped user tokens", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const next = "/v1/me/library/playlists?offset=25"
    const fetchImpl: Fetch = async (input, init) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.endsWith("/developer-token")) return Response.json(tokenResponse)
      return url.includes("/recommendations")
        ? recommendationsResponse()
        : libraryPlaylistsResponse(next)
    }
    const provider = new AppleCatalogProvider(serviceUrl, "us", {
      fetch: fetchImpl,
      useMusicUserToken: async (use) => use("user-secret"),
    })

    const recommended = await provider.getRecommendedPlaylists()
    const library = await provider.getLibraryPlaylists()

    expect(requests[1]?.url).toBe(
      "https://api.music.apple.com/v1/me/recommendations?limit=25",
    )
    expect(new Headers(requests[1]?.init?.headers).get("music-user-token")).toBe(
      "user-secret",
    )
    expect(recommended).toEqual({
      items: [{
        id: "apple:playlist:pl.mix-1",
        title: "Favorites Mix",
        curator: "Apple Music for Me",
        description: "Songs selected for you.",
        apple: {
          resourceId: "pl.mix-1",
          resourceType: "playlists",
          details: {
            lastModifiedDate: "2026-08-25T12:00:00Z",
            playlistType: "personal-mix",
            isChart: false,
          },
        },
      }],
      nextCursor: null,
    })
    expect(library).toEqual({
      items: [{
        id: "apple:library-playlist:p.saved-1",
        title: "Favorites Mix",
        curator: "Your Library",
        description: "Saved personalized mix.",
        apple: {
          resourceId: "p.saved-1",
          resourceType: "library-playlists",
          globalId: "pl.mix-1",
          details: {
            dateAdded: "2026-08-20T09:30:00Z",
            canEdit: true,
            isPublic: false,
            hasCatalog: true,
          },
        },
      }],
      nextCursor: next,
    })
    expect(requests.map(({ url }) => url).join(" ")).not.toContain("user-secret")
  })

  test("preserves Apple home section titles and order while omitting unsupported empty groups", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const response = Response.json({
      data: [
        recommendationResource("recommendation-first", "Made for You", [
          playlistResource("pl.first", "First Mix"),
          { id: "album-1", type: "albums", attributes: { name: "An Album" } },
        ]),
        recommendationResource("recommendation-albums", "Albums for You", [
          { id: "album-2", type: "albums", attributes: { name: "Another Album" } },
        ]),
        recommendationResource("recommendation-empty", "Nothing Here", []),
        recommendationResource("recommendation-last", "Because You Listened", [
          playlistResource("pl.last", "Last Mix"),
        ]),
      ],
    })
    const provider = new AppleCatalogProvider(serviceUrl, "us", {
      fetch: withCatalog(response, requests),
      useMusicUserToken: async (use) => use("user-secret"),
    })

    const page = await provider.getHomeSections()

    expect(requests[1]?.url).toBe(
      "https://api.music.apple.com/v1/me/recommendations?limit=25",
    )
    const headers = new Headers(requests[1]?.init?.headers)
    expect(headers.get("authorization")).toBe("Bearer developer-secret")
    expect(headers.get("music-user-token")).toBe("user-secret")
    expect(page).toEqual({
      items: [
        {
          id: "recommendation-first",
          title: "Made for You",
          items: [{
            id: "apple:playlist:pl.first",
            title: "First Mix",
            curator: "Apple Music",
            apple: { resourceId: "pl.first", resourceType: "playlists" },
          }],
        },
        {
          id: "recommendation-last",
          title: "Because You Listened",
          items: [{
            id: "apple:playlist:pl.last",
            title: "Last Mix",
            curator: "Apple Music",
            apple: { resourceId: "pl.last", resourceType: "playlists" },
          }],
        },
      ],
      nextCursor: null,
    })
  })

  test("deduplicates home playlists globally and keeps the flattened compatibility result", async () => {
    const payload = {
      data: [
        recommendationResource("recommendation-first", "First", [
          playlistResource("pl.shared", "Shared Mix"),
          playlistResource("pl.first", "First Mix"),
        ]),
        recommendationResource("recommendation-second", "Second", [
          playlistResource("pl.shared", "Duplicate Shared Mix"),
          playlistResource("pl.second", "Second Mix"),
          playlistResource("pl.second", "Duplicate Second Mix"),
        ]),
        recommendationResource("recommendation-duplicates", "Duplicates", [
          playlistResource("pl.first", "Duplicate First Mix"),
        ]),
      ],
    }
    const fetchImpl: Fetch = async (input) => String(input).endsWith("/developer-token")
      ? Response.json(tokenResponse)
      : Response.json(payload)
    const provider = new AppleCatalogProvider(serviceUrl, "us", {
      fetch: fetchImpl,
      useMusicUserToken: async (use) => use("user-secret"),
    })

    const sections = await provider.getHomeSections()
    const flattened = await provider.getRecommendedPlaylists()

    expect(sections.items.map((section) => ({
      id: section.id,
      title: section.title,
      playlistIds: section.items.map((playlist) => playlist.apple.resourceId),
    }))).toEqual([
      {
        id: "recommendation-first",
        title: "First",
        playlistIds: ["pl.shared", "pl.first"],
      },
      {
        id: "recommendation-second",
        title: "Second",
        playlistIds: ["pl.second"],
      },
    ])
    expect(flattened.items.map((playlist) => playlist.apple.resourceId)).toEqual([
      "pl.shared",
      "pl.first",
      "pl.second",
    ])
    expect(flattened.nextCursor).toBe(sections.nextCursor)
  })

  test("uses recommendation cursors unchanged for home section pagination", async () => {
    const next = "/v1/me/recommendations?offset=25"
    const requests: Array<{ url: string; init?: RequestInit }> = []
    let recommendationCalls = 0
    const fetchImpl: Fetch = async (input, init) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.endsWith("/developer-token")) return Response.json(tokenResponse)
      recommendationCalls++
      return recommendationsResponse(recommendationCalls === 1 ? next : undefined)
    }
    const provider = new AppleCatalogProvider(serviceUrl, "us", {
      fetch: fetchImpl,
      useMusicUserToken: async (use) => use("user-secret"),
    })

    const first = await provider.getHomeSections()
    const second = await provider.getHomeSections({ cursor: first.nextCursor! })

    expect(first.nextCursor).toBe(next)
    expect(second.nextCursor).toBeNull()
    expect(requests[3]?.url).toBe(`https://api.music.apple.com${next}`)
    expect(new Headers(requests[3]?.init?.headers).get("music-user-token")).toBe(
      "user-secret",
    )
  })

  test("loads catalog and library playlist tracks without broadening playback IDs", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl: Fetch = async (input, init) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.endsWith("/developer-token")) return Response.json(tokenResponse)
      return url.includes("/v1/me/")
        ? libraryPlaylistTracksResponse()
        : catalogPlaylistTracksResponse()
    }
    const provider = new AppleCatalogProvider(serviceUrl, "us", {
      fetch: fetchImpl,
      useMusicUserToken: async (use) => use("user-secret"),
    })
    const catalog = {
      id: "apple:playlist:pl.mix-1",
      title: "Mix",
      curator: "Apple Music",
      apple: { resourceId: "pl.mix-1", resourceType: "playlists" as const },
    }
    const library = {
      id: "apple:library-playlist:p.saved-1",
      title: "Saved",
      curator: "Your Library",
      apple: { resourceId: "p.saved-1", resourceType: "library-playlists" as const },
    }

    const catalogTracks = await provider.getPlaylistTracks(catalog)
    const libraryTracks = await provider.getPlaylistTracks(library)

    expect(requests[1]?.url).toBe(
      "https://api.music.apple.com/v1/catalog/us/playlists/pl.mix-1/tracks?limit=25",
    )
    expect(new Headers(requests[1]?.init?.headers).has("music-user-token")).toBe(false)
    expect(requests[3]?.url).toBe(
      "https://api.music.apple.com/v1/me/library/playlists/p.saved-1/tracks?limit=25",
    )
    expect(new Headers(requests[3]?.init?.headers).get("music-user-token")).toBe(
      "user-secret",
    )
    expect(catalogTracks.items[0]?.id).toBe("apple:song:12345")
    expect(libraryTracks.items[0]).toMatchObject({
      id: "apple:song:67890",
      title: "A Saved Song",
      apple: {
        resourceId: "67890",
        resourceType: "songs",
        playParams: { id: "67890", kind: "song" },
      },
    })
  })

  test("rejects cross-endpoint personalized pagination cursors", async () => {
    const provider = new AppleCatalogProvider(serviceUrl, "us", {
      fetch: withCatalog(recommendationsResponse()),
      useMusicUserToken: async (use) => use("user-secret"),
    })
    await expect(provider.getLibraryPlaylists({
      cursor: "/v1/me/recommendations?offset=25",
    })).rejects.toMatchObject({ code: "invalid_request" })
    await expect(provider.getHomeSections({
      cursor: "/v1/me/library/playlists?offset=25",
    })).rejects.toMatchObject({ code: "invalid_request" })
    await expect(provider.getRecommendedPlaylists({
      cursor: "https://evil.test/v1/me/recommendations?offset=25",
    })).rejects.toMatchObject({ code: "invalid_request" })

    const unsafeNext = new AppleCatalogProvider(serviceUrl, "us", {
      fetch: withCatalog(recommendationsResponse(
        "https://evil.test/v1/me/recommendations?offset=25",
      )),
      useMusicUserToken: async (use) => use("user-secret"),
    })
    await expect(unsafeNext.getHomeSections()).rejects.toMatchObject({
      code: "invalid_response",
    })
  })

  test("rejects malformed home recommendation groups and playlist resources", async () => {
    const malformed = [
      { data: [{ id: "recommended-1", type: "personal-recommendation" }] },
      {
        data: [{
          ...recommendationResource("recommended-1", "For You", []),
          relationships: { contents: { data: "wrong" } },
        }],
      },
      {
        data: [recommendationResource("recommended-1", "For You", [{
          id: "pl.malformed",
          type: "playlists",
          attributes: { curatorName: "Apple Music" },
        }])],
      },
    ]

    for (const payload of malformed) {
      const provider = new AppleCatalogProvider(serviceUrl, "us", {
        fetch: withCatalog(Response.json(payload)),
        useMusicUserToken: async (use) => use("user-secret"),
      })
      await expect(provider.getHomeSections()).rejects.toMatchObject({
        code: "invalid_response",
      })
    }
  })

  test("rejects mock developer-token mode without calling Apple", async () => {
    let appleCalls = 0
    const fetchImpl: Fetch = async (input) => {
      if (String(input).endsWith("/developer-token")) {
        return Response.json({ ...tokenResponse, mode: "mock" })
      }
      appleCalls++
      return catalogResponse()
    }
    const provider = new AppleCatalogProvider(serviceUrl, "us", { fetch: fetchImpl })

    await expect(provider.searchSongs("test")).rejects.toMatchObject({ code: "unavailable" })
    expect(appleCalls).toBe(0)
  })

  test("strictly validates storefronts, queries, and cursor scope", async () => {
    expect(() => new AppleCatalogProvider(serviceUrl, "US")).toThrow(AppleCatalogError)
    expect(() => new AppleCatalogProvider(serviceUrl, "usa")).toThrow(AppleCatalogError)
    const provider = new AppleCatalogProvider(serviceUrl, "us", {
      fetch: withCatalog(catalogResponse()),
    })
    await expect(provider.searchSongs("   ")).rejects.toMatchObject({ code: "invalid_request" })
    await expect(provider.searchSongs("bad\u0000query")).rejects.toMatchObject({ code: "invalid_request" })
    await expect(provider.searchSongs("test", {
      cursor: "https://example.com/v1/catalog/us/search?offset=25",
    })).rejects.toMatchObject({ code: "invalid_request" })
    await expect(provider.searchSongs("test", {
      cursor: "https://api.music.apple.com/v1/catalog/gb/search?offset=25",
    })).rejects.toMatchObject({ code: "invalid_request" })
  })

  test("rejects malformed, non-JSON, invalid UTF-8, and oversized responses", async () => {
    const responses = [
      Response.json({ results: { songs: { data: "wrong" } } }),
      Response.json({
        results: {
          songs: {
            data: [{ id: "broken", type: "songs", attributes: { name: "Incomplete" } }],
          },
        },
      }),
      new Response("{}", { headers: { "content-type": "text/plain" } }),
      new Response(new Uint8Array([0xc3, 0x28]), {
        headers: { "content-type": "application/json" },
      }),
      new Response("{}", {
        headers: { "content-type": "application/json", "content-length": "524289" },
      }),
    ]
    for (const response of responses) {
      const provider = new AppleCatalogProvider(serviceUrl, "us", {
        fetch: withCatalog(response),
      })
      await expect(provider.searchSongs("test")).rejects.toMatchObject({ code: "invalid_response" })
    }
  })

  test("rejects an unsafe next cursor as an invalid response", async () => {
    const provider = new AppleCatalogProvider(serviceUrl, "us", {
      fetch: withCatalog(catalogResponse("https://evil.test/v1/catalog/us/search?offset=25")),
    })
    await expect(provider.searchSongs("test")).rejects.toMatchObject({ code: "invalid_response" })
  })

  test("propagates cancellation and enforces a hard catalog timeout", async () => {
    let catalogSignal: AbortSignal | undefined
    const stalled: Fetch = async (input, init) => {
      if (String(input).endsWith("/developer-token")) return Response.json(tokenResponse)
      catalogSignal = init?.signal ?? undefined
      return new Promise<Response>(() => {})
    }
    const timed = new AppleCatalogProvider(serviceUrl, "us", { fetch: stalled, timeoutMs: 5 })
    await expect(timed.searchSongs("test")).rejects.toMatchObject({ code: "timeout" })
    expect(catalogSignal?.aborted).toBe(true)

    const controller = new AbortController()
    const aborted = new AppleCatalogProvider(serviceUrl, "us", { fetch: stalled, timeoutMs: 1000 })
    const pending = aborted.searchSongs("test", { signal: controller.signal })
    await Promise.resolve()
    await Promise.resolve()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: "aborted" })
  })

  test("sanitizes fetch, response, and token failures", async () => {
    const secrets = ["developer-secret", "response-secret", "transport-secret"]
    const fetchImpl: Fetch = async (input) => {
      if (String(input).endsWith("/developer-token")) return Response.json(tokenResponse)
      throw new Error("transport-secret developer-secret response-secret")
    }
    const provider = new AppleCatalogProvider(serviceUrl, "us", { fetch: fetchImpl })
    try {
      await provider.searchSongs("test")
      throw new Error("expected rejection")
    } catch (error) {
      expect(error).toBeInstanceOf(AppleCatalogError)
      for (const secret of secrets) expect(String(error)).not.toContain(secret)
    }
  })
})
