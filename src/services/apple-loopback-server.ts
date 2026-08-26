import type { AuthLogDetails, AuthLogger } from "./auth-log"
import {
  AuthorizationBroker,
  AuthorizationBrokerError,
} from "./apple-authorization-broker"
import {
  AUTHORIZE_CSS,
  AUTHORIZE_HTML,
  AUTHORIZE_JS,
  PLAYBACK_HTML,
  PLAYBACK_JS,
} from "./apple-browser-pages"

const LOOPBACK_HOST = "127.0.0.1"
const DEFAULT_PORT = 8787
const DEFAULT_RATE_LIMIT_PER_MINUTE = 30
const AUTHORIZATION_TOKEN_VALIDITY_MS = 5 * 60_000 + 30_000
const MAX_JSON_BODY_BYTES = 8 * 1024
const BROWSER_COOKIE = "nutka_apple_auth"
const AUTH_PATH_PREFIX = "/v1/apple/auth/"

export interface IssuedDeveloperToken {
  token: string
  expiresAt: string
  mode: "mock" | "apple"
}

export interface DeveloperTokenIssuer {
  issue(minimumValidityMs?: number): Promise<IssuedDeveloperToken>
}

export interface AppleLoopbackRequestHandlerOptions {
  issuer: DeveloperTokenIssuer
  port?: number
  rateLimitPerMinute?: number
  allowedOrigin?: string
  logger?: AuthLogger
}

export interface AppleLoopbackServerOptions {
  issuer: DeveloperTokenIssuer
  port?: number
  rateLimitPerMinute?: number
  allowedOrigin?: string
  logger?: AuthLogger
}

export interface AppleLoopbackServer {
  origin: string
  stop(): void
}

export type AppleLoopbackRequestHandler = (
  request: Request,
  clientId?: string,
) => Promise<Response>

export function createAppleLoopbackRequestHandler(
  options: AppleLoopbackRequestHandlerOptions,
): AppleLoopbackRequestHandler {
  const port = validPort(options.port ?? DEFAULT_PORT, false)
  return createHandlerForOrigin(options, `http://${LOOPBACK_HOST}:${port}`)
}

export function startAppleLoopbackServer(
  options: AppleLoopbackServerOptions,
): AppleLoopbackServer {
  const requestedPort = validPort(options.port ?? DEFAULT_PORT, true)
  let handleRequest: AppleLoopbackRequestHandler | undefined
  const server = Bun.serve({
    hostname: LOOPBACK_HOST,
    port: requestedPort,
    fetch(request, server) {
      if (!handleRequest) return json({ error: "Service unavailable" }, 503)
      const clientId = server.requestIP(request)?.address ?? "unknown"
      return handleRequest(request, clientId)
    },
  })
  const origin = `http://${LOOPBACK_HOST}:${server.port}`
  handleRequest = createHandlerForOrigin(options, origin)

  let stopped = false
  return {
    origin,
    stop() {
      if (stopped) return
      stopped = true
      server.stop(true)
    },
  }
}

