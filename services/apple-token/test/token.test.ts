import { describe, expect, test } from "vitest"

import { createDeveloperTokenIssuer, importPrivateKey } from "../src/token"

describe("Apple developer-token issuer", () => {
  test("creates and caches a verifiable raw-signature ES256 JWT", async () => {
    const keys = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair
    const privateKey = (await crypto.subtle.exportKey(
      "pkcs8",
      keys.privateKey,
    )) as ArrayBuffer
    let now = 1_700_000_000
    const issuer = createDeveloperTokenIssuer(
      {
        teamId: "TEAM123",
        keyId: "KEY123",
        privateKey: toPem(privateKey),
        tokenTtlSeconds: 900,
      },
      () => now,
    )

    const first = await issuer.issue()
    const second = await issuer.issue()
    const [header, payload, signature] = first.token.split(".")

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      expiresAt: "2023-11-14T22:28:20.000Z",
      mode: "apple",
    })
    expect(decodeJson(header!)).toEqual({ alg: "ES256", kid: "KEY123" })
    expect(decodeJson(payload!)).toEqual({
      iss: "TEAM123",
      iat: 1_700_000_000,
      exp: 1_700_000_900,
    })

    const signatureBytes = decodeBase64Url(signature!)
    expect(signatureBytes).toHaveLength(64)
    await expect(
      crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        keys.publicKey,
        signatureBytes,
        new TextEncoder().encode(`${header}.${payload}`),
      ),
    ).resolves.toBe(true)

    now += 540
    const refreshed = await issuer.issue()
    expect(refreshed.token).not.toBe(first.token)
    expect(decodeJson(refreshed.token.split(".")[1]!)).toMatchObject({
      iat: 1_700_000_540,
      exp: 1_700_001_440,
    })
  })

  test("rejects an invalid PEM before import", async () => {
    await expect(
      importPrivateKey("-----BEGIN PRIVATE KEY-----\nnot base64!\n-----END PRIVATE KEY-----"),
    ).rejects.toThrow("Apple private key is empty or invalid")
  })
})

function toPem(key: ArrayBuffer): string {
  const body = encodeBase64(new Uint8Array(key)).match(/.{1,64}/g)!.join("\n")
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`
}

function decodeJson(value: string): unknown {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)))
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
  return decodeBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function encodeBase64(value: Uint8Array): string {
  let binary = ""
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
}
