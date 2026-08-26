import { describe, expect, test } from "bun:test"

import type { TokenServiceConfig } from "./config"
import { AuthorizationBroker } from "./authorization-broker"
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

const appleConfig: TokenServiceConfig = {
  ...config,
  mode: "apple",
  apple: { teamId: "team", keyId: "key", privateKey: "private" },
}

function jsonRequest(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://127.0.0.1:8787${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

function browserToken(authorizationUrl: string): string {
  return new URLSearchParams(new URL(authorizationUrl).hash.slice(1)).get(
    "browserToken",
  )!
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

  test("gates authorization routes to apple mode and the exact loopback host", async () => {
    const mockHandler = createRequestHandler(config, issuer)
    expect(
      (await mockHandler(jsonRequest("/v1/apple/auth/sessions", {}))).status,
    ).toBe(404)

    const appleHandler = createRequestHandler(appleConfig, issuer)
    expect(
      (
        await appleHandler(
          new Request("http://localhost:8787/authorize"),
        )
      ).status,
    ).toBe(404)
  })

  test("serves a hardened static authorization page and Apple-hosted MusicKit v3", async () => {
    const handle = createRequestHandler(appleConfig, issuer)
    const response = await handle(
      new Request("http://127.0.0.1:8787/authorize"),
    )
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("x-frame-options")).toBe("DENY")
    expect(response.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    )
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    )
    expect(html).toContain("https://js-cdn.music.apple.com/musickit/v3/musickit.js")
    expect(html).toContain("Authorize Apple Music")
    expect(html).not.toContain("<form")
    expect(html).not.toContain("<input")

    const scriptResponse = await handle(
      new Request("http://127.0.0.1:8787/authorize.js"),
    )
    const script = await scriptResponse.text()
    expect(script).toContain("window.location.hash.slice(1)")
    expect(script).toContain("history.replaceState")
    expect(script).toContain("JSON.stringify({ browserToken })")
    expect(script.indexOf("history.replaceState")).toBeLessThan(
      script.indexOf("fetch(\"/v1/apple/auth/browser/claim\"")
    )
    expect(script).not.toContain("console.")
  })

  test("serves a loopback-only hardened MusicKit playback page", async () => {
    const handle = createRequestHandler(appleConfig, issuer)
    const response = await handle(new Request("http://127.0.0.1:8787/playback"))
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("x-frame-options")).toBe("DENY")
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin")
    expect(response.headers.get("content-security-policy")).toContain("media-src blob:")
    expect(response.headers.get("content-security-policy")).toContain("worker-src blob:")
    expect(html).toContain("https://js-cdn.music.apple.com/musickit/v3/musickit.js")
    expect(html).not.toContain("developerToken")
    expect(html).not.toContain("musicUserToken")

    const scriptResponse = await handle(
      new Request("http://127.0.0.1:8787/playback.js"),
    )
    const script = await scriptResponse.text()
    expect(script).toContain("window.__nutaPlayback")
    expect(script).toContain("music.setQueue(songResourceIds.length === 1")
    expect(script).toContain("music.musicUserToken = musicUserToken")
    expect(script).toContain("completedCommandSequence")
    expect(script).not.toContain("authorize()")
    expect(script).not.toContain("console.")

    expect(
      (await handle(new Request("http://localhost:8787/playback"))).status,
    ).toBe(404)
    expect(
      (await createRequestHandler(config, issuer)(
        new Request("http://127.0.0.1:8787/playback"),
      )).status,
    ).toBe(404)
  })

  test("runs the HTTP lifecycle with a one-time browser token in the URL fragment", async () => {
    const broker = new AuthorizationBroker("http://127.0.0.1:8787/authorize")
    const authEvents: string[] = []
    const handle = createRequestHandler(appleConfig, issuer, undefined, broker, {
      log: (event) => authEvents.push(event),
    })
    const createResponse = await handle(jsonRequest("/v1/apple/auth/sessions", {}))
    const created = (await createResponse.json()) as {
      cliToken: string
      authorizationUrl: string
    }
    const authorizationUrl = new URL(created.authorizationUrl)
    const token = browserToken(created.authorizationUrl)

    expect(createResponse.status).toBe(201)
    expect(authorizationUrl.pathname).toBe("/authorize")
    expect(authorizationUrl.search).toBe("")
    expect(authorizationUrl.hash).toBe(`#browserToken=${token}`)
    expect(authorizationUrl.pathname).not.toContain(token)
    expect(created).not.toHaveProperty("pairingCode")

    const pending = await handle(
      jsonRequest("/v1/apple/auth/sessions/status", {
        cliToken: created.cliToken,
      }),
    )
    expect(await pending.json()).toEqual({ status: "pending" })

    const claimResponse = await handle(
      jsonRequest(
        "/v1/apple/auth/browser/claim",
        { browserToken: token },
        { origin: "http://127.0.0.1:8787" },
      ),
    )
    const claim = (await claimResponse.json()) as {
      csrfToken: string
      developerToken: string
    }
    const cookie = claimResponse.headers.get("set-cookie")!.split(";", 1)[0]
    expect(claimResponse.status).toBe(200)
    expect(claim.developerToken).toBe("mock-token")
    expect(claimResponse.headers.get("set-cookie")).toContain("HttpOnly")
    expect(
      (
        await handle(
          jsonRequest(
            "/v1/apple/auth/browser/event",
            { event: "apple_approval_started", code: "AUTHORIZATION_ERROR" },
            { origin: "http://127.0.0.1:8787", cookie },
          ),
        )
      ).status,
    ).toBe(204)
    expect(authEvents).toContain("apple_approval_started")
    expect(
      (
        await handle(
          jsonRequest(
            "/v1/apple/auth/browser/claim",
            { browserToken: token },
            { origin: "http://127.0.0.1:8787" },
          ),
        )
      ).status,
    ).toBe(409)

    const completeResponse = await handle(
      jsonRequest(
        "/v1/apple/auth/browser/complete",
        { csrfToken: claim.csrfToken, musicUserToken: "music-user-token" },
        { origin: "http://127.0.0.1:8787", cookie },
      ),
    )
    expect(completeResponse.status).toBe(200)

    const completed = await handle(
      jsonRequest("/v1/apple/auth/sessions/status", {
        cliToken: created.cliToken,
      }),
    )
    expect(await completed.json()).toEqual({
      status: "complete",
      musicUserToken: "music-user-token",
    })
    expect(
      (
        await handle(
          jsonRequest("/v1/apple/auth/sessions/status", {
            cliToken: created.cliToken,
          }),
        )
      ).status,
    ).toBe(200)
    expect(
      (
        await handle(
          jsonRequest("/v1/apple/auth/sessions/acknowledge", {
            cliToken: created.cliToken,
          }),
        )
      ).status,
    ).toBe(204)
    expect(
      (
        await handle(
          jsonRequest("/v1/apple/auth/sessions/status", {
            cliToken: created.cliToken,
          }),
        )
      ).status,
    ).toBe(401)
  })

  test("requires exact browser origin, cookie, CSRF, content type, and body limit", async () => {
    const handle = createRequestHandler(appleConfig, issuer)
    const created = (await (
      await handle(jsonRequest("/v1/apple/auth/sessions", {}))
    ).json()) as { authorizationUrl: string }
    const token = browserToken(created.authorizationUrl)

    expect(
      (
        await handle(
          jsonRequest("/v1/apple/auth/browser/claim", {
            browserToken: token,
          }),
        )
      ).status,
    ).toBe(403)

    const claimResponse = await handle(
      jsonRequest(
        "/v1/apple/auth/browser/claim",
        { browserToken: token },
        { origin: "http://127.0.0.1:8787" },
      ),
    )
    const claim = (await claimResponse.json()) as { csrfToken: string }
    const cookie = claimResponse.headers.get("set-cookie")!.split(";", 1)[0]
    expect(
      (
        await handle(
          jsonRequest(
            "/v1/apple/auth/browser/complete",
            { csrfToken: claim.csrfToken, musicUserToken: "secret" },
            { origin: "http://127.0.0.1:8787" },
          ),
        )
      ).status,
    ).toBe(401)
    expect(
      (
        await handle(
          jsonRequest(
            "/v1/apple/auth/browser/complete",
            { csrfToken: "wrong", musicUserToken: "secret" },
            { origin: "http://127.0.0.1:8787", cookie },
          ),
        )
      ).status,
    ).toBe(401)
    expect(
      (
        await handle(
          new Request("http://127.0.0.1:8787/v1/apple/auth/sessions", {
            method: "POST",
            body: "{}",
          }),
        )
      ).status,
    ).toBe(415)
    expect(
      (
        await handle(
          jsonRequest("/v1/apple/auth/sessions", { padding: "x".repeat(9_000) }),
        )
      ).status,
    ).toBe(413)
  })
})
