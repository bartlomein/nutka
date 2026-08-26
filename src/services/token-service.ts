export interface DeveloperTokenResponse {
  token: string
  expiresAt: string
  mode: "mock" | "apple"
}

const MAX_RESPONSE_BYTES = 32 * 1024
export const DEFAULT_NETWORK_TIMEOUT_MS = 10_000

export type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export interface NetworkRequestOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export type DeveloperTokenErrorCode = "unavailable" | "invalid_response"

export class DeveloperTokenError extends Error {
  constructor(readonly code: DeveloperTokenErrorCode) {
    super(
      code === "invalid_response"
        ? "Token service returned an invalid response"
        : "Token service is unavailable",
    )
    this.name = "DeveloperTokenError"
  }
}

export async function requestDeveloperToken(
  serviceUrl: string,
  fetchImpl: Fetch = fetch,
  options: NetworkRequestOptions = {},
): Promise<DeveloperTokenResponse> {
  try {
    return await runWithAbortTimeout(
      async (signal) => {
        const url = new URL(
          "/v1/apple/developer-token",
          ensureTrailingSlash(serviceUrl),
        )
        const response = await fetchImpl(url, {
          headers: { accept: "application/json" },
          redirect: "manual",
          signal,
        })
        if (!response.ok) throw new DeveloperTokenError("unavailable")

        const value = await readBoundedJson(response, MAX_RESPONSE_BYTES)
        if (!isDeveloperTokenResponse(value)) {
          throw new DeveloperTokenError("invalid_response")
        }
        return value
      },
      options,
    )
  } catch (error) {
    if (error instanceof DeveloperTokenError) throw error
    throw new DeveloperTokenError("unavailable")
  }
}

export function runWithAbortTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: NetworkRequestOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new TypeError("timeoutMs must be positive"))
  }

  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController()
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", abort)
      callback()
    }
    const abort = () => {
      controller.abort()
      finish(() => reject(new Error("Operation aborted")))
    }
    const timer = setTimeout(() => {
      controller.abort()
      finish(() => reject(new Error("Operation timed out")))
    }, timeoutMs)

    if (options.signal?.aborted) {
      abort()
      return
    }
    options.signal?.addEventListener("abort", abort, { once: true })
    Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) throw new Error("Operation aborted")
        return operation(controller.signal)
      })
      .then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      )
  })
}

async function readBoundedJson(response: Response, limit: number): Promise<unknown> {
  if (!isJsonContentType(response.headers.get("content-type"))) {
    throw new DeveloperTokenError("invalid_response")
  }
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new DeveloperTokenError("invalid_response")
  }

  const reader = response.body?.getReader()
  if (!reader) throw new DeveloperTokenError("invalid_response")
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > limit) {
      await reader.cancel()
      throw new DeveloperTokenError("invalid_response")
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
    throw new DeveloperTokenError("invalid_response")
  }
}

function isJsonContentType(value: string | null): boolean {
  return value !== null && /^application\/json(?:\s*;|$)/i.test(value)
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`
}

function isDeveloperTokenResponse(
  value: unknown,
): value is DeveloperTokenResponse {
  if (!value || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.token === "string" &&
    candidate.token.length > 0 &&
    typeof candidate.expiresAt === "string" &&
    !Number.isNaN(Date.parse(candidate.expiresAt)) &&
    (candidate.mode === "mock" || candidate.mode === "apple")
  )
}
