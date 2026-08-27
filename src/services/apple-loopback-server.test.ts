import { describe, expect, test } from "bun:test"

import type { AuthLogDetails } from "./auth-log"
import {
  createAppleLoopbackRequestHandler,
  startAppleLoopbackServer,
  type DeveloperTokenIssuer,
} from "./apple-loopback-server"

const origin = "http://127.0.0.1:8787"
const issuer: DeveloperTokenIssuer = {
  issue: async () => ({
    token: "developer-secret",
    expiresAt: "2030-01-01T00:00:00.000Z",
    mode: "apple",
  }),
}

function jsonRequest(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${origin}${path}`, {
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

describe("Apple loopback request handler", () => {
  test("serves health and an injected developer token without key access", async () => {
    let issues = 0
    const handle = createAppleLoopbackRequestHandler({
      issuer: {
        issue: async () => {
          issues++
          return issuer.issue()
        },
      },
    })

    const health = await handle(new Request(`${origin}/health`))
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ status: "ok", mode: "apple" })
    expect(issues).toBe(0)

    const token = await handle(
      new Request(`${origin}/v1/apple/developer-token`),
    )
    expect(token.status).toBe(200)
    expect(await token.json()).toEqual({
      token: "developer-secret",
      expiresAt: "2030-01-01T00:00:00.000Z",
      mode: "apple",
    })
    expect(issues).toBe(1)
  })

  test("rate limits token requests by client", async () => {
    const handle = createAppleLoopbackRequestHandler({
      issuer,
      rateLimitPerMinute: 1,
    })
    const request = new Request(`${origin}/v1/apple/developer-token`)

    expect((await handle(request, "client-a")).status).toBe(200)
    expect((await handle(request, "client-a")).status).toBe(429)
    expect((await handle(request, "client-b")).status).toBe(200)
  })

  test("rejects alias hosts and unconfigured browser origins", async () => {
    const handle = createAppleLoopbackRequestHandler({
      issuer,
      allowedOrigin: "https://nutka.example",
    })

    expect(
      (await handle(new Request("http://localhost:8787/health"))).status,
    ).toBe(404)
    expect(
      (await handle(new Request("http://[::1]:8787/health"))).status,
    ).toBe(404)
    expect(
      (
        await handle(
          new Request(`${origin}/v1/apple/developer-token`, {
            headers: { origin: "https://attacker.example" },
          }),
        )
      ).status,
    ).toBe(403)
  })

  test("serves hardened authorization assets and erases the URL fragment", async () => {
    const handle = createAppleLoopbackRequestHandler({ issuer })
    const response = await handle(new Request(`${origin}/authorize`))
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
    expect(html).toContain(
      "https://js-cdn.music.apple.com/musickit/v3/musickit.js",
    )
    expect(html).toContain("Authorize Apple Music")
    expect(html).not.toContain("<form")
    expect(html).not.toContain("<input")

    const scriptResponse = await handle(new Request(`${origin}/authorize.js`))
    const script = await scriptResponse.text()
    expect(script).toContain("window.location.hash.slice(1)")
    expect(script).toContain("history.replaceState")
    expect(script).toContain("JSON.stringify({ browserToken })")
    expect(script.indexOf("history.replaceState")).toBeLessThan(
      script.indexOf('fetch("/v1/apple/auth/browser/claim"'),
    )
    expect(script).not.toContain("console.")

    const cssResponse = await handle(new Request(`${origin}/authorize.css`))
    expect(cssResponse.headers.get("content-type")).toBe(
      "text/css; charset=utf-8",
    )
  })

  test("serves a hardened MusicKit playback page without credentials", async () => {
    const handle = createAppleLoopbackRequestHandler({ issuer })
    const response = await handle(new Request(`${origin}/playback`))
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("x-frame-options")).toBe("DENY")
    expect(response.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    )
    expect(response.headers.get("content-security-policy")).toContain(
      "media-src blob:",
    )
    expect(response.headers.get("content-security-policy")).toContain(
      "worker-src blob:",
    )
    expect(html).toContain(
      "https://js-cdn.music.apple.com/musickit/v3/musickit.js",
    )
    expect(html).not.toContain("developerToken")
    expect(html).not.toContain("musicUserToken")

    const scriptResponse = await handle(new Request(`${origin}/playback.js`))
    const script = await scriptResponse.text()
    expect(script).toContain("window.__nutkaPlayback")
    expect(script).toContain("music.setQueue(songResourceIds.length === 1")
    expect(script).toContain("music.skipToPreviousItem()")
    expect(script).toContain("music.skipToNextItem()")
    expect(script).toContain("music.shuffleMode = MusicKit.PlayerShuffleMode.songs")
    expect(script).toContain("music.repeatMode = MusicKit.PlayerRepeatMode.one")
    expect(script).toContain("queueResourceIds")
    expect(script).toContain("canSetRepeatMode")
    expect(script).toContain("music.musicUserToken = musicUserToken")
    expect(script).toContain("completedCommandSequence")
    expect(script).not.toContain("authorize()")
    expect(script).not.toContain("console.")
  })

  test("runs the one-time browser capability lifecycle and bounded logging", async () => {
    const logEntries: Array<{ event: string; details?: AuthLogDetails }> = []
    const handle = createAppleLoopbackRequestHandler({
      issuer,
      logger: {
        log: (event, details) => logEntries.push({ event, details }),
      },
    })
    const createResponse = await handle(
      jsonRequest("/v1/apple/auth/sessions", {}),
    )
    const created = (await createResponse.json()) as {
      cliToken: string
      authorizationUrl: string
    }
    const authorizationUrl = new URL(created.authorizationUrl)
    const token = browserToken(created.authorizationUrl)

    expect(createResponse.status).toBe(201)
    expect(authorizationUrl.origin).toBe(origin)
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
        { origin },
      ),
    )
    const claim = (await claimResponse.json()) as {
      csrfToken: string
      developerToken: string
    }
    const cookie = claimResponse.headers.get("set-cookie")!.split(";", 1)[0]!
    expect(claimResponse.status).toBe(200)
    expect(claim.developerToken).toBe("developer-secret")
    expect(claimResponse.headers.get("set-cookie")).toContain("HttpOnly")
    expect(claimResponse.headers.get("set-cookie")).toContain("SameSite=Strict")

    const eventResponse = await handle(
      jsonRequest(
        "/v1/apple/auth/browser/event",
        { event: "apple_approval_started", code: "AUTHORIZATION_ERROR" },
        { origin, cookie },
      ),
    )
    expect(eventResponse.status).toBe(204)
    expect(logEntries).toContainEqual({
      event: "apple_approval_started",
      details: { code: "AUTHORIZATION_ERROR" },
    })
    expect(
      (
        await handle(
          jsonRequest(
            "/v1/apple/auth/browser/claim",
            { browserToken: token },
            { origin },
          ),
        )
      ).status,
    ).toBe(409)

    const completeResponse = await handle(
      jsonRequest(
        "/v1/apple/auth/browser/complete",
        { csrfToken: claim.csrfToken, musicUserToken: "music-user-secret" },
        { origin, cookie },
      ),
    )
    expect(completeResponse.status).toBe(200)
    expect(completeResponse.headers.get("set-cookie")).toContain("Max-Age=0")

    const completed = await handle(
      jsonRequest("/v1/apple/auth/sessions/status", {
        cliToken: created.cliToken,
      }),
    )
    expect(await completed.json()).toEqual({
      status: "complete",
      musicUserToken: "music-user-secret",
    })
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

    const serializedLogs = JSON.stringify(logEntries)
    expect(serializedLogs).not.toContain("developer-secret")
    expect(serializedLogs).not.toContain("music-user-secret")
    expect(serializedLogs).not.toContain(created.cliToken)
    expect(serializedLogs).not.toContain(token)
  })

  test("requires exact browser origin, cookie, CSRF, JSON, and body limit", async () => {
    const handle = createAppleLoopbackRequestHandler({ issuer })
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
        { origin },
      ),
    )
    const claim = (await claimResponse.json()) as { csrfToken: string }
    const cookie = claimResponse.headers.get("set-cookie")!.split(";", 1)[0]!
    expect(
      (
        await handle(
          jsonRequest(
            "/v1/apple/auth/browser/complete",
            { csrfToken: claim.csrfToken, musicUserToken: "secret" },
            { origin },
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
            { origin, cookie },
          ),
        )
      ).status,
    ).toBe(401)
    expect(
      (
        await handle(
          jsonRequest(
            "/v1/apple/auth/browser/complete",
            { csrfToken: claim.csrfToken, musicUserToken: "secret" },
            { origin, cookie: `${cookie}; ${cookie}` },
          ),
        )
      ).status,
    ).toBe(401)
    expect(
      (
        await handle(
          new Request(`${origin}/v1/apple/auth/sessions`, {
            method: "POST",
            body: "{}",
          }),
        )
      ).status,
    ).toBe(415)
    expect(
      (
        await handle(
          jsonRequest("/v1/apple/auth/sessions", {
            padding: "x".repeat(9_000),
          }),
        )
      ).status,
    ).toBe(413)
  })
})

describe("Apple loopback server", () => {
  test("binds an ephemeral port on the exact IPv4 loopback origin and stops idempotently", async () => {
    const server = startAppleLoopbackServer({ issuer, port: 0 })
    const url = new URL(server.origin)
    const port = Number(url.port)
    try {
      expect(url.protocol).toBe("http:")
      expect(url.hostname).toBe("127.0.0.1")
      expect(port).toBeGreaterThan(0)
      const response = await fetch(`${server.origin}/health`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: "ok", mode: "apple" })
    } finally {
      server.stop()
      server.stop()
    }

    const replacement = startAppleLoopbackServer({ issuer, port })
    expect(replacement.origin).toBe(`http://127.0.0.1:${port}`)
    replacement.stop()
  })

  test("reports a port conflict instead of changing host or port", () => {
    const first = startAppleLoopbackServer({ issuer, port: 0 })
    const port = Number(new URL(first.origin).port)
    try {
      expect(() => startAppleLoopbackServer({ issuer, port })).toThrow()
    } finally {
      first.stop()
    }
  })
})
