import { Hono } from "hono"

import type { Bindings } from "./bindings"
import { isSigningEnabled, loadSigningConfig } from "./config"
import { createRateLimiter } from "./rate-limit"
import { createDeveloperTokenIssuer } from "./token"
import type { DeveloperTokenIssuer } from "./token"

type AppEnvironment = { Bindings: Bindings }

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow",
} as const

export function createApp(): Hono<AppEnvironment> {
  const app = new Hono<AppEnvironment>({ strict: true })
  const issuers = new WeakMap<object, DeveloperTokenIssuer>()

  app.use("*", async (context, next) => {
    await next()
    applySecurityHeaders(context.res.headers)
  })

  app.use("*", async (context, next) => {
    if (context.req.method !== "GET") {
      context.header("allow", "GET")
      return context.json({ error: "Method not allowed" }, 405)
    }
    if (context.req.url.includes("?")) {
      return context.json({ error: "Query strings are not allowed" }, 400)
    }
    await next()
  })

  app.get("/healthz", (context) => context.json({ status: "ok" }))

  app.get("/v1/apple/developer-token", async (context) => {
    if (!isSigningEnabled(context.env)) {
      return context.json({ error: "Token signing is disabled" }, 503)
    }

    let allowed: boolean
    try {
      const clientKey = context.req.header("cf-connecting-ip") ?? "unknown"
      allowed = await createRateLimiter(context.env.RATE_LIMITER).consume(clientKey)
    } catch {
      return context.json({ error: "Token service is unavailable" }, 503)
    }

    if (!allowed) {
      context.header("retry-after", "60")
      return context.json({ error: "Rate limit exceeded" }, 429)
    }

    try {
      let issuer = issuers.get(context.env)
      if (!issuer) {
        issuer = createDeveloperTokenIssuer(loadSigningConfig(context.env))
        issuers.set(context.env, issuer)
      }
      return context.json(await issuer.issue())
    } catch {
      return context.json({ error: "Unable to issue developer token" }, 500)
    }
  })

  app.notFound((context) => context.json({ error: "Not found" }, 404))
  app.onError((_error, context) => {
    const response = context.json({ error: "Internal server error" }, 500)
    applySecurityHeaders(response.headers)
    return response
  })

  return app
}

function applySecurityHeaders(headers: Headers): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value)
  }
}
