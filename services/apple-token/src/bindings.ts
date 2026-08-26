import type { RateLimitBinding } from "./rate-limit"

export interface Bindings {
  APPLE_TEAM_ID?: string
  APPLE_KEY_ID?: string
  APPLE_PRIVATE_KEY?: string
  APPLE_TOKEN_TTL_SECONDS?: string
  SIGNING_ENABLED?: string
  RATE_LIMITER: RateLimitBinding
}
