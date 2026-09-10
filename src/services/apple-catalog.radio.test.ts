import { describe, expect, test } from "bun:test"

import { AppleCatalogProvider } from "./apple-catalog"
import type { Fetch } from "./token-service"
import {
  serviceUrl,
  tokenResponse,
  stationResource,
  stationGenreResource,
  withCatalog,
} from "./test-support/catalog-fixtures"

describe("AppleCatalogProvider: radio", () => {
  test("loads live Apple Music radio stations without pagination or a user token", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const provider = new AppleCatalogProvider(serviceUrl, "us", {
      fetch: withCatalog(Response.json({ data: [stationResource()] }), requests),
    })

    const page = await provider.getLiveRadioStations()

    expect(requests[1]?.url).toBe(
      "https://api.music.apple.com/v1/catalog/us/stations?filter%5Bfeatured%5D=apple-music-live-radio",
    )
    expect(new Headers(requests[1]?.init?.headers).has("music-user-token")).toBe(false)
    expect(page).toEqual({
      items: [{
        id: "apple:station:ra.1",
        title: "Apple Music 1",
        subtitle: "Apple Music",
        description: "The global music station.",
        isLive: true,
        apple: {
          resourceId: "ra.1",
          resourceType: "stations",
          playParams: { id: "ra.1", kind: "radioStation" },
          artwork: { url: "https://radio/{w}x{h}.jpg", width: 1200, height: 1200 },
        },
      }],
      nextCursor: null,
    })
  })

  test("searches stations and scopes shared search cursors to the station type", async () => {
    const next = "/v1/catalog/us/search?term=radio&types=stations&offset=25"
    const requests: string[] = []
    const fetchImpl: Fetch = async (input) => {
      const url = String(input)
      requests.push(url)
      if (url.endsWith("/developer-token")) return Response.json(tokenResponse)
      return Response.json({
        results: {
          stations: {
            data: [stationResource()],
            ...(url.includes("offset=25") ? {} : { next }),
          },
        },
      })
    }
    const provider = new AppleCatalogProvider(serviceUrl, "us", { fetch: fetchImpl })

    const first = await provider.searchStations(" radio ")
    const second = await provider.searchStations("radio", { cursor: first.nextCursor! })

    expect(requests[1]).toBe(
      "https://api.music.apple.com/v1/catalog/us/search?term=radio&types=stations&limit=25",
    )
    expect(requests[3]).toBe(`https://api.music.apple.com${next}`)
    expect(first.items[0]?.id).toBe("apple:station:ra.1")
    expect(second.nextCursor).toBeNull()
    await expect(provider.searchStations("radio", {
      cursor: "/v1/catalog/us/search?term=radio&types=songs&offset=25",
    })).rejects.toMatchObject({ code: "invalid_request" })
    await expect(provider.searchSongs("radio", {
      cursor: "/v1/catalog/us/search?term=radio&types=stations&offset=25",
    })).rejects.toMatchObject({ code: "invalid_request" })
    await expect(provider.searchStations("news", {
      cursor: "/v1/catalog/us/search?term=radio&types=stations&offset=25",
    })).rejects.toMatchObject({ code: "invalid_request" })
  })

  test("gets unique station IDs in requested order while permitting missing resources", async () => {
    const requests: string[] = []
    const provider = new AppleCatalogProvider(serviceUrl, "us", {
      fetch: async (input) => {
        const url = String(input)
        requests.push(url)
        return url.endsWith("/developer-token")
          ? Response.json(tokenResponse)
          : Response.json({
              data: [
                stationResource("ra.third", "Third"),
                stationResource("ra.first", "First"),
              ],
            })
      },
    })

    const stations = await provider.getStationsByIds([
      "ra.first",
      "ra.missing",
      "ra.third",
    ])

    expect(requests[1]).toBe(
      "https://api.music.apple.com/v1/catalog/us/stations?ids=ra.first%2Cra.missing%2Cra.third",
    )
    expect(stations.map((station) => station.apple.resourceId)).toEqual([
      "ra.first",
      "ra.third",
    ])
    await expect(provider.getStationsByIds([])).rejects.toMatchObject({
      code: "invalid_request",
    })
    await expect(provider.getStationsByIds(["ra.first", "ra.first"])).rejects.toMatchObject({
      code: "invalid_request",
    })
    await expect(provider.getStationsByIds(
      Array.from({ length: 26 }, (_, index) => `ra.${index}`),
    )).rejects.toMatchObject({ code: "invalid_request" })
  })

  test("loads station genres and follows genre station pagination", async () => {
    const next = "/v1/catalog/us/station-genres/alternative/stations?offset=25"
    const requests: string[] = []
    const fetchImpl: Fetch = async (input) => {
      const url = String(input)
      requests.push(url)
      if (url.endsWith("/developer-token")) return Response.json(tokenResponse)
      if (url.endsWith("/station-genres")) {
        return Response.json({ data: [stationGenreResource()] })
      }
      return Response.json({
        data: [stationResource()],
        ...(url.includes("offset=25") ? {} : { next }),
      })
    }
    const provider = new AppleCatalogProvider(serviceUrl, "us", { fetch: fetchImpl })

    const genres = await provider.getStationGenres()
    const first = await provider.getStationsForGenre("alternative")
    const second = await provider.getStationsForGenre("alternative", {
      cursor: first.nextCursor!,
    })

    expect(genres).toEqual([{
      id: "apple:station-genre:alternative",
      name: "Alternative",
      apple: { resourceId: "alternative", resourceType: "station-genres" },
    }])
    expect(requests[3]).toBe(
      "https://api.music.apple.com/v1/catalog/us/station-genres/alternative/stations?limit=25",
    )
    expect(requests[5]).toBe(`https://api.music.apple.com${next}`)
    expect(second.nextCursor).toBeNull()
    await expect(provider.getStationsForGenre("bad/id")).rejects.toMatchObject({
      code: "invalid_request",
    })
    await expect(provider.getStationsForGenre("alternative", {
      cursor: "/v1/catalog/us/station-genres/jazz/stations?offset=25",
    })).rejects.toMatchObject({ code: "invalid_request" })
  })

  test("loads the personal and recently played stations with scoped user tokens", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl: Fetch = async (input, init) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.endsWith("/developer-token")) return Response.json(tokenResponse)
      return Response.json({ data: [stationResource("ra.personal", "My Station", false)] })
    }
    const provider = new AppleCatalogProvider(serviceUrl, "us", {
      fetch: fetchImpl,
      useMusicUserToken: async (use) => use("user-secret"),
    })

    const personal = await provider.getPersonalStation()
    const recent = await provider.getRecentlyPlayedStations()

    expect(requests[1]?.url).toBe(
      "https://api.music.apple.com/v1/catalog/us/stations?filter%5Bidentity%5D=personal",
    )
    expect(requests[3]?.url).toBe(
      "https://api.music.apple.com/v1/me/recent/radio-stations?limit=25",
    )
    expect(personal.id).toBe("apple:station:ra.personal")
    expect(recent.items[0]?.isLive).toBe(false)
    for (const request of [requests[1], requests[3]]) {
      expect(new Headers(request?.init?.headers).get("music-user-token")).toBe("user-secret")
    }
  })

  test("follows recently played station cursors with the user token", async () => {
    const next = "/v1/me/recent/radio-stations?offset=25"
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl: Fetch = async (input, init) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.endsWith("/developer-token")) return Response.json(tokenResponse)
      return Response.json({ data: [stationResource()], ...(url.includes("offset=25") ? {} : { next }) })
    }
    const provider = new AppleCatalogProvider(serviceUrl, "us", {
      fetch: fetchImpl,
      useMusicUserToken: async (use) => use("user-secret"),
    })

    const first = await provider.getRecentlyPlayedStations()
    const second = await provider.getRecentlyPlayedStations({ cursor: first.nextCursor! })

    expect(first.nextCursor).toBe(next)
    expect(second.nextCursor).toBeNull()
    expect(requests[3]?.url).toBe(`https://api.music.apple.com${next}`)
    expect(new Headers(requests[3]?.init?.headers).get("music-user-token")).toBe("user-secret")
  })

  test("retrieves song and artist station relationships with developer credentials", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl: Fetch = async (input, init) => {
      const url = String(input)
      requests.push({ url, init })
      return url.endsWith("/developer-token")
        ? Response.json(tokenResponse)
        : Response.json({ data: [stationResource()] })
    }
    const provider = new AppleCatalogProvider(serviceUrl, "us", {
      fetch: fetchImpl,
    })

    await provider.getStationForResource("songs", "12345")
    await provider.getStationForResource("artists", "artist-1")

    expect(requests[1]?.url).toBe(
      "https://api.music.apple.com/v1/catalog/us/songs/12345/station",
    )
    expect(requests[3]?.url).toBe(
      "https://api.music.apple.com/v1/catalog/us/artists/artist-1/station",
    )
    expect(new Headers(requests[1]?.init?.headers).has("music-user-token")).toBe(false)
    await expect(provider.getStationForResource("albums" as "songs", "12345"))
      .rejects.toMatchObject({ code: "invalid_request" })
  })

  test("rejects malformed station resources and unsafe station cursors", async () => {
    const malformed = [
      { ...stationResource(), type: "radio-stations" },
      { ...stationResource(), attributes: { ...stationResource().attributes, isLive: "yes" } },
      {
        ...stationResource(),
        attributes: {
          ...stationResource().attributes,
          playParams: { id: "ra.other", kind: "radioStation" },
        },
      },
      { ...stationResource(), attributes: { ...stationResource().attributes, playParams: null } },
      { ...stationResource(), attributes: { ...stationResource().attributes, artwork: undefined } },
    ]
    for (const station of malformed) {
      const provider = new AppleCatalogProvider(serviceUrl, "us", {
        fetch: withCatalog(Response.json({ data: [station] })),
      })
      await expect(provider.getLiveRadioStations()).rejects.toMatchObject({
        code: "invalid_response",
      })
    }

    const stationWithoutOptionalAttributes = stationResource()
    const optionalProvider = new AppleCatalogProvider(serviceUrl, "us", {
      fetch: withCatalog(Response.json({
        data: [{
          ...stationWithoutOptionalAttributes,
          attributes: {
            ...stationWithoutOptionalAttributes.attributes,
            playParams: undefined,
          },
        }],
      })),
    })
    await expect(optionalProvider.getLiveRadioStations()).resolves.toMatchObject({
      items: [{ apple: { resourceId: "ra.1", resourceType: "stations" } }],
    })

    const externalProvider = new AppleCatalogProvider(serviceUrl, "us", {
      fetch: withCatalog(Response.json({
        data: [{
          ...stationResource("ra.npr", "NPR", true),
          attributes: {
            ...stationResource("ra.npr", "NPR", true).attributes,
            stationProviderName: undefined,
            playParams: {
              id: "ra.npr",
              kind: "radioStation",
              format: "stream",
              hasDrm: false,
            },
          },
        }],
      })),
    })
    await expect(externalProvider.getLiveRadioStations()).resolves.toMatchObject({
      items: [{ apple: { externalLiveStream: true } }],
    })

    const provider = new AppleCatalogProvider(serviceUrl, "us", {
      fetch: withCatalog(Response.json({
        data: [stationResource()],
        next: "https://evil.test/v1/catalog/us/stations?offset=25",
      })),
    })
    await expect(provider.getLiveRadioStations()).rejects.toMatchObject({
      code: "invalid_response",
    })
  })
})
