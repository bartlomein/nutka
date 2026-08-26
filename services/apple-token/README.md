# Nutka Apple token service

This service issues short-lived Apple Music developer tokens without putting the
Apple private key in the open-source Nutka client. Authorization capabilities,
rate limits, and browser sessions are held only in memory.

## Local mock mode

From the repository root:

```sh
bun run dev:apple
```

Mock mode is the default. It proves the client-to-service connection without
requiring an Apple Developer account, and it does not produce an Apple-valid
token.

## Real Apple mode

Copy `services/apple-token/.env.example` to an untracked `.env` at the
repository root, then set:

```sh
NUTKA_TOKEN_SERVICE_MODE=apple
APPLE_TEAM_ID=your-team-id
APPLE_KEY_ID=your-key-id
APPLE_PRIVATE_KEY_PATH=/absolute/path/to/AuthKey_KEYID.p8
```

Run `bun run dev:apple` from that configured environment. Never commit the
`.p8` key or place it in the Nutka client. The service does not log issued
tokens.

## Endpoints

- `GET /health`
- `GET /v1/apple/developer-token`
- `GET /authorize`
- `GET /playback`
- `POST /v1/apple/auth/sessions`
- `POST /v1/apple/auth/sessions/status`
- `POST /v1/apple/auth/sessions/acknowledge`
- `POST /v1/apple/auth/sessions/cancel`
- Browser-only claim and completion endpoints under `/v1/apple/auth/browser/`

## Local authorization

Authorization routes are available only in Apple mode when the service binds
exactly to `127.0.0.1`. Nutka creates a five-minute session and opens the
localhost `/authorize` page with a 256-bit one-time capability in the URL
fragment. The browser removes that fragment from its history immediately,
claims the session automatically, then runs Apple-hosted MusicKit JS. URL
fragments are not sent in HTTP requests or normal server access logs.

The Music User Token is posted in a protected request body, delivered only to
the capability-holding Nutka process, validated against Apple's storefront
endpoint, and stored in the operating-system credential manager. Nutka then
acknowledges the session so the broker can erase it. It is never placed in a URL
or logged by the service.

Secret-safe authorization events are appended to
`$XDG_STATE_HOME/nutka/auth.log` (falling back to
`~/.local/state/nutka/auth.log`). Entries contain no URLs, request bodies,
headers, capabilities, or Apple tokens.

The loopback-only `/playback` page is a static MusicKit host for Nutka's headless
playback worker and standalone proof. It contains no credentials and cannot
authorize an account. The worker injects short-lived credentials through
Chromium's private automation pipe after the page loads. MusicKit authorization
is performed once in a dedicated browser profile with
`bun run playback:authorize`; later TUI and probe runs reuse that mode-`0700`
profile without showing a window.

The in-memory rate limiter is suitable for local development and a single Bun
process. A multi-instance deployment must replace it with a shared limiter or a
platform-provided equivalent.
