import type {
  DeveloperTokenIssuer,
  IssuedDeveloperToken,
} from "./apple-loopback-server"
import {
  DeveloperTokenError,
  requestDeveloperToken,
  type Fetch,
} from "./token-service"

const MIN_VALIDITY_MS = 60_000
const MAX_TOKEN_LENGTH = 16 * 1024

export interface AppleDeveloperTokenProviderOptions {
  fetch?: Fetch
  now?: () => number
  timeoutMs?: number
}

interface PendingRequest {
  controller: AbortController
  minimumValidityMs: number
  promise: Promise<IssuedDeveloperToken>
}

export class AppleDeveloperTokenProvider implements DeveloperTokenIssuer {
  private readonly signerOrigin: string
  private readonly fetchImpl: Fetch
  private readonly now: () => number
  private readonly timeoutMs: number | undefined
  private cached?: { value: IssuedDeveloperToken; expiresAt: number }
  private pending?: PendingRequest
  private generation = 0

  constructor(
    signerBaseUrl: string,
    options: AppleDeveloperTokenProviderOptions = {},
  ) {
    if (
      options.timeoutMs !== undefined &&
      (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
    ) {
      throw new TypeError("timeoutMs must be positive")
    }

    this.signerOrigin = validateSignerOrigin(signerBaseUrl)
    this.fetchImpl = options.fetch ?? fetch
    this.now = options.now ?? Date.now
    this.timeoutMs = options.timeoutMs
  }

  issue(minimumValidityMs = MIN_VALIDITY_MS): Promise<IssuedDeveloperToken> {
    if (!Number.isFinite(minimumValidityMs) || minimumValidityMs < MIN_VALIDITY_MS) {
      return Promise.reject(new TypeError("minimumValidityMs must be at least 60000"))
    }
    if (this.cached) {
      if (this.cached.expiresAt - this.now() > minimumValidityMs) {
        return Promise.resolve(this.cached.value)
      }
      if (this.cached.expiresAt - this.now() <= MIN_VALIDITY_MS) {
        this.cached = undefined
      }
    }
    if (this.pending) {
      if (this.pending.minimumValidityMs >= minimumValidityMs) {
        return this.pending.promise
      }
      return this.pending.promise.then((value) =>
        Date.parse(value.expiresAt) - this.now() > minimumValidityMs
          ? value
          : this.issue(minimumValidityMs)
      )
    }

    const controller = new AbortController()
    const generation = this.generation
    const pending: PendingRequest = {
      controller,
      minimumValidityMs,
      promise: this.requestToken(controller.signal, generation, minimumValidityMs),
    }
    this.pending = pending
    pending.promise.then(
      () => this.finish(pending),
      () => this.finish(pending),
    )
    return pending.promise
  }

  clear(): void {
    this.generation++
    this.cached = undefined
    const pending = this.pending
    this.pending = undefined
    pending?.controller.abort()
  }

  dispose(): void {
    this.clear()
  }

  private async requestToken(
    signal: AbortSignal,
    generation: number,
    minimumValidityMs: number,
  ): Promise<IssuedDeveloperToken> {
    const value = await requestDeveloperToken(
      this.signerOrigin,
      this.fetchImpl,
      { signal, timeoutMs: this.timeoutMs },
    )
    const expiresAt = Date.parse(value.expiresAt)
    if (
      value.mode !== "apple" ||
      value.token.length > MAX_TOKEN_LENGTH ||
      !Number.isFinite(expiresAt) ||
      expiresAt - this.now() <= minimumValidityMs
    ) {
      throw new DeveloperTokenError("invalid_response")
    }

    if (generation === this.generation) {
      this.cached = { value, expiresAt }
    }
    return value
  }

  private finish(pending: PendingRequest): void {
    if (this.pending === pending) this.pending = undefined
  }
}

function validateSignerOrigin(value: string): string {
  if (typeof value !== "string" || value !== value.trim()) {
    throw invalidSignerUrl()
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw invalidSignerUrl()
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "")
  if (
    url.username ||
    url.password ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    url.hostname.startsWith("[")
  ) {
    throw invalidSignerUrl()
  }

  if (url.protocol === "http:") {
    const local = /^http:\/\/127\.0\.0\.1:([0-9]+)\/?$/i.exec(value)
    const port = Number(local?.[1])
    if (!local || !Number.isInteger(port) || port < 1 || port > 65_535) {
      throw invalidSignerUrl()
    }
  } else if (
    url.protocol !== "https:" ||
    !/^https:\/\/[^\s/?#\\]+\/?$/i.test(value)
  ) {
    throw invalidSignerUrl()
  }

  return url.origin
}

function invalidSignerUrl(): TypeError {
  return new TypeError(
    "Apple signer URL must be an HTTPS origin or explicit http://127.0.0.1:<port>",
  )
}
