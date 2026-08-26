import {
  requestDeveloperToken,
  runWithAbortTimeout,
  type Fetch,
  type NetworkRequestOptions,
} from "./token-service"

const APPLE_STOREFRONT_URL = "https://api.music.apple.com/v1/me/storefront"
const MAX_RESPONSE_BYTES = 32 * 1024

export type AppleMusicValidationErrorCode = "unauthorized" | "unavailable"

export class AppleMusicValidationError extends Error {
  constructor(
    readonly code: AppleMusicValidationErrorCode,
    readonly definitive = false,
  ) {
    super(
      code === "unauthorized"
        ? "Apple Music authorization could not be verified"
        : "Apple Music validation is unavailable",
    )
    this.name = "AppleMusicValidationError"
  }
}

export interface AppleMusicValidation {
  storefront: string
}

export interface ValidateAppleMusicOptions extends NetworkRequestOptions {
  fetch?: Fetch
}

export async function validateAppleMusicUserToken(
  serviceUrl: string,
  musicUserToken: string,
  options: ValidateAppleMusicOptions = {},
): Promise<AppleMusicValidation> {
  const fetchImpl = options.fetch ?? fetch
  try {
    const developer = await requestDeveloperToken(serviceUrl, fetchImpl, options)
    if (developer.mode !== "apple") {
      throw new AppleMusicValidationError("unavailable")
    }

    return await runWithAbortTimeout(
      async (signal) => {
        const response = await fetchImpl(APPLE_STOREFRONT_URL, {
          method: "GET",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${developer.token}`,
            "music-user-token": musicUserToken,
          },
          redirect: "manual",
          signal,
        })
        if (response.status === 401 || response.status === 403) {
          // This endpoint cannot identify whether the developer JWT or MUT failed.
          throw new AppleMusicValidationError("unauthorized", false)
        }
        if (!response.ok) throw new AppleMusicValidationError("unavailable")

        const value = await readBoundedJson(response)
        if (!isStorefrontResponse(value)) {
          throw new AppleMusicValidationError("unavailable")
        }
        return { storefront: value.data[0].id }
      },
      options,
    )
  } catch (error) {
    if (error instanceof AppleMusicValidationError) throw error
    throw new AppleMusicValidationError("unavailable")
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
    throw new AppleMusicValidationError("unavailable")
  }
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new AppleMusicValidationError("unavailable")
  }
  const reader = response.body?.getReader()
  if (!reader) throw new AppleMusicValidationError("unavailable")
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new AppleMusicValidationError("unavailable")
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
    throw new AppleMusicValidationError("unavailable")
  }
}

function isStorefrontResponse(
  value: unknown,
): value is { data: [{ id: string; type: "storefronts" }] } {
  if (!value || typeof value !== "object") return false
  const data = (value as Record<string, unknown>).data
  if (!Array.isArray(data) || data.length !== 1) return false
  const storefront = data[0]
  if (!storefront || typeof storefront !== "object") return false
  const record = storefront as Record<string, unknown>
  return (
    record.type === "storefronts" &&
    typeof record.id === "string" &&
    /^[a-z]{2}$/.test(record.id)
  )
}
