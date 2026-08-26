# Deploy the Apple signer

The signer is the only Nutka component deployed to Cloudflare. It issues
short-lived Apple Music developer tokens and never receives Music User Tokens,
Apple passwords, authorization capabilities, or playback data.

## Local verification

Install and check the Worker package from the repository root:

```sh
bun install --cwd services/apple-token
bun run signer:check
```

For live local signing, create the ignored
`services/apple-token/.dev.vars` file described in
[`services/apple-token/README.md`](../services/apple-token/README.md). Then run:

```sh
bun run signer:dev
```

The local signer listens on `http://127.0.0.1:8788`. Nutka's embedded browser
service uses the separate fixed origin `http://127.0.0.1:8787`.

## Cloudflare setup

Run Wrangler commands from `services/apple-token` after signing in to the
Cloudflare account:

```sh
bunx wrangler login
bunx wrangler secret put APPLE_TEAM_ID
bunx wrangler secret put APPLE_KEY_ID
bunx wrangler secret put APPLE_PRIVATE_KEY
bunx wrangler secret put SIGNING_ENABLED
bun run check
bun run deploy
```

Enter `true` for `SIGNING_ENABLED` only after the other bindings are present.
Paste the PKCS#8 `.p8` contents through Wrangler's interactive prompt. Do not put
the key in `wrangler.jsonc`, a shell argument, CI output, or GitHub secrets used
by pull requests.

The initial deployment uses the generated `workers.dev` hostname. Once the
Cloudflare zone is active, attach a custom domain such as `api.nutka.fm`, disable
the production `workers.dev` route, and set that HTTPS origin as Nutka's
`NUTKA_APPLE_SIGNER_URL` release default.

## Smoke test

Check `/healthz` first. Then request one developer token and verify the response
has `token`, `expiresAt`, and `mode: "apple"` without printing or storing the
token in CI logs. Unknown routes, query strings, and methods must remain
rejected.

Before public distribution, confirm the architecture with Apple Developer
Support, configure Cloudflare traffic alerts, and test the `SIGNING_ENABLED`
kill switch and Apple key rotation.