function createHandlerForOrigin(
  options: Omit<AppleLoopbackRequestHandlerOptions, "port">,
  localOrigin: string,
): AppleLoopbackRequestHandler {
  const rateLimit = validRateLimit(
    options.rateLimitPerMinute ?? DEFAULT_RATE_LIMIT_PER_MINUTE,
  )
  const tokenLimiter = new FixedWindowRateLimiter(rateLimit)
  const authRateLimit = Math.max(10, rateLimit)
  const sessionLimiter = new FixedWindowRateLimiter(authRateLimit)
  const claimLimiter = new FixedWindowRateLimiter(authRateLimit)
  const broker = new AuthorizationBroker(`${localOrigin}/authorize`)
  const logger = options.logger ?? { log() {} }

  return async (request, clientId = "unknown") => {
    const url = new URL(request.url)
    if (!isExactLoopbackUrl(url, localOrigin)) {
      return json({ error: "Not found" }, 404)
    }

    const isAuthPath =
      url.pathname === "/authorize" ||
      url.pathname === "/authorize.js" ||
      url.pathname === "/authorize.css" ||
      url.pathname === "/playback" ||
      url.pathname === "/playback.js" ||
      url.pathname.startsWith(AUTH_PATH_PREFIX)

    if (isAuthPath) {
      const authLimiter =
        url.pathname === "/v1/apple/auth/sessions"
          ? sessionLimiter
          : url.pathname === "/v1/apple/auth/browser/claim"
            ? claimLimiter
            : undefined
      if (
        request.method === "POST" &&
        authLimiter &&
        !authLimiter.consume(clientId)
      ) {
        return json({ error: "Rate limit exceeded" }, 429)
      }
      return handleAuthorizationRequest(
        request,
        url,
        localOrigin,
        options.issuer,
        broker,
        logger,
      )
    }

    const corsHeaders = getCorsHeaders(request, options.allowedOrigin)
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
      return json({ status: "ok", mode: "apple" }, 200, corsHeaders)
    }
    if (url.pathname === "/v1/apple/developer-token") {
      if (!tokenLimiter.consume(clientId)) {
        return json({ error: "Rate limit exceeded" }, 429, corsHeaders)
      }
      try {
        return json(await options.issuer.issue(), 200, corsHeaders)
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
        const issued = await issuer.issue(AUTHORIZATION_TOKEN_VALIDITY_MS)
        const session = broker.create(issued.token)
        logAuth(logger, "session_created")
        return json(session, 201)
      }
      case "/v1/apple/auth/sessions/status": {
        const cliToken = requiredString(parsed, "cliToken")
        const status = broker.status(cliToken)
        if (status.status === "complete") {
          logAuth(logger, "authorization_delivered")
        }
        return json(status, 200)
      }
      case "/v1/apple/auth/sessions/acknowledge": {
        broker.acknowledge(requiredString(parsed, "cliToken"))
        logAuth(logger, "authorization_acknowledged")
        return new Response(null, { status: 204, headers: secureHeaders() })
      }
      case "/v1/apple/auth/sessions/cancel": {
        broker.cancel(requiredString(parsed, "cliToken"))
        logAuth(logger, "session_cancelled")
        return new Response(null, { status: 204, headers: secureHeaders() })
      }
      case "/v1/apple/auth/browser/claim": {
        if (!hasExactOrigin(request, localOrigin)) {
          return json({ error: "Forbidden" }, 403)
        }
        const claim = broker.claim(requiredString(parsed, "browserToken"))
        logAuth(logger, "browser_connected")
        const response = json(
          {
            csrfToken: claim.csrfToken,
            developerToken: claim.developerToken,
          },
          200,
        )
        response.headers.append(
          "set-cookie",
          `${BROWSER_COOKIE}=${claim.browserToken}; HttpOnly; SameSite=Strict; Path=/v1/apple/auth/browser; Max-Age=300`,
        )
        return response
      }
      case "/v1/apple/auth/browser/complete": {
        if (!hasExactOrigin(request, localOrigin)) {
          return json({ error: "Forbidden" }, 403)
        }
        const browserToken = exactCookie(request, BROWSER_COOKIE)
        if (!browserToken) {
          return json(
            { error: "Authorization session is not available" },
            401,
          )
        }
        broker.complete(
          browserToken,
          requiredString(parsed, "csrfToken"),
          requiredString(parsed, "musicUserToken"),
        )
        logAuth(logger, "browser_authorization_completed")
        const response = json({ status: "complete" }, 200)
        response.headers.append(
          "set-cookie",
          `${BROWSER_COOKIE}=; HttpOnly; SameSite=Strict; Path=/v1/apple/auth/browser; Max-Age=0`,
        )
        return response
      }
      case "/v1/apple/auth/browser/event": {
        if (!hasExactOrigin(request, localOrigin)) {
          return json({ error: "Forbidden" }, 403)
        }
        const browserToken = exactCookie(request, BROWSER_COOKIE)
        if (!browserToken) {
          return json(
            { error: "Authorization session is not available" },
            401,
          )
        }
        const event = requiredString(parsed, "event")
        if (!BROWSER_EVENTS.has(event)) throw new InvalidRequestError()
        const code =
          parsed.code === undefined ? undefined : safeDiagnosticCode(parsed.code)
        logAuth(logger, event, code ? { code } : undefined)
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
      logAuth(logger, "authorization_request_failed", {
        code: error.code,
        httpStatus: status,
      })
      return json({ error: error.message }, status)
    }
    if (error instanceof InvalidRequestError) {
      logAuth(logger, "authorization_request_failed", {
        code: "invalid_request",
        httpStatus: 400,
      })
      return json({ error: "Invalid request" }, 400)
    }
    logAuth(logger, "authorization_request_failed", {
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

class FixedWindowRateLimiter {
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
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error()
    }
    return body as Record<string, unknown>
  } catch {
    return json({ error: "Invalid JSON body" }, 400)
  }
}

function isExactLoopbackUrl(url: URL, localOrigin: string): boolean {
  return (
    url.origin === localOrigin &&
    url.protocol === "http:" &&
    url.hostname === LOOPBACK_HOST &&
    url.username === "" &&
    url.password === ""
  )
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

function logAuth(
  logger: AuthLogger,
  event: string,
  details?: AuthLogDetails,
): void {
  try {
    logger.log(event, details)
  } catch {
    // Diagnostics must not interrupt authorization.
  }
}

function validPort(port: number, allowZero: boolean): number {
  const minimum = allowZero ? 0 : 1
  if (!Number.isInteger(port) || port < minimum || port > 65_535) {
    throw new TypeError(`port must be an integer from ${minimum} to 65535`)
  }
  return port
}

function validRateLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
    throw new TypeError("rateLimitPerMinute must be an integer from 1 to 10000")
  }
  return limit
}
