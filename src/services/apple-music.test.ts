import { describe, expect, test } from "bun:test"

import {
  AppleMusicValidationError,
  validateAppleMusicUserToken,
} from "./apple-music"
import type { Fetch } from "./token-service"

const serviceUrl = "http://127.0.0.1:8787"

describe("Apple Music token validation", () => {
  test("gets a fresh developer token and sends both tokens only in headers", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl: Fetch = async (input, init) => {
      requests.push({ url: String(input), init })
      if (String(input).endsWith("/v1/apple/developer-token")) {
        return Response.json({
          token: "developer-secret",
          expiresAt: "2030-01-01T00:00:00.000Z",
          mode: "apple",
        })
      }
      return Response.json({ data: [{ id: "us", type: "storefronts" }] })
    }

    await expect(
      validateAppleMusicUserToken(serviceUrl, "user-secret", { fetch: fetchImpl }),
    ).resolves.toEqual({ storefront: "us" })
    expect(requests.map(({ url }) => url)).toEqual([
      `${serviceUrl}/v1/apple/developer-token`,
      "https://api.music.apple.com/v1/me/storefront",
    ])
    expect(requests[1]?.init?.redirect).toBe("manual")
    expect(new Headers(requests[1]?.init?.headers).get("authorization")).toBe(
      "Bearer developer-secret",
    )
    expect(new Headers(requests[1]?.init?.headers).get("music-user-token")).toBe(
      "user-secret",
    )
    expect(requests.map(({ url }) => url).join(" ")).not.toContain("secret")
  })

  test("distinguishes definitive unauthorized from sanitized unavailable failures", async () => {
    const withAppleResponse = (response: Response): Fetch => async (input) =>
      String(input).endsWith("/developer-token")
        ? Response.json({
            token: "developer-secret",
            expiresAt: "2030-01-01T00:00:00.000Z",
            mode: "apple",
          })
        : response

    const unauthorized = validateAppleMusicUserToken(serviceUrl, "user-secret", {
      fetch: withAppleResponse(new Response("user-secret", { status: 401 })),
    })
    await expect(unauthorized).rejects.toMatchObject({ code: "unauthorized" })

    const unavailable = validateAppleMusicUserToken(serviceUrl, "user-secret", {
      fetch: withAppleResponse(
        Response.json({ data: [{ id: "unexpected", type: "storefronts" }] }),
      ),
    })
    await expect(unavailable).rejects.toMatchObject({ code: "unavailable" })
    try {
      await unavailable
    } catch (error) {
      expect(error).toBeInstanceOf(AppleMusicValidationError)
      expect(String(error)).not.toContain("user-secret")
      expect(String(error)).not.toContain("developer-secret")
    }
  })

  test("rejects oversized responses without parsing them", async () => {
    const fetchImpl: Fetch = async (input) =>
      String(input).endsWith("/developer-token")
        ? Response.json({
            token: "developer",
            expiresAt: "2030-01-01T00:00:00.000Z",
            mode: "apple",
          })
        : new Response("x", { headers: { "content-length": "32769" } })

    await expect(
      validateAppleMusicUserToken(serviceUrl, "user", { fetch: fetchImpl }),
    ).rejects.toMatchObject({ code: "unavailable" })
  })

  test("requires real Apple developer-token mode without testing the stored token", async () => {
    let appleRequests = 0
    const fetchImpl: Fetch = async (input) => {
      if (String(input).endsWith("/developer-token")) {
        return Response.json({
          token: "mock-developer",
          expiresAt: "2030-01-01T00:00:00.000Z",
          mode: "mock",
        })
      }
      appleRequests++
      return Response.json({ data: [{ id: "us", type: "storefronts" }] })
    }

    await expect(
      validateAppleMusicUserToken(serviceUrl, "stored-secret", { fetch: fetchImpl }),
    ).rejects.toMatchObject({ code: "unavailable" })
    expect(appleRequests).toBe(0)
  })

  test("rejects non-JSON and malformed UTF-8 Apple responses", async () => {
    const withAppleResponse = (response: Response): Fetch => async (input) =>
      String(input).endsWith("/developer-token")
        ? Response.json({
            token: "developer",
            expiresAt: "2030-01-01T00:00:00.000Z",
            mode: "apple",
          })
        : response

    await expect(
      validateAppleMusicUserToken(serviceUrl, "user", {
        fetch: withAppleResponse(
          new Response('{"data":[]}', {
            headers: { "content-type": "text/plain" },
          }),
        ),
      }),
    ).rejects.toMatchObject({ code: "unavailable" })
    await expect(
      validateAppleMusicUserToken(serviceUrl, "user", {
        fetch: withAppleResponse(
          new Response(new Uint8Array([0xc3, 0x28]), {
            headers: { "content-type": "application/json" },
          }),
        ),
      }),
    ).rejects.toMatchObject({ code: "unavailable" })
  })
})
