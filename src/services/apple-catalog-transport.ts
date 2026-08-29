import type { SearchOptions } from "../core/types"
import { AppleCatalogError } from "./apple-catalog-error"
import {
  requestDeveloperToken,
  runWithAbortTimeout,
  type Fetch,
} from "./token-service"

const MAX_RESPONSE_BYTES = 512 * 1024

export interface AppleCatalogTransportOptions {
  fetch: Fetch
  timeoutMs?: number
  useMusicUserToken?: <T>(
    use: (musicUserToken: string) => T | Promise<T>,
  ) => Promise<T>
}

export class AppleCatalogTransport {
  constructor(
    private readonly serviceUrl: string,
    private readonly options: AppleCatalogTransportOptions,
  ) {}

  requestCatalog<T>(
    options: Pick<SearchOptions, "signal">,
    operation: (developerToken: string, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    return this.withMappedErrors(options, async (signal) => {
      const developer = await requestDeveloperToken(
        this.serviceUrl,
        this.options.fetch,
        { signal, timeoutMs: this.options.timeoutMs },
      )
      if (developer.mode !== "apple") throw new AppleCatalogError("unavailable")
      return operation(developer.token, signal)
    })
  }

  requestPersonalized<T>(
    options: Pick<SearchOptions, "signal">,
    operation: (
      developerToken: string,
      musicUserToken: string,
      signal: AbortSignal,
    ) => Promise<T>,
  ): Promise<T> {
    return this.requestCatalog(options, async (developerToken, signal) => {
      if (!this.options.useMusicUserToken) throw new AppleCatalogError("unavailable")
      return this.options.useMusicUserToken((musicUserToken) =>
        operation(developerToken, musicUserToken, signal)
      )
    })
  }

  async requestJson(
    url: URL,
    developerToken: string,
    signal: AbortSignal,
    musicUserToken?: string,
  ): Promise<unknown> {
    const response = await this.options.fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${developerToken}`,
        ...(musicUserToken ? { "music-user-token": musicUserToken } : {}),
      },
      redirect: "manual",
      signal,
    })
    if (!response.ok) throw new AppleCatalogError("unavailable")
    return readBoundedJson(response)
  }

  async requestOptionalJson(
    url: URL,
    developerToken: string,
    musicUserToken: string,
    signal: AbortSignal,
  ): Promise<unknown | null> {
    const response = await this.options.fetch(url, {
      method: "GET",
      headers: requestHeaders(developerToken, musicUserToken),
      redirect: "manual",
      signal,
    })
    if (response.status === 404) return null
    if (!response.ok) throw new AppleCatalogError("unavailable")
    return readBoundedJson(response)
  }

  async requestRatingUpdate(
    url: URL,
    method: "PUT" | "DELETE",
    developerToken: string,
    musicUserToken: string,
    signal: AbortSignal,
    rating?: -1 | 1,
  ): Promise<void> {
    const response = await this.options.fetch(url, {
      method,
      headers: {
        ...requestHeaders(developerToken, musicUserToken),
        ...(method === "PUT" ? { "content-type": "application/json" } : {}),
      },
      ...(method === "PUT"
        ? { body: JSON.stringify({ type: "rating", attributes: { value: rating } }) }
        : {}),
      redirect: "manual",
      signal,
    })
    if (!response.ok && !(method === "DELETE" && response.status === 404)) {
      throw new AppleCatalogError("unavailable")
    }
  }

  private async withMappedErrors<T>(
    options: Pick<SearchOptions, "signal">,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    try {
      return await runWithAbortTimeout(operation, {
        signal: options.signal,
        timeoutMs: this.options.timeoutMs,
      })
    } catch (error) {
      if (error instanceof AppleCatalogError) throw error
      if (error instanceof Error && error.message === "Operation aborted") {
        throw new AppleCatalogError("aborted")
      }
      if (error instanceof Error && error.message === "Operation timed out") {
        throw new AppleCatalogError("timeout")
      }
      throw new AppleCatalogError("unavailable")
    }
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
    throw new AppleCatalogError("invalid_response")
  }
  const declaredLength = response.headers.get("content-length")
  if (declaredLength !== null) {
    const length = Number(declaredLength)
    if (!Number.isFinite(length) || length < 0 || length > MAX_RESPONSE_BYTES) {
      throw new AppleCatalogError("invalid_response")
    }
  }
  if (!response.body) throw new AppleCatalogError("invalid_response")

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new AppleCatalogError("invalid_response")
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown
  } catch (error) {
    if (error instanceof AppleCatalogError) throw error
    throw new AppleCatalogError("invalid_response")
  }
}

function requestHeaders(
  developerToken: string,
  musicUserToken: string,
): Record<string, string> {
  return {
    accept: "application/json",
    authorization: `Bearer ${developerToken}`,
    "music-user-token": musicUserToken,
  }
}
