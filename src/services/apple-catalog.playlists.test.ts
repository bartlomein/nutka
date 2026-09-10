import { describe, expect, test } from "bun:test"

import { AppleCatalogProvider } from "./apple-catalog"
import type { Fetch } from "./token-service"
import {
  serviceUrl,
  tokenResponse,
  recommendationsResponse,
  playlistResource,
  recommendationResource,
  libraryPlaylistsResponse,
  catalogPlaylistTracksResponse,
  libraryPlaylistTracksResponse,
  stationResource,
  withCatalog,
} from "./test-support/catalog-fixtures"

describe("AppleCatalogProvider: playlists", () => {
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

  test("includes stations in home sections but keeps recommended playlists playlist-only", async () => {
    const payload = {
      data: [recommendationResource("recommendation-radio", "Radio for You", [
        stationResource("ra.home", "Home Radio", false),
        playlistResource("pl.home", "Home Mix"),
      ])],
    }
    const provider = new AppleCatalogProvider(serviceUrl, "us", {
      fetch: async (input) => String(input).endsWith("/developer-token")
        ? Response.json(tokenResponse)
        : Response.json(payload),
      useMusicUserToken: async (use) => use("user-secret"),
    })

    const sections = await provider.getHomeSections()
    const playlists = await provider.getRecommendedPlaylists()

    expect(sections.items[0]?.items.map((item) => item.apple.resourceType)).toEqual([
      "stations",
      "playlists",
    ])
    expect(sections.items[0]?.items[0]).toMatchObject({
      id: "apple:station:ra.home",
      title: "Home Radio",
      isLive: false,
      apple: { resourceId: "ra.home", resourceType: "stations" },
    })
    expect(playlists.items.map((playlist) => playlist.apple.resourceId)).toEqual(["pl.home"])
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
})
