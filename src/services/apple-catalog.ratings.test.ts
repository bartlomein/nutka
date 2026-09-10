import { describe, expect, test } from "bun:test"

import { AppleCatalogProvider } from "./apple-catalog"
import type { Fetch } from "./token-service"
import { serviceUrl, tokenResponse } from "./test-support/catalog-fixtures"

describe("AppleCatalogProvider: ratings", () => {
  test("reads, adds, and removes personal song ratings with scoped credentials", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl: Fetch = async (input, init) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.endsWith("/developer-token")) return Response.json(tokenResponse)
      if (init?.method === "GET") {
        return Response.json({
          data: [{ id: "12345", type: "ratings", attributes: { value: 1 } }],
        })
      }
      return new Response(null, { status: 204 })
    }
    const provider = new AppleCatalogProvider(serviceUrl, "us", {
      fetch: fetchImpl,
      useMusicUserToken: async (use) => use("user-secret"),
    })

    expect(await provider.getPersonalSongRating("12345")).toBe(1)
    await provider.setPersonalSongRating("12345", 1)
    await provider.deletePersonalSongRating("12345")

    const appleRequests = requests.filter(({ url }) => url.includes("api.music.apple.com"))
    expect(appleRequests.map(({ url }) => url)).toEqual([
      "https://api.music.apple.com/v1/me/ratings/songs/12345",
      "https://api.music.apple.com/v1/me/ratings/songs/12345",
      "https://api.music.apple.com/v1/me/ratings/songs/12345",
    ])
    expect(appleRequests.map(({ init }) => init?.method)).toEqual(["GET", "PUT", "DELETE"])
    for (const { init } of appleRequests) {
      const headers = new Headers(init?.headers)
      expect(headers.get("authorization")).toBe("Bearer developer-secret")
      expect(headers.get("music-user-token")).toBe("user-secret")
    }
    expect(new Headers(appleRequests[1]?.init?.headers).get("content-type")).toBe(
      "application/json",
    )
    expect(appleRequests[1]?.init?.body).toBe(
      JSON.stringify({ type: "rating", attributes: { value: 1 } }),
    )
    expect(requests.map(({ url }) => url).join(" ")).not.toContain("user-secret")
  })

  test("reads, sets, and deletes personal station ratings through the generic rating path", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl: Fetch = async (input, init) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.endsWith("/developer-token")) return Response.json(tokenResponse)
      return init?.method === "GET"
        ? Response.json({
            data: [{ id: "ra.1", type: "ratings", attributes: { value: -1 } }],
          })
        : new Response(null, { status: 204 })
    }
    const provider = new AppleCatalogProvider(serviceUrl, "us", {
      fetch: fetchImpl,
      useMusicUserToken: async (use) => use("user-secret"),
    })

    expect(await provider.getPersonalStationRating("ra.1")).toBe(-1)
    await provider.setPersonalStationRating("ra.1", 1)
    await provider.deletePersonalStationRating("ra.1")

    const appleRequests = requests.filter(({ url }) => url.includes("api.music.apple.com"))
    expect(appleRequests.map(({ url }) => url)).toEqual([
      "https://api.music.apple.com/v1/me/ratings/stations/ra.1",
      "https://api.music.apple.com/v1/me/ratings/stations/ra.1",
      "https://api.music.apple.com/v1/me/ratings/stations/ra.1",
    ])
    expect(appleRequests.map(({ init }) => init?.method)).toEqual(["GET", "PUT", "DELETE"])
    expect(appleRequests[1]?.init?.body).toBe(
      JSON.stringify({ type: "rating", attributes: { value: 1 } }),
    )
    await expect(provider.setPersonalStationRating("ra.1", 0 as 1)).rejects.toMatchObject({
      code: "invalid_request",
    })
  })

  test("treats a missing personal rating as unliked and rejects malformed ratings", async () => {
    let response = new Response(null, { status: 404 })
    const provider = new AppleCatalogProvider(serviceUrl, "us", {
      fetch: async (input) => String(input).endsWith("/developer-token")
        ? Response.json(tokenResponse)
        : response,
      useMusicUserToken: async (use) => use("user-secret"),
    })

    expect(await provider.getPersonalSongRating("12345")).toBeNull()
    response = Response.json({
      data: [{ id: "12345", type: "ratings", attributes: { value: 0 } }],
    })
    await expect(provider.getPersonalSongRating("12345")).rejects.toMatchObject({
      code: "invalid_response",
    })
    await expect(provider.setPersonalSongRating("bad/id", 1)).rejects.toMatchObject({
      code: "invalid_request",
    })
    await expect(provider.setPersonalSongRating("12345", 0 as 1)).rejects.toMatchObject({
      code: "invalid_request",
    })
  })
})
