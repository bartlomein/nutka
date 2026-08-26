import { describe, expect, test } from "bun:test"

import { AppleDeveloperTokenProvider } from "./apple-developer-token-provider"
import type { DeveloperTokenIssuer } from "./apple-loopback-server"
import type { Fetch } from "./token-service"

const START = Date.parse("2030-01-01T00:00:00.000Z")

describe("Apple developer token provider", () => {
  test.each([
    "https://signer.example",
    "https://signer.example/",
    "https://signer.example:8443/",
    "http://127.0.0.1:8787",
    "http://127.0.0.1:8787/",
  ])("accepts signer origin %s", (url) => {
    const issuer: DeveloperTokenIssuer = new AppleDeveloperTokenProvider(url)
    expect(issuer).toBeInstanceOf(AppleDeveloperTokenProvider)
  })

  test.each([
    "http://signer.example",
    "http://localhost:8787",
    "https://localhost",
    "https://api.localhost",
    "http://127.0.0.1",
    "http://127.1:8787",
    "http://2130706433:8787",
    "http://[::1]:8787",
    "https://[2001:db8::1]",
    "https://user:password@signer.example",
    "https://signer.example/path",
    "https://signer.example?query=1",
    "https://signer.example#fragment",
    "https://signer.example/?",
    "ftp://signer.example",
  ])("rejects signer URL %s", (url) => {
    expect(() => new AppleDeveloperTokenProvider(url)).toThrow(
      "Apple signer URL",
    )
  })

  test("uses the token client endpoint and caches a valid Apple token", async () => {
    let calls = 0
    let requestedUrl = ""
    const fetchImpl: Fetch = async (input, init) => {
      calls++
      requestedUrl = String(input)
      expect(init?.redirect).toBe("manual")
      return appleResponse("token-one", START + 120_000)
    }
    const provider = new AppleDeveloperTokenProvider(
      "http://127.0.0.1:8787",
      { fetch: fetchImpl, now: () => START },
    )

    const first = await provider.issue()
    const second = await provider.issue()

    expect(requestedUrl).toBe(
      "http://127.0.0.1:8787/v1/apple/developer-token",
    )
    expect(first).toBe(second)
    expect(first).toEqual({
      token: "token-one",
      expiresAt: new Date(START + 120_000).toISOString(),
      mode: "apple",
    })
    expect(calls).toBe(1)
  })

  test("coalesces concurrent requests", async () => {
    let calls = 0
    let respond!: (response: Response) => void
    const fetchImpl: Fetch = async () => {
      calls++
      return new Promise<Response>((resolve) => {
        respond = resolve
      })
    }
    const provider = providerWith(fetchImpl)

    const first = provider.issue()
    const second = provider.issue()
    expect(first).toBe(second)
    await Promise.resolve()
    expect(calls).toBe(1)

    respond(appleResponse("shared-token", START + 120_000))
    expect(await Promise.all([first, second])).toEqual([
      expect.objectContaining({ token: "shared-token" }),
      expect.objectContaining({ token: "shared-token" }),
    ])
  })

  test("refreshes when only 60 seconds remain", async () => {
    let now = START
    let calls = 0
    const provider = new AppleDeveloperTokenProvider("https://signer.example", {
      now: () => now,
      fetch: async () => {
        calls++
        return appleResponse(`token-${calls}`, now + 120_000)
      },
    })

    expect((await provider.issue()).token).toBe("token-1")
    now += 59_999
    expect((await provider.issue()).token).toBe("token-1")
    now += 1
    expect((await provider.issue()).token).toBe("token-2")
    expect(calls).toBe(2)
  })

  test("refreshes for a five-minute authorization session plus safety margin", async () => {
    let calls = 0
    const provider = new AppleDeveloperTokenProvider("https://signer.example", {
      now: () => START,
      fetch: async () => {
        calls++
        return appleResponse(
          `token-${calls}`,
          START + (calls === 1 ? 5 * 60_000 : 10 * 60_000),
        )
      },
    })

    expect((await provider.issue()).token).toBe("token-1")
    expect((await provider.issue(5 * 60_000 + 30_000)).token).toBe("token-2")
    expect(calls).toBe(2)
  })

  test("keeps a usable short-lived token when a stronger refresh fails", async () => {
    let calls = 0
    const provider = new AppleDeveloperTokenProvider("https://signer.example", {
      now: () => START,
      fetch: async () => {
        calls++
        if (calls === 1) return appleResponse("usable-token", START + 120_000)
        throw new Error("refresh failed")
      },
    })

    expect((await provider.issue()).token).toBe("usable-token")
    const stronger = provider.issue(5 * 60_000 + 30_000)
    expect((await provider.issue()).token).toBe("usable-token")
    await expect(stronger).rejects.toMatchObject({ code: "unavailable" })
    expect(calls).toBe(2)
  })

  test("rejects a validity request below the safety margin", async () => {
    const provider = providerWith(async () =>
      appleResponse("unused", START + 120_000)
    )
    await expect(provider.issue(59_999)).rejects.toBeInstanceOf(TypeError)
  })

  test.each([
    {
      name: "mock mode",
      body: { token: "token", expiresAt: future(), mode: "mock" },
    },
    {
      name: "expired value",
      body: { token: "token", expiresAt: new Date(START).toISOString(), mode: "apple" },
    },
    {
      name: "nearly expired value",
      body: {
        token: "token",
        expiresAt: new Date(START + 60_000).toISOString(),
        mode: "apple",
      },
    },
    {
      name: "oversized token",
      body: { token: "x".repeat(16 * 1024 + 1), expiresAt: future(), mode: "apple" },
    },
    {
      name: "oversized response",
      body: {
        token: "token",
        expiresAt: future(),
        mode: "apple",
        padding: "x".repeat(33 * 1024),
      },
    },
    {
      name: "malformed response",
      body: { token: "token", mode: "apple" },
    },
  ])("rejects $name", async ({ body }) => {
    const provider = providerWith(async () => Response.json(body))
    await expect(provider.issue()).rejects.toMatchObject({
      code: "invalid_response",
    })
  })

  test("does not cache failures", async () => {
    let calls = 0
    const provider = providerWith(async () => {
      calls++
      if (calls === 1) throw new Error("network failure")
      return appleResponse("recovered-token", START + 120_000)
    })

    await expect(provider.issue()).rejects.toMatchObject({ code: "unavailable" })
    expect((await provider.issue()).token).toBe("recovered-token")
    expect(calls).toBe(2)
  })

  test("rejects redirects", async () => {
    const provider = providerWith(async () =>
      Response.redirect("https://other.example/v1/apple/developer-token", 302),
    )
    await expect(provider.issue()).rejects.toMatchObject({ code: "unavailable" })
  })

  test("passes through the hard request timeout", async () => {
    let signal: AbortSignal | null = null
    const provider = new AppleDeveloperTokenProvider("https://signer.example", {
      now: () => START,
      timeoutMs: 5,
      fetch: async (_input, init) => {
        signal = init?.signal as AbortSignal
        return new Promise<Response>(() => {})
      },
    })

    await expect(provider.issue()).rejects.toMatchObject({ code: "unavailable" })
    expect((signal as AbortSignal | null)?.aborted).toBe(true)
  })

  test("clear drops the cache and aborts an in-flight request", async () => {
    let calls = 0
    let firstSignal: AbortSignal | null = null
    const provider = providerWith(async (_input, init) => {
      calls++
      if (calls === 1) return appleResponse("cached-token", START + 120_000)
      if (calls === 2) {
        firstSignal = init?.signal as AbortSignal
        return new Promise<Response>(() => {})
      }
      return appleResponse("fresh-token", START + 120_000)
    })

    await provider.issue()
    provider.clear()
    const pending = provider.issue()
    await Promise.resolve()
    provider.clear()
    expect((firstSignal as AbortSignal | null)?.aborted).toBe(true)
    await expect(pending).rejects.toMatchObject({ code: "unavailable" })
    expect((await provider.issue()).token).toBe("fresh-token")
    expect(calls).toBe(3)

    provider.dispose()
  })
})

function providerWith(fetchImpl: Fetch): AppleDeveloperTokenProvider {
  return new AppleDeveloperTokenProvider("https://signer.example", {
    fetch: fetchImpl,
    now: () => START,
  })
}

function future(): string {
  return new Date(START + 120_000).toISOString()
}

function appleResponse(token: string, expiresAt: number): Response {
  return Response.json({
    token,
    expiresAt: new Date(expiresAt).toISOString(),
    mode: "apple",
  })
}
