import { expect, test } from "bun:test"

import { createClientEnvironment } from "./client-environment"

test("client environment excludes Apple signing and fetch-debug variables", () => {
  const environment = createClientEnvironment({
    APPLE_PRIVATE_KEY: "secret",
    APPLE_PRIVATE_KEY_PATH: "/secret/key.p8",
    APPLE_TEAM_ID: "team",
    BUN_CONFIG_VERBOSE_FETCH: "curl",
    HOME: "/home/example",
    LC_MESSAGES: "en_US.UTF-8",
    NUTA_ALLOWED_ORIGIN: "https://example.test",
    NUTA_AUTH_LOG: "/tmp/nuta-auth.log",
    NUTA_CHROMIUM_PATH: "/opt/chrome",
    NUTA_THEME_PATH: "/home/example/theme.toml",
    NUTA_TOKEN_SERVICE_MODE: "apple",
  })

  expect(environment).toEqual({
    HOME: "/home/example",
    LC_MESSAGES: "en_US.UTF-8",
    NUTA_AUTH_LOG: "/tmp/nuta-auth.log",
    NUTA_CHROMIUM_PATH: "/opt/chrome",
    NUTA_THEME_PATH: "/home/example/theme.toml",
    PATH: "/usr/local/bin:/usr/bin:/bin",
  })
})
