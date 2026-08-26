import type { SigningConfig } from "./config"

const CACHE_REFRESH_SECONDS = 360

export interface IssuedDeveloperToken {
  token: string
  expiresAt: string
  mode: "apple"
}

export interface DeveloperTokenIssuer {
  issue(): Promise<IssuedDeveloperToken>
}

interface AppleTokenClaims {
  iss: string
  iat: number
  exp: number
}

export function createDeveloperTokenIssuer(
  config: SigningConfig,
  nowSeconds: () => number = () => Math.floor(Date.now() / 1_000),
): DeveloperTokenIssuer {
  return new AppleDeveloperTokenIssuer(config, nowSeconds)
}

class AppleDeveloperTokenIssuer implements DeveloperTokenIssuer {
  private cached?: { value: IssuedDeveloperToken; expiresAtSeconds: number }
  private key?: Promise<CryptoKey>

  constructor(
    private readonly config: SigningConfig,
    private readonly nowSeconds: () => number,
  ) {}

  async issue(): Promise<IssuedDeveloperToken> {
    const now = this.nowSeconds()
    if (this.cached && this.cached.expiresAtSeconds - now > CACHE_REFRESH_SECONDS) {
      return this.cached.value
    }

    const expiresAtSeconds = now + this.config.tokenTtlSeconds
    const claims: AppleTokenClaims = {
      iss: this.config.teamId,
      iat: now,
      exp: expiresAtSeconds,
    }

    const encodedHeader = encodeJson({
      alg: "ES256",
      kid: this.config.keyId,
    })
    const encodedPayload = encodeJson(claims)
    const signingInput = `${encodedHeader}.${encodedPayload}`
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      await this.getKey(),
      new TextEncoder().encode(signingInput),
    )
    const token = `${signingInput}.${toBase64Url(new Uint8Array(signature))}`
    const value: IssuedDeveloperToken = {
      token,
      expiresAt: new Date(expiresAtSeconds * 1_000).toISOString(),
      mode: "apple",
    }

    this.cached = { value, expiresAtSeconds }
    return value
  }

  private getKey(): Promise<CryptoKey> {
    this.key ??= importPrivateKey(this.config.privateKey)
    return this.key
  }
}

export async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "")

  if (
    !body ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      body,
    )
  ) {
    throw new Error("Apple private key is empty or invalid")
  }

  return crypto.subtle.importKey(
    "pkcs8",
    decodeBase64(body),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  )
}

function encodeJson(value: unknown): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(value)))
}

function toBase64Url(value: Uint8Array): string {
  let binary = ""
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")
}

function decodeBase64(value: string): Uint8Array {
  let binary: string
  try {
    binary = atob(value)
  } catch {
    throw new Error("Apple private key is empty or invalid")
  }

  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
