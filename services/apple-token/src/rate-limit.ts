export type RateLimitBinding = Pick<RateLimit, "limit">

export interface RateLimiter {
  consume(key: string): Promise<boolean>
}

export function createRateLimiter(binding: RateLimitBinding): RateLimiter {
  return {
    async consume(key) {
      const result = await binding.limit({ key })
      return result.success
    },
  }
}
