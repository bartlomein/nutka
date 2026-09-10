import { describe, expect, test } from "bun:test"
import {
  acknowledgeAppleAuthorizationSession,
  cancelAppleAuthorizationSession,
  createAppleAuthorizationSession,
  getAppleAuthorizationSessionStatus,
} from "../apple-auth"
import type { Fetch } from "../token-service"
import { cliToken, expiresAt, serviceUrl } from "./test-helpers"

describe("Apple authorization clients", () => {
  test("use typed JSON POST bodies and never put CLI tokens in URLs", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl: Fetch = async (input, init) => {
      calls.push({ url: String(input), init })
      if (String(input).endsWith("/sessions")) {
        return Response.json({
          cliToken,
          authorizationUrl: `${serviceUrl}/authorize#browserToken=browser-secret`,
          expiresAt,
        })
      }
      if (String(input).endsWith("/status")) return Response.json({ status: "pending" })
      return new Response(null, { status: 204 })
    }

    await createAppleAuthorizationSession(serviceUrl, fetchImpl)
    await getAppleAuthorizationSessionStatus(serviceUrl, cliToken, fetchImpl)
    await acknowledgeAppleAuthorizationSession(serviceUrl, cliToken, fetchImpl)
    await cancelAppleAuthorizationSession(serviceUrl, cliToken, fetchImpl)

    expect(calls.every(({ init }) => init?.method === "POST")).toBe(true)
    expect(calls.every(({ init }) => init?.redirect === "manual")).toBe(true)
    expect(calls.every(({ init }) => init?.signal instanceof AbortSignal)).toBe(true)
    expect(calls.every(({ url }) => !url.includes(cliToken))).toBe(true)
    expect(calls.slice(1).map(({ init }) => JSON.parse(String(init?.body)))).toEqual([
      { cliToken },
      { cliToken },
      { cliToken },
    ])
  })

  test("requires JSON with valid UTF-8", async () => {
    await expect(
      createAppleAuthorizationSession(
        serviceUrl,
        async () =>
          new Response('{"cliToken":"secret"}', {
            headers: { "content-type": "text/plain" },
          }),
      ),
    ).rejects.toMatchObject({ code: "unavailable" })
    await expect(
      createAppleAuthorizationSession(
        serviceUrl,
        async () =>
          new Response(new Uint8Array([0xc3, 0x28]), {
            headers: { "content-type": "application/json" },
          }),
      ),
    ).rejects.toMatchObject({ code: "unavailable" })
  })

  test("hard-times out and aborts cancellation requests", async () => {
    let signal: AbortSignal | null | undefined
    const stalled: Fetch = async (_input, init) => {
      signal = init?.signal
      return new Promise<Response>(() => {})
    }
    await expect(
      cancelAppleAuthorizationSession(serviceUrl, cliToken, stalled, {
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ code: "unavailable" })
    expect(signal?.aborted).toBe(true)
  })

  test("rejects authorization URLs outside the broker's exact authorization page", async () => {
    const invalidUrls = [
      "https://other.example/authorize#browserToken=secret",
      `${serviceUrl}/different#browserToken=secret`,
      `${serviceUrl}/authorize?browserToken=secret`,
      `${serviceUrl}/authorize?extra=1#browserToken=secret`,
      `${serviceUrl}/authorize#browserToken=`,
      `${serviceUrl}/authorize#browserToken=one&browserToken=two`,
      `${serviceUrl}/authorize#browserToken=secret&extra=1`,
      "http://user:password@127.0.0.1:8787/authorize#browserToken=secret",
    ]

    for (const authorizationUrl of invalidUrls) {
      await expect(
        createAppleAuthorizationSession(serviceUrl, async () =>
          Response.json({ cliToken, authorizationUrl, expiresAt }),
        ),
      ).rejects.toMatchObject({ code: "unavailable" })
    }
  })

  test("rejects oversized responses based on headers and streamed bytes", async () => {
    await expect(
      getAppleAuthorizationSessionStatus(serviceUrl, cliToken, async () =>
        Response.json({ status: "pending" }, {
          headers: { "content-length": String(32 * 1024 + 1) },
        }),
      ),
    ).rejects.toMatchObject({ code: "unavailable" })

    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(32 * 1024 + 1))
      },
      cancel() {
        cancelled = true
      },
    })
    await expect(
      getAppleAuthorizationSessionStatus(serviceUrl, cliToken, async () =>
        new Response(body, { headers: { "content-type": "application/json" } }),
      ),
    ).rejects.toMatchObject({ code: "unavailable" })
    expect(cancelled).toBe(true)
  })

  test("maps HTTP failures to safe typed errors", async () => {
    const failures = [
      [401, "unauthorized"],
      [410, "expired"],
      [409, "conflict"],
      [302, "unavailable"],
      [500, "unavailable"],
    ] as const

    for (const [status, code] of failures) {
      await expect(
        getAppleAuthorizationSessionStatus(serviceUrl, cliToken, async () =>
          new Response("sensitive internal error", { status }),
        ),
      ).rejects.toMatchObject({
        code,
        message: "Apple authorization service is unavailable",
      })
    }
  })
})
