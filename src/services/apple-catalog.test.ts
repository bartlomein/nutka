import { describe, expect, test } from "bun:test"

import { AppleCatalogError, AppleCatalogProvider } from "./apple-catalog"
import type { Fetch } from "./token-service"
import {
  serviceUrl,
  tokenResponse,
  catalogResponse,
  withCatalog,
} from "./test-support/catalog-fixtures"

describe("AppleCatalogProvider: search and request validation", () => {
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

  test("logs sanitized catalog request failures", async () => {
    const entries: Array<{ event: string; code?: string }> = []
    const provider = new AppleCatalogProvider(serviceUrl, "us", {
      fetch: async (input) => String(input).startsWith(serviceUrl)
        ? Response.json(tokenResponse)
        : new Response("private upstream response", { status: 503 }),
      logger: {
        log(event, details) {
          entries.push({ event, ...(details?.code ? { code: details.code } : {}) })
        },
      },
    })

    await expect(provider.searchSongs("query")).rejects.toBeInstanceOf(AppleCatalogError)
    expect(entries).toEqual([{ event: "catalog_request_failed", code: "unavailable" }])
    expect(JSON.stringify(entries)).not.toContain("private upstream response")
  })
})
