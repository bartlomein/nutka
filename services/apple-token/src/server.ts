import type { TokenServiceConfig } from "./config"
import {
  AuthorizationBroker,
  AuthorizationBrokerError,
} from "./authorization-broker"
import { AUTHORIZE_CSS, AUTHORIZE_HTML, AUTHORIZE_JS } from "./authorize-page"
import { PLAYBACK_HTML, PLAYBACK_JS } from "./playback-page"
import { FixedWindowRateLimiter } from "./rate-limit"
import type { DeveloperTokenIssuer } from "./token"
import type { AuthLogger } from "../../../src/services/auth-log"

const MAX_JSON_BODY_BYTES = 8 * 1024
const BROWSER_COOKIE = "nuta_apple_auth"
const AUTH_PATH_PREFIX = "/v1/apple/auth/"

export function createRequestHandler(
  config: TokenServiceConfig,
  issuer: DeveloperTokenIssuer,
  limiter = new FixedWindowRateLimiter(config.rateLimitPerMinute),
  broker = new AuthorizationBroker(
    `http://127.0.0.1:${config.port}/authorize`,
  ),
  logger: AuthLogger = { log() {} },
): (request: Request, clientId?: string) => Promise<Response> {
  const authRateLimit = Math.max(10, config.rateLimitPerMinute)
  const sessionLimiter = new FixedWindowRateLimiter(authRateLimit)
  const claimLimiter = new FixedWindowRateLimiter(authRateLimit)
  return async (request, clientId = "unknown") => {
    const url = new URL(request.url)
    const localOrigin = `http://127.0.0.1:${config.port}`
    const isAuthPath =
      url.pathname === "/authorize" ||
      url.pathname === "/authorize.js" ||
      url.pathname === "/authorize.css" ||
      url.pathname === "/playback" ||
      url.pathname === "/playback.js" ||
      url.pathname.startsWith(AUTH_PATH_PREFIX)
    const authEnabled =
      config.mode === "apple" &&
      config.host === "127.0.0.1" &&
      url.origin === localOrigin

    if (isAuthPath) {
      if (!authEnabled) return json({ error: "Not found" }, 404)
      const authLimiter =
        url.pathname === "/v1/apple/auth/sessions"
          ? sessionLimiter
          : url.pathname === "/v1/apple/auth/browser/claim"
            ? claimLimiter
            : undefined
      if (request.method === "POST" && authLimiter && !authLimiter.consume(clientId)) {
        return json({ error: "Rate limit exceeded" }, 429)
      }
      return handleAuthorizationRequest(request, url, localOrigin, issuer, broker, logger)
    }

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

async function handleAuthorizationRequest(
  request: Request,
  url: URL,
  localOrigin: string,
  issuer: DeveloperTokenIssuer,
  broker: AuthorizationBroker,
  logger: AuthLogger,
): Promise<Response> {
  if (url.pathname === "/authorize") {
    return request.method === "GET"
      ? staticResponse(AUTHORIZE_HTML, "text/html; charset=utf-8")
      : json({ error: "Method not allowed" }, 405)
  }
  if (url.pathname === "/authorize.js") {
    return request.method === "GET"
      ? staticResponse(AUTHORIZE_JS, "text/javascript; charset=utf-8")
      : json({ error: "Method not allowed" }, 405)
  }
  if (url.pathname === "/authorize.css") {
    return request.method === "GET"
      ? staticResponse(AUTHORIZE_CSS, "text/css; charset=utf-8")
      : json({ error: "Method not allowed" }, 405)
  }
  if (url.pathname === "/playback") {
    return request.method === "GET"
      ? playbackStaticResponse(PLAYBACK_HTML, "text/html; charset=utf-8")
      : json({ error: "Method not allowed" }, 405)
  }
  if (url.pathname === "/playback.js") {
    return request.method === "GET"
      ? playbackStaticResponse(PLAYBACK_JS, "text/javascript; charset=utf-8")
      : json({ error: "Method not allowed" }, 405)
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405)
  }

  const parsed = await readJsonObject(request)
  if (parsed instanceof Response) return parsed

  try {
    switch (url.pathname) {
      case "/v1/apple/auth/sessions": {
        const issued = await issuer.issue()
        const session = broker.create(issued.token)
        logger.log("session_created")
        return json(session, 201)
      }
      case "/v1/apple/auth/sessions/status": {
        const cliToken = requiredString(parsed, "cliToken")
        const status = broker.status(cliToken)
        if (status.status === "complete") logger.log("authorization_delivered")
        return json(status, 200)
      }
      case "/v1/apple/auth/sessions/acknowledge": {
        broker.acknowledge(requiredString(parsed, "cliToken"))
        logger.log("authorization_acknowledged")
        return new Response(null, { status: 204, headers: secureHeaders() })
      }
      case "/v1/apple/auth/sessions/cancel": {
        const cliToken = requiredString(parsed, "cliToken")
        broker.cancel(cliToken)
        logger.log("session_cancelled")
        return new Response(null, { status: 204, headers: secureHeaders() })
      }
      case "/v1/apple/auth/browser/claim": {
        if (!hasExactOrigin(request, localOrigin)) return json({ error: "Forbidden" }, 403)
        const claim = broker.claim(requiredString(parsed, "browserToken"))
        logger.log("browser_connected")
        const response = json(
          { csrfToken: claim.csrfToken, developerToken: claim.developerToken },
          200,
        )
        response.headers.append(
          "set-cookie",
          `${BROWSER_COOKIE}=${claim.browserToken}; HttpOnly; SameSite=Strict; Path=/v1/apple/auth/browser; Max-Age=300`,
        )
        return response
      }
      case "/v1/apple/auth/browser/complete": {
        if (!hasExactOrigin(request, localOrigin)) return json({ error: "Forbidden" }, 403)
        const browserToken = exactCookie(request, BROWSER_COOKIE)
        if (!browserToken) return json({ error: "Authorization session is not available" }, 401)
        broker.complete(
          browserToken,
          requiredString(parsed, "csrfToken"),
          requiredString(parsed, "musicUserToken"),
        )
        logger.log("browser_authorization_completed")
        const response = json({ status: "complete" }, 200)
        response.headers.append(
          "set-cookie",
          `${BROWSER_COOKIE}=; HttpOnly; SameSite=Strict; Path=/v1/apple/auth/browser; Max-Age=0`,
        )
        return response
      }
      case "/v1/apple/auth/browser/event": {
        if (!hasExactOrigin(request, localOrigin)) return json({ error: "Forbidden" }, 403)
        const browserToken = exactCookie(request, BROWSER_COOKIE)
        if (!browserToken) return json({ error: "Authorization session is not available" }, 401)
        const event = requiredString(parsed, "event")
        if (!BROWSER_EVENTS.has(event)) throw new InvalidRequestError()
        const code = parsed.code === undefined ? undefined : safeDiagnosticCode(parsed.code)
        logger.log(event, code ? { code } : undefined)
        return new Response(null, { status: 204, headers: secureHeaders() })
      }
      default:
        return json({ error: "Not found" }, 404)
    }
  } catch (error) {
    if (error instanceof AuthorizationBrokerError) {
      const status =
        error.code === "expired"
          ? 410
          : error.code === "invalid_session"
            ? 401
            : error.code === "capacity"
              ? 429
              : 409
      logger.log("authorization_request_failed", {
        code: error.code,
        httpStatus: status,
      })
      return json({ error: error.message }, status)
    }
    if (error instanceof InvalidRequestError) {
      logger.log("authorization_request_failed", {
        code: "invalid_request",
        httpStatus: 400,
      })
      return json({ error: "Invalid request" }, 400)
    }
    logger.log("authorization_request_failed", {
      code: "internal_error",
      httpStatus: 500,
    })
    return json({ error: "Unable to process authorization request" }, 500)
  }
}

class InvalidRequestError extends Error {}

const BROWSER_EVENTS = new Set([
  "musickit_configured",
  "apple_approval_started",
  "apple_approval_failed",
  "completion_send_started",
  "completion_send_failed",
])

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
    throw new InvalidRequestError()
  }
  return value
}

