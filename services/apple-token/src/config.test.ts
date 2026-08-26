import { describe, expect, test } from "bun:test"

import { loadTokenServiceConfig } from "./config"

describe("token service config", () => {
  test("defaults to safe local mock mode", async () => {
    expect(await loadTokenServiceConfig({})).toMatchObject({
      mode: "mock",
      host: "127.0.0.1",
      port: 8787,
      tokenTtlSeconds: 900,
      rateLimitPerMinute: 30,
    })
  })

  test("loads Apple credentials from a file path", async () => {
    const config = await loadTokenServiceConfig(
      {
        NUTA_TOKEN_SERVICE_MODE: "apple",
        APPLE_TEAM_ID: "team",
        APPLE_KEY_ID: "key",
        APPLE_PRIVATE_KEY_PATH: "/private/AuthKey.p8",
      },
      async (path) => `contents of ${path}`,
    )

    expect(config.apple).toEqual({
      teamId: "team",
      keyId: "key",
      privateKey: "contents of /private/AuthKey.p8",
    })
  })

  test("refuses Apple mode without credentials", async () => {
    expect(
      loadTokenServiceConfig({ NUTA_TOKEN_SERVICE_MODE: "apple" }),
    ).rejects.toThrow("APPLE_TEAM_ID")
  })
})
