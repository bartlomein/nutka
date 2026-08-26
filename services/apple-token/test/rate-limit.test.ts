import { describe, expect, test, vi } from "vitest"

import { createRateLimiter } from "../src/rate-limit"

describe("Cloudflare rate-limit adapter", () => {
  test("passes the caller key to the binding and returns its decision", async () => {
    const limit = vi.fn(async () => ({ success: false }))
    const limiter = createRateLimiter({ limit })

    await expect(limiter.consume("203.0.113.8")).resolves.toBe(false)
    expect(limit).toHaveBeenCalledOnce()
    expect(limit).toHaveBeenCalledWith({ key: "203.0.113.8" })
  })

  test("does not turn binding failures into allowed requests", async () => {
    const failure = new Error("binding unavailable")
    const limiter = createRateLimiter({
      limit: async () => Promise.reject(failure),
    })

    await expect(limiter.consume("client")).rejects.toBe(failure)
  })
})
