export class FixedWindowRateLimiter {
  private readonly clients = new Map<
    string,
    { windowStartedAt: number; requestCount: number }
  >()

  constructor(
    private readonly limit: number,
    private readonly windowMilliseconds = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  consume(clientId: string): boolean {
    const currentTime = this.now()
    const client = this.clients.get(clientId)

    if (
      !client ||
      currentTime - client.windowStartedAt >= this.windowMilliseconds
    ) {
      this.clients.set(clientId, {
        windowStartedAt: currentTime,
        requestCount: 1,
      })
      return true
    }

    if (client.requestCount >= this.limit) return false

    client.requestCount += 1
    return true
  }
}
