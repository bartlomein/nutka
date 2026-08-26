import { describe, expect, test } from "bun:test"

import type { TokenServiceConfig } from "./config"
import { FixedWindowRateLimiter } from "./rate-limit"
import { createRequestHandler } from "./server"

const config: TokenServiceConfig = {
  mode: "mock",
  host: "127.0.0.1",
  port: 8787,
  rateLimitPerMinute: 1,
  tokenTtlSeconds: 900,
  allowedOrigin: "https://nuta.example",
}

const issuer = {
  issue: async () => ({
    token: "mock-token",
    expiresAt: "2030-01-01T00:00:00.000Z",
    mode: "mock" as const,
  }),
}

describe("token service HTTP handler", () => {
  test("serves health without issuing a token", async () => {
    const handle = createRequestHandler(config, issuer)
    const response = await handle(new Request("http://localhost/health"))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "ok", mode: "mock" })
  })

  test("issues tokens and rate limits by client", async () => {
    const handle = createRequestHandler(
      config,
      issuer,
      new FixedWindowRateLimiter(1),
    )
    const request = new Request(
      "http://localhost/v1/apple/developer-token",
    )

    expect((await handle(request, "client-a")).status).toBe(200)
    expect((await handle(request, "client-a")).status).toBe(429)
    expect((await handle(request, "client-b")).status).toBe(200)
  })

  test("rejects browser origins that are not configured", async () => {
    const handle = createRequestHandler(config, issuer)
    const response = await handle(
      new Request("http://localhost/v1/apple/developer-token", {
        headers: { origin: "https://attacker.example" },
      }),
    )

    expect(response.status).toBe(403)
  })
})
