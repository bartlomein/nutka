import type { TokenServiceConfig } from "./config"
import { FixedWindowRateLimiter } from "./rate-limit"
import type { DeveloperTokenIssuer } from "./token"

export function createRequestHandler(
  config: TokenServiceConfig,
  issuer: DeveloperTokenIssuer,
  limiter = new FixedWindowRateLimiter(config.rateLimitPerMinute),
): (request: Request, clientId?: string) => Promise<Response> {
  return async (request, clientId = "unknown") => {
    const url = new URL(request.url)
    const corsHeaders = getCorsHeaders(request, config.allowedOrigin)

    if (corsHeaders === null) {
      return json({ error: "Origin is not allowed" }, 403)
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405, corsHeaders)
    }

    if (url.pathname === "/health") {
      return json({ status: "ok", mode: config.mode }, 200, corsHeaders)
    }

    if (url.pathname === "/v1/apple/developer-token") {
      if (!limiter.consume(clientId)) {
        return json({ error: "Rate limit exceeded" }, 429, corsHeaders)
      }

      try {
        return json(await issuer.issue(), 200, corsHeaders)
      } catch {
        return json(
          { error: "Unable to issue developer token" },
          500,
          corsHeaders,
        )
      }
    }

    return json({ error: "Not found" }, 404, corsHeaders)
  }
}

function getCorsHeaders(
  request: Request,
  allowedOrigin: string | undefined,
): Headers | null {
  const origin = request.headers.get("origin")
  if (origin && allowedOrigin && origin !== allowedOrigin) return null

  const headers = new Headers()
  if (origin && allowedOrigin === origin) {
    headers.set("access-control-allow-origin", origin)
    headers.set("access-control-allow-methods", "GET, OPTIONS")
    headers.set("access-control-allow-headers", "accept")
    headers.set("vary", "Origin")
  }
  return headers
}

function json(
  body: unknown,
  status: number,
  additionalHeaders?: Headers,
): Response {
  const headers = new Headers(additionalHeaders)
  headers.set("cache-control", "no-store")
  headers.set("content-type", "application/json; charset=utf-8")
  headers.set("x-content-type-options", "nosniff")
  return new Response(JSON.stringify(body), { status, headers })
}
