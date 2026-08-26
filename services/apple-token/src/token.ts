import type { TokenServiceConfig } from "./config"

export interface IssuedDeveloperToken {
  token: string
  expiresAt: string
  mode: "mock" | "apple"
}

export interface DeveloperTokenIssuer {
  issue(): Promise<IssuedDeveloperToken>
}

interface AppleTokenClaims {
  iss: string
  iat: number
  exp: number
  origin?: string
}

export function createDeveloperTokenIssuer(
  config: TokenServiceConfig,
  nowSeconds: () => number = () => Math.floor(Date.now() / 1_000),
): DeveloperTokenIssuer {
  if (config.mode === "mock") {
    return {
      issue: async () => {
        const expiresAtSeconds = nowSeconds() + config.tokenTtlSeconds
        return {
          token: "nuta-local-mock-token",
          expiresAt: new Date(expiresAtSeconds * 1_000).toISOString(),
          mode: "mock",
        }
      },
    }
  }

  if (!config.apple) {
    throw new Error("Apple credentials are missing")
  }

  return new AppleDeveloperTokenIssuer(
    { ...config, apple: config.apple },
    nowSeconds,
  )
}

class AppleDeveloperTokenIssuer implements DeveloperTokenIssuer {
  private cached?: { value: IssuedDeveloperToken; expiresAtSeconds: number }
  private key?: Promise<CryptoKey>

  constructor(
    private readonly config: TokenServiceConfig & {
      apple: NonNullable<TokenServiceConfig["apple"]>
    },
    private readonly nowSeconds: () => number,
  ) {}

  async issue(): Promise<IssuedDeveloperToken> {
    const now = this.nowSeconds()
    if (this.cached && this.cached.expiresAtSeconds - now > 60) {
      return this.cached.value
    }

    const expiresAtSeconds = now + this.config.tokenTtlSeconds
    const claims: AppleTokenClaims = {
      iss: this.config.apple.teamId,
      iat: now,
      exp: expiresAtSeconds,
    }
    if (this.config.allowedOrigin) claims.origin = this.config.allowedOrigin

    const encodedHeader = encodeJson({
      alg: "ES256",
      kid: this.config.apple.keyId,
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
    this.key ??= importPrivateKey(this.config.apple.privateKey)
    return this.key
  }
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "")

  if (!body) throw new Error("Apple private key is empty or invalid")

  return crypto.subtle.importKey(
    "pkcs8",
    Buffer.from(body, "base64"),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  )
}

function encodeJson(value: unknown): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(value)))
}

function toBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url")
}
