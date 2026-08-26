import type { Bindings } from "./bindings"

export const DEFAULT_TOKEN_TTL_SECONDS = 900
export const MIN_TOKEN_TTL_SECONDS = 360
export const MAX_TOKEN_TTL_SECONDS = 3_600

export interface SigningConfig {
  tokenTtlSeconds: number
  teamId: string
  keyId: string
  privateKey: string
}

export function loadSigningConfig(bindings: Bindings): SigningConfig {
  return {
    teamId: required(bindings.APPLE_TEAM_ID, "APPLE_TEAM_ID"),
    keyId: required(bindings.APPLE_KEY_ID, "APPLE_KEY_ID"),
    privateKey: required(bindings.APPLE_PRIVATE_KEY, "APPLE_PRIVATE_KEY"),
    tokenTtlSeconds: parseTokenTtl(bindings.APPLE_TOKEN_TTL_SECONDS),
  }
}

export function isSigningEnabled(bindings: Bindings): boolean {
  return bindings.SIGNING_ENABLED === "true"
}

export function parseTokenTtl(value: string | undefined): number {
  if (value === undefined) return DEFAULT_TOKEN_TTL_SECONDS
  if (!/^[1-9]\d*$/.test(value)) throw invalidTtlError()
  const parsed = Number(value)
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_TOKEN_TTL_SECONDS ||
    parsed > MAX_TOKEN_TTL_SECONDS
  ) {
    throw invalidTtlError()
  }
  return parsed
}

function required(value: string | undefined, name: string): string {
  const trimmed = value?.trim()
  if (!trimmed) throw new Error(`${name} binding is required`)
  return trimmed
}

function invalidTtlError(): Error {
  return new Error(
    `APPLE_TOKEN_TTL_SECONDS must be an integer from ${MIN_TOKEN_TTL_SECONDS} to ${MAX_TOKEN_TTL_SECONDS}`,
  )
}
