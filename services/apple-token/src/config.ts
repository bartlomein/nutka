export type TokenServiceMode = "mock" | "apple"

export interface TokenServiceConfig {
  mode: TokenServiceMode
  host: string
  port: number
  rateLimitPerMinute: number
  allowedOrigin?: string
  tokenTtlSeconds: number
  apple?: {
    teamId: string
    keyId: string
    privateKey: string
  }
}

type Environment = Record<string, string | undefined>
type ReadTextFile = (path: string) => Promise<string>

export async function loadTokenServiceConfig(
  env: Environment = process.env,
  readTextFile: ReadTextFile = (path) => Bun.file(path).text(),
): Promise<TokenServiceConfig> {
  const mode = parseMode(env.NUTA_TOKEN_SERVICE_MODE)
  const config: TokenServiceConfig = {
    mode,
    host: env.NUTA_TOKEN_SERVICE_HOST?.trim() || "127.0.0.1",
    port: parseInteger("NUTA_TOKEN_SERVICE_PORT", env.NUTA_TOKEN_SERVICE_PORT, {
      defaultValue: 8787,
      min: 1,
      max: 65_535,
    }),
    rateLimitPerMinute: parseInteger(
      "NUTA_RATE_LIMIT_PER_MINUTE",
      env.NUTA_RATE_LIMIT_PER_MINUTE,
      { defaultValue: 30, min: 1, max: 10_000 },
    ),
    tokenTtlSeconds: parseInteger(
      "APPLE_TOKEN_TTL_SECONDS",
      env.APPLE_TOKEN_TTL_SECONDS,
      { defaultValue: 900, min: 60, max: 3_600 },
    ),
  }

  const allowedOrigin = env.NUTA_ALLOWED_ORIGIN?.trim()
  if (allowedOrigin) config.allowedOrigin = allowedOrigin

  if (mode === "apple") {
    const teamId = required(env, "APPLE_TEAM_ID")
    const keyId = required(env, "APPLE_KEY_ID")
    const inlineKey = env.APPLE_PRIVATE_KEY?.trim()
    const keyPath = env.APPLE_PRIVATE_KEY_PATH?.trim()

    if (inlineKey && keyPath) {
      throw new Error(
        "Set only one of APPLE_PRIVATE_KEY or APPLE_PRIVATE_KEY_PATH",
      )
    }

    if (!inlineKey && !keyPath) {
      throw new Error(
        "APPLE_PRIVATE_KEY or APPLE_PRIVATE_KEY_PATH is required in apple mode",
      )
    }

    config.apple = {
      teamId,
      keyId,
      privateKey: inlineKey ?? (await readTextFile(keyPath!)),
    }
  }

  return config
}

function parseMode(value: string | undefined): TokenServiceMode {
  const mode = value?.trim() || "mock"
  if (mode !== "mock" && mode !== "apple") {
    throw new Error("NUTA_TOKEN_SERVICE_MODE must be mock or apple")
  }
  return mode
}

function required(env: Environment, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is required in apple mode`)
  return value
}

function parseInteger(
  name: string,
  value: string | undefined,
  limits: { defaultValue: number; min: number; max: number },
): number {
  if (!value) return limits.defaultValue

  const parsed = Number(value)
  if (
    !Number.isInteger(parsed) ||
    parsed < limits.min ||
    parsed > limits.max
  ) {
    throw new Error(
      `${name} must be an integer from ${limits.min} to ${limits.max}`,
    )
  }
  return parsed
}
