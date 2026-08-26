export interface DeveloperTokenResponse {
  token: string
  expiresAt: string
  mode: "mock" | "apple"
}

export async function requestDeveloperToken(
  serviceUrl: string,
): Promise<DeveloperTokenResponse> {
  const url = new URL(
    "/v1/apple/developer-token",
    ensureTrailingSlash(serviceUrl),
  )
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  })

  if (!response.ok) {
    throw new Error(`Token service returned HTTP ${response.status}`)
  }

  const value: unknown = await response.json()

  if (!isDeveloperTokenResponse(value)) {
    throw new Error("Token service returned an invalid response")
  }

  return value
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
