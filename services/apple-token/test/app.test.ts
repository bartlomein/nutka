import { beforeAll, describe, expect, test, vi } from "vitest"

import { createApp } from "../src/app"
import type { Bindings } from "../src/bindings"

let privateKeyPem: string

beforeAll(async () => {
  const keys = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair
  const privateKey = (await crypto.subtle.exportKey(
    "pkcs8",
    keys.privateKey,
  )) as ArrayBuffer
  privateKeyPem = toPem(privateKey)
})

describe("hosted signer HTTP API", () => {
  test("exposes health without touching signing bindings", async () => {
    const limit = vi.fn(async () => ({ success: true }))
    const response = await request("/healthz", { RATE_LIMITER: { limit } })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "ok" })
    expect(limit).not.toHaveBeenCalled()
    expectHardened(response)
  })

  test("preserves the developer-token response and rate-limits by Cloudflare IP", async () => {
    const limit = vi.fn(async () => ({ success: true }))
    const response = await request(
      "/v1/apple/developer-token",
      signingBindings({ limit }),
      { headers: { "cf-connecting-ip": "203.0.113.4" } },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      token: expect.stringMatching(/^[^.]+\.[^.]+\.[^.]+$/),
      expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      mode: "apple",
    })
    expect(limit).toHaveBeenCalledWith({ key: "203.0.113.4" })
    expectHardened(response)
    expect(response.headers.has("access-control-allow-origin")).toBe(false)
  })

  test("fails closed when signing is disabled", async () => {
    const limit = vi.fn(async () => ({ success: true }))
    const response = await request("/v1/apple/developer-token", {
      ...signingBindings({ limit }),
      SIGNING_ENABLED: "false",
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "Token signing is disabled" })
    expect(limit).not.toHaveBeenCalled()
  })

  test("returns 429 without signing when the binding rejects the request", async () => {
    const response = await request(
      "/v1/apple/developer-token",
      signingBindings({ limit: async () => ({ success: false }) }),
    )

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("60")
    expect(await response.json()).toEqual({ error: "Rate limit exceeded" })
  })

  test("fails closed when the rate-limit binding fails", async () => {
    const response = await request(
      "/v1/apple/developer-token",
      signingBindings({ limit: async () => Promise.reject(new Error("unavailable")) }),
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "Token service is unavailable" })
  })

  test.each(["/healthz?verbose=true", "/v1/apple/developer-token?ttl=3600"])(
    "rejects query strings on %s",
    async (path) => {
      const response = await request(path, {
        RATE_LIMITER: { limit: async () => ({ success: true }) },
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: "Query strings are not allowed" })
    },
  )

  test.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])(
    "rejects the %s method without CORS headers",
    async (method) => {
      const response = await request("/healthz", {
        RATE_LIMITER: { limit: async () => ({ success: true }) },
      }, { method })
      expect(response.status).toBe(405)
      expect(response.headers.get("allow")).toBe("GET")
      expect(response.headers.has("access-control-allow-origin")).toBe(false)
      expectHardened(response)
    },
  )

  test.each([
    "/health",
    "/healthz/",
    "/authorize",
    "/playback",
    "/v1/apple/auth/sessions",
    "/v1/apple/developer-token/",
    "/unknown",
  ])("returns 404 for obsolete or unknown route %s", async (path) => {
    const response = await request(path, {
      RATE_LIMITER: { limit: async () => ({ success: true }) },
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Not found" })
    expectHardened(response)
  })
})

async function request(
  path: string,
  bindings: Bindings,
  init?: RequestInit,
): Promise<Response> {
  return await createApp().request(`https://signer.example${path}`, init, bindings)
}

function signingBindings(rateLimit: Bindings["RATE_LIMITER"]): Bindings {
  return {
    APPLE_TEAM_ID: "TEAM123",
    APPLE_KEY_ID: "KEY123",
    APPLE_PRIVATE_KEY: privateKeyPem,
    APPLE_TOKEN_TTL_SECONDS: "900",
    SIGNING_ENABLED: "true",
    RATE_LIMITER: rateLimit,
  }
}

function expectHardened(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(response.headers.get("content-security-policy")).toContain(
    "default-src 'none'",
  )
  expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin")
  expect(response.headers.get("referrer-policy")).toBe("no-referrer")
  expect(response.headers.get("strict-transport-security")).toContain(
    "max-age=31536000",
  )
  expect(response.headers.get("x-content-type-options")).toBe("nosniff")
  expect(response.headers.get("x-frame-options")).toBe("DENY")
}

function toPem(key: ArrayBuffer): string {
  let binary = ""
  for (const byte of new Uint8Array(key)) binary += String.fromCharCode(byte)
  const body = btoa(binary).match(/.{1,64}/g)!.join("\n")
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`
}
