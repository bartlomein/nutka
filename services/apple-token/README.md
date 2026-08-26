# Nutka Apple developer-token signer

This Cloudflare Worker issues short-lived Apple Music developer tokens. It has
two routes and does not handle browser authorization, playback, or Music User
Tokens.

## Routes

- `GET /healthz`
- `GET /v1/apple/developer-token`

Other methods and query strings are rejected. Responses do not include CORS
headers and always use `Cache-Control: no-store` plus hardened browser headers.

The token response remains:

```json
{
  "token": "<ES256 JWT>",
  "expiresAt": "<ISO 8601 timestamp>",
  "mode": "apple"
}
```

## Configuration

Cloudflare supplies all runtime configuration as Worker bindings:

- `APPLE_TEAM_ID`
- `APPLE_KEY_ID`
- `APPLE_PRIVATE_KEY`, the contents of the Apple `.p8` PKCS#8 private key
- `APPLE_TOKEN_TTL_SECONDS`, optional, defaults to `900` and must be an integer
  from `360` through `3600`
- `SIGNING_ENABLED`, which must equal `true` before the signing route works
- `RATE_LIMITER`, configured in `wrangler.jsonc` at 30 requests per minute

Keep `SIGNING_ENABLED` false until the bindings are configured. Store production
credentials with Wrangler rather than in `wrangler.jsonc`:

```sh
bunx wrangler secret put APPLE_TEAM_ID
bunx wrangler secret put APPLE_KEY_ID
bunx wrangler secret put APPLE_PRIVATE_KEY
bunx wrangler secret put SIGNING_ENABLED
```

For local development, create an untracked `.dev.vars` from the placeholders in
`.dev.vars.example`, then run `bun run dev` from this directory. Do not commit a
real `.p8` key or an enabled `.dev.vars` file.

## Verification and deployment

```sh
bun install
bun run check
bun run deploy
```

Cloudflare's rate-limit counters are local to each Cloudflare location and are
eventually consistent. The Worker fails closed if the binding call fails.
