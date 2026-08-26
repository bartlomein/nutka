import { describe, expect, test } from "bun:test"

import type { TokenServiceConfig } from "./config"
import { createDeveloperTokenIssuer } from "./token"

describe("developer token issuer", () => {
  test("returns an explicit local token in mock mode", async () => {
    const issuer = createDeveloperTokenIssuer(
      baseConfig({ mode: "mock" }),
      () => 1_700_000_000,
    )

    expect(await issuer.issue()).toEqual({
      token: "nutka-local-mock-token",
      expiresAt: "2023-11-14T22:28:20.000Z",
      mode: "mock",
    })
  })

  test("creates a verifiable ES256 Apple JWT and caches it", async () => {
    const keys = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    )
    const privateKey = await crypto.subtle.exportKey("pkcs8", keys.privateKey)
    const config = baseConfig({
      mode: "apple",
      apple: {
        teamId: "TEAM123",
        keyId: "KEY123",
        privateKey: toPem(privateKey),
      },
      allowedOrigin: "https://nutka.example",
    })
    const issuer = createDeveloperTokenIssuer(config, () => 1_700_000_000)

    const first = await issuer.issue()
    const second = await issuer.issue()
    const [header, payload, signature] = first.token.split(".")

    expect(first).toEqual(second)
    expect(decodeJson(header!)).toEqual({ alg: "ES256", kid: "KEY123" })
    expect(decodeJson(payload!)).toEqual({
      iss: "TEAM123",
      iat: 1_700_000_000,
      exp: 1_700_000_900,
      origin: "https://nutka.example",
    })
    expect(Buffer.from(signature!, "base64url")).toHaveLength(64)
    expect(
      await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        keys.publicKey,
        Buffer.from(signature!, "base64url"),
        new TextEncoder().encode(`${header}.${payload}`),
      ),
    ).toBe(true)
  })
})

function baseConfig(
  overrides: Partial<TokenServiceConfig>,
): TokenServiceConfig {
  return {
    mode: "mock",
    host: "127.0.0.1",
    port: 8787,
    rateLimitPerMinute: 30,
    tokenTtlSeconds: 900,
    ...overrides,
  }
}

function toPem(key: ArrayBuffer): string {
  const body = Buffer.from(key).toString("base64").match(/.{1,64}/g)!.join("\n")
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`
}

function decodeJson(value: string): unknown {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
}
