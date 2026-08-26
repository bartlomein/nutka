import { afterEach, describe, expect, test } from "bun:test"

import { requestDeveloperToken } from "./token-service"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("token service client", () => {
  test("requests and validates a developer token", async () => {
    let requestedUrl = ""
    globalThis.fetch = (async (input: string | URL | Request) => {
      requestedUrl = String(input)
      return Response.json({
        token: "mock-token",
        expiresAt: "2030-01-01T00:00:00.000Z",
        mode: "mock",
      })
    }) as unknown as typeof fetch

    const result = await requestDeveloperToken("http://127.0.0.1:8787")

    expect(requestedUrl).toBe(
      "http://127.0.0.1:8787/v1/apple/developer-token",
    )
    expect(result.mode).toBe("mock")
  })

  test("rejects malformed responses", async () => {
    globalThis.fetch = (async () =>
      Response.json({ token: "missing-fields" })) as unknown as typeof fetch

    expect(
      requestDeveloperToken("http://127.0.0.1:8787"),
    ).rejects.toThrow("invalid response")
  })
})