function safeDiagnosticCode(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9_.:-]{1,64}$/i.test(value)) {
    throw new InvalidRequestError()
  }
  return value
}

async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  const contentType = request.headers.get("content-type")
  if (!contentType || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return json({ error: "Content-Type must be application/json" }, 415)
  }

  const declaredLength = Number(request.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    return json({ error: "Request body is too large" }, 413)
  }

  const reader = request.body?.getReader()
  if (!reader) return json({ error: "Invalid JSON body" }, 400)
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_JSON_BODY_BYTES) {
      await reader.cancel()
      return json({ error: "Request body is too large" }, 413)
    }
    chunks.push(value)
  }

  try {
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error()
    return body as Record<string, unknown>
  } catch {
    return json({ error: "Invalid JSON body" }, 400)
  }
}

function hasExactOrigin(request: Request, localOrigin: string): boolean {
  return request.headers.get("origin") === localOrigin
}

function exactCookie(request: Request, name: string): string | undefined {
  const values = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1))
  return values.length === 1 && values[0] ? values[0] : undefined
}

function staticResponse(body: string, contentType: string): Response {
  const headers = secureHeaders()
  headers.set("content-type", contentType)
  // MusicKit authorization requires Apple to receive the page origin.
  headers.set("referrer-policy", "strict-origin-when-cross-origin")
  headers.set(
    "content-security-policy",
    "default-src 'none'; script-src 'self' https://js-cdn.music.apple.com; connect-src 'self' https://*.music.apple.com https://*.apple.com; img-src https: data:; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  )
  headers.set("x-frame-options", "DENY")
  return new Response(body, { status: 200, headers })
}

function playbackStaticResponse(body: string, contentType: string): Response {
  const headers = secureHeaders()
  headers.set("content-type", contentType)
  headers.set("referrer-policy", "strict-origin-when-cross-origin")
  headers.set(
    "content-security-policy",
    "default-src 'none'; script-src 'self' https://js-cdn.music.apple.com; connect-src 'self' https://*.music.apple.com https://*.apple.com https://*.mzstatic.com; media-src blob: https://*.apple.com https://*.mzstatic.com; worker-src blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  )
  headers.set("x-frame-options", "DENY")
  return new Response(body, { status: 200, headers })
}

function secureHeaders(): Headers {
  return new Headers({
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  })
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
  headers.set("referrer-policy", "no-referrer")
  headers.set("x-content-type-options", "nosniff")
  return new Response(JSON.stringify(body), { status, headers })
}
