import type { AuthLogger } from "../auth-log"
import {
  runWithAbortTimeout,
  type Fetch,
  type NetworkRequestOptions,
} from "../token-service"
import {
  AppleAuthClientError,
  type AppleAuthorizationSession,
  type AppleAuthorizationSessionStatus,
} from "./types"

const MAX_RESPONSE_BYTES = 32 * 1024

export async function createAppleAuthorizationSession(
  serviceUrl: string,
  fetchImpl: Fetch = fetch,
  options: NetworkRequestOptions = {},
): Promise<AppleAuthorizationSession> {
  const value = await postJson(
    serviceUrl,
    "/v1/apple/auth/sessions",
    {},
    fetchImpl,
    options,
  )
  if (!isCreatedSession(value)) throw new AppleAuthClientError("unavailable")
  validateAuthorizationUrl(serviceUrl, value.authorizationUrl)
  return value
}

export async function getAppleAuthorizationSessionStatus(
  serviceUrl: string,
  cliToken: string,
  fetchImpl: Fetch = fetch,
  options: NetworkRequestOptions = {},
): Promise<AppleAuthorizationSessionStatus> {
  const value = await postJson(
    serviceUrl,
    "/v1/apple/auth/sessions/status",
    { cliToken },
    fetchImpl,
    options,
  )
  if (!isSessionStatus(value)) throw new AppleAuthClientError("unavailable")
  return value
}

export async function cancelAppleAuthorizationSession(
  serviceUrl: string,
  cliToken: string,
  fetchImpl: Fetch = fetch,
  options: NetworkRequestOptions = {},
): Promise<void> {
  await postJson(
    serviceUrl,
    "/v1/apple/auth/sessions/cancel",
    { cliToken },
    fetchImpl,
    options,
    true,
  )
}

export async function acknowledgeAppleAuthorizationSession(
  serviceUrl: string,
  cliToken: string,
  fetchImpl: Fetch = fetch,
  options: NetworkRequestOptions = {},
): Promise<void> {
  await postJson(
    serviceUrl,
    "/v1/apple/auth/sessions/acknowledge",
    { cliToken },
    fetchImpl,
    options,
    true,
  )
}

export class AppleAuthorizationClient {
  private pendingCleanup: Promise<void> = Promise.resolve()

  constructor(
    private readonly serviceUrl: string,
    private readonly fetchImpl: Fetch,
    private readonly timeoutMs: number,
    private readonly logger: AuthLogger,
  ) {}

  create(signal: AbortSignal): Promise<AppleAuthorizationSession> {
    return createAppleAuthorizationSession(this.serviceUrl, this.fetchImpl, {
      signal,
      timeoutMs: this.timeoutMs,
    })
  }

  status(
    cliToken: string,
    signal: AbortSignal,
  ): Promise<AppleAuthorizationSessionStatus> {
    return getAppleAuthorizationSessionStatus(
      this.serviceUrl,
      cliToken,
      this.fetchImpl,
      { signal, timeoutMs: this.timeoutMs },
    )
  }

  cancel(cliToken: string, signal?: AbortSignal): Promise<void> {
    return cancelAppleAuthorizationSession(
      this.serviceUrl,
      cliToken,
      this.fetchImpl,
      { signal, timeoutMs: this.timeoutMs },
    )
  }

  cancelDetached(cliToken: string): void {
    this.trackCleanup(this.cancel(cliToken))
  }

  acknowledgeDetached(cliToken: string): void {
    this.trackCleanup(
      acknowledgeAppleAuthorizationSession(
        this.serviceUrl,
        cliToken,
        this.fetchImpl,
        { timeoutMs: this.timeoutMs },
      ).catch(() => this.cancel(cliToken)),
    )
  }

  waitForCleanup(): Promise<void> {
    return this.pendingCleanup
  }

  private trackCleanup(cleanup: Promise<void>): void {
    this.pendingCleanup = Promise.all([
      this.pendingCleanup,
      cleanup.catch(() => {
        this.logger.log("broker_cleanup_failed", { code: "cleanup_failed" })
      }),
    ]).then(() => {})
  }
}

async function postJson(
  serviceUrl: string,
  path: string,
  body: Record<string, string>,
  fetchImpl: Fetch,
  options: NetworkRequestOptions,
  allowEmpty = false,
): Promise<unknown> {
  try {
    return await runWithAbortTimeout(
      async (signal) => {
        const response = await fetchImpl(
          new URL(path, ensureTrailingSlash(serviceUrl)),
          {
            method: "POST",
            headers: {
              accept: "application/json",
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
            redirect: "manual",
            signal,
          },
        )
        if (!response.ok) {
          if (response.status === 401) throw new AppleAuthClientError("unauthorized")
          if (response.status === 410) throw new AppleAuthClientError("expired")
          if (response.status === 409) throw new AppleAuthClientError("conflict")
          throw new AppleAuthClientError("unavailable")
        }
        if (allowEmpty && response.status === 204) return undefined
        return readBoundedJson(response)
      },
      options,
    )
  } catch (error) {
    if (error instanceof AppleAuthClientError) throw error
    throw new AppleAuthClientError("unavailable")
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
    throw new AppleAuthClientError("unavailable")
  }
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new AppleAuthClientError("unavailable")
  }
  const reader = response.body?.getReader()
  if (!reader) throw new AppleAuthClientError("unavailable")
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new AppleAuthClientError("unavailable")
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown
  } catch {
    throw new AppleAuthClientError("unavailable")
  }
}

function isCreatedSession(value: unknown): value is AppleAuthorizationSession {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return (
    isBoundedString(record.cliToken, 4096) &&
    isBoundedString(record.authorizationUrl, 2048) &&
    typeof record.expiresAt === "string" &&
    Number.isFinite(Date.parse(record.expiresAt))
  )
}

function isSessionStatus(value: unknown): value is AppleAuthorizationSessionStatus {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return (
    record.status === "pending" ||
    (record.status === "complete" && isBoundedString(record.musicUserToken, 16 * 1024))
  )
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max
}

function authorizationUrl(serviceUrl: string): string {
  return new URL("/authorize", ensureTrailingSlash(serviceUrl)).toString()
}

function validateAuthorizationUrl(serviceUrl: string, value: string): void {
  try {
    const expected = new URL(authorizationUrl(serviceUrl))
    const actual = new URL(value)
    const fragment = new URLSearchParams(actual.hash.slice(1))
    const browserTokens = fragment.getAll("browserToken")
    if (
      actual.origin !== expected.origin ||
      actual.pathname !== expected.pathname ||
      actual.search !== "" ||
      actual.username !== "" ||
      actual.password !== "" ||
      fragment.size !== 1 ||
      browserTokens.length !== 1 ||
      !isBoundedString(browserTokens[0], 128)
    ) {
      throw new Error()
    }
  } catch {
    throw new AppleAuthClientError("unavailable")
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`
}
