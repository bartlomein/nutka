import { afterEach, describe, expect, test } from "bun:test"

import { requestDeveloperToken, type Fetch } from "./token-service"

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

  test("requires JSON content type and valid UTF-8", async () => {
    const wrongType: Fetch = async () =>
      new Response('{"token":"secret"}', {
        headers: { "content-type": "text/plain" },
      })
    await expect(
      requestDeveloperToken("http://127.0.0.1:8787", wrongType),
    ).rejects.toMatchObject({ code: "invalid_response" })

    const invalidUtf8: Fetch = async () =>
      new Response(new Uint8Array([0xc3, 0x28]), {
        headers: { "content-type": "application/json" },
      })
    await expect(
      requestDeveloperToken("http://127.0.0.1:8787", invalidUtf8),
    ).rejects.toMatchObject({ code: "invalid_response" })
  })

  test("aborts a stalled request at its hard timeout", async () => {
    let requestSignal: AbortSignal | null = null
    const stalled: Fetch = async (_input, init) => {
      requestSignal = init?.signal as AbortSignal
      return new Promise<Response>(() => {})
    }

    await expect(
      requestDeveloperToken("http://127.0.0.1:8787", stalled, {
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ code: "unavailable" })
    expect((requestSignal as AbortSignal | null)?.aborted).toBe(true)
  })
})
