import { describe, expect, test } from "vitest"

import type { Bindings } from "../src/bindings"
import {
  isSigningEnabled,
  loadSigningConfig,
  parseTokenTtl,
} from "../src/config"

const unusedRateLimit = {
  limit: async () => ({ success: true }),
}

describe("signing configuration", () => {
  test("loads required bindings and the 900-second default TTL", () => {
    const bindings: Bindings = {
      APPLE_TEAM_ID: " TEAM123 ",
      APPLE_KEY_ID: " KEY123 ",
      APPLE_PRIVATE_KEY: " private key ",
      RATE_LIMITER: unusedRateLimit,
    }

    expect(loadSigningConfig(bindings)).toEqual({
      teamId: "TEAM123",
      keyId: "KEY123",
      privateKey: "private key",
      tokenTtlSeconds: 900,
    })
  })

  test.each(["", " 900", "900 ", "0900", "900.0", "1e3", "359", "3601"])(
    "rejects invalid TTL %j",
    (value) => {
      expect(() => parseTokenTtl(value)).toThrow(
        "APPLE_TOKEN_TTL_SECONDS must be an integer from 360 to 3600",
      )
    },
  )

  test("accepts both strict TTL boundaries", () => {
    expect(parseTokenTtl("360")).toBe(360)
    expect(parseTokenTtl("3600")).toBe(3600)
  })

  test("requires every Apple credential binding", () => {
    expect(() =>
      loadSigningConfig({
        APPLE_KEY_ID: "KEY123",
        APPLE_PRIVATE_KEY: "private key",
        RATE_LIMITER: unusedRateLimit,
      }),
    ).toThrow("APPLE_TEAM_ID binding is required")
  })

  test("enables signing only for the exact true value", () => {
    const bindings = { RATE_LIMITER: unusedRateLimit }
    expect(isSigningEnabled({ ...bindings, SIGNING_ENABLED: "true" })).toBe(true)
    expect(isSigningEnabled({ ...bindings, SIGNING_ENABLED: "TRUE" })).toBe(false)
    expect(isSigningEnabled({ ...bindings, SIGNING_ENABLED: " true " })).toBe(false)
    expect(isSigningEnabled(bindings)).toBe(false)
  })
})
