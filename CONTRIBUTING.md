# Contributing to Nutka

Use Bun 1.4.0, the version pinned in `package.json` for development and CI.
Install both packages from the repository root:

```sh
bun install --frozen-lockfile
bun install --frozen-lockfile --cwd services/apple-token
bun run check
```

The tests use fake Apple responses, browser processes, and credential stores.
They need no Apple or Cloudflare account. Loopback-server tests bind temporary
ports on `127.0.0.1`, and signer tests start Cloudflare's local Worker runtime.
Restricted containers must allow those operations.

CI also scans the full Git history with Gitleaks. With Gitleaks 8.30.1 installed,
run `gitleaks git --log-opts="--all" --redact` locally. Before committing, use
`gitleaks git --pre-commit --staged --redact` to scan staged changes. The scanner
configuration excludes only the exact invalid PEM fixture used in a rejection
test; real keys in test files still fail the scan.

## Working on a change

Run `bun run dev` for the empty terminal interface. Live playback setup is in
[Apple Music setup](docs/APPLE_MUSIC.md).

Run a focused test while iterating, then run the full check before submitting:

```sh
bun test src/ui/app/library-controller.test.ts
bun run typecheck
bun run test
bun run signer:check
bun run check
```

When changing dependencies, use `bun install` and commit the relevant `bun.lock`.
The client and signer have separate manifests and lockfiles. Keep both installs
reproducible with `--frozen-lockfile`.

## Code conventions

- Follow the existing TypeScript style: two spaces, double quotes, no semicolons,
  and explicit type imports. `.editorconfig` covers whitespace and line endings.
- Keep modules centered on a responsibility. Extract browser lifecycle, request
  validation, rendering, or a feature controller when it can be understood and
  tested separately. A line-count target alone is not a reason to add a module.
- Keep application state in controllers and display formatting in presenters.
  Provider responses enter the app through typed decoders.
- Validate external data as `unknown`. Avoid `any`, unchecked casts, and silent
  exception handling unless failure is intentionally non-fatal.
- Preserve abort signals and stale-response guards. Playback state comes from
  the worker; do not show a successful operation before it is confirmed.
- Test behavior at public boundaries. Keep feature tests together, share
  stateless fixtures, and create mutable test state separately for each suite.
  Add regression coverage for bugs and run existing tests for refactors.
- Keep credentials out of fixtures, logs, command arguments, and screenshots.
  See [integration boundaries](docs/APPLE_COMPLIANCE.md).

The compiler rejects unused locals, unused parameters, and switch fallthrough
in both packages, in addition to strict type checks. See
[Architecture](docs/ARCHITECTURE.md) before changing module boundaries.

## Pull requests and bug reports

Explain the problem, the resulting behavior, and the checks you ran. Include
terminal dimensions or a redacted screenshot when a layout change needs one.
For bugs, include the commit, OS, Bun version, and reproduction steps. Playback
reports should also name the browser version and audio system.

Do not attach `.env`, `.dev.vars`, keyring contents, or Chromium profile data.
Use [Security](SECURITY.md) for sensitive reports.
