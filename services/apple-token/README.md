# Nuta Apple token service

This stateless service issues short-lived Apple Music developer tokens without
putting the Apple private key in the open-source Nuta client.

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
NUTA_TOKEN_SERVICE_MODE=apple
APPLE_TEAM_ID=your-team-id
APPLE_KEY_ID=your-key-id
APPLE_PRIVATE_KEY_PATH=/absolute/path/to/AuthKey_KEYID.p8
```

Run `bun run dev:apple` from that configured environment. Never commit the
`.p8` key or place it in the Nuta client. The service does not log issued
tokens.

## Endpoints

- `GET /health`
- `GET /v1/apple/developer-token`

The in-memory rate limiter is suitable for local development and a single Bun
process. A multi-instance deployment must replace it with a shared limiter or a
platform-provided equivalent.
