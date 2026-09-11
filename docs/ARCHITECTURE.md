# Architecture

Nutka has two packages. The root package runs the terminal client with Bun.
`services/apple-token` runs the developer-token signer as a Cloudflare Worker.
They have separate dependency manifests and lockfiles.

## Source map

| Location | Responsibility |
| --- | --- |
| `src/index.ts` | Creates services, connects callbacks to the UI, and shuts down resources. |
| `src/core/` | Provider and track types, navigation, filtering, queue state. |
| `src/ui/app.ts` | Connects feature controllers, interaction, and view updates. |
| `src/ui/app/*-controller.ts` | Search, browsing, library, playlists, radio, playback sessions, and keyboard interaction. |
| `src/ui/app/*-presenter.ts` | Formats application state into terminal content. |
| `src/ui/app/view.ts`, `renderables.ts` | Creates and updates OpenTUI renderables. |
| `src/ui/visualizer/` | Spectrum rendering, palettes, preferences, and settings UI. |
| `src/services/apple-auth/` | Authorization state machine, broker client, and browser lifecycle. |
| `src/services/apple-catalog.ts` | Typed Apple Music catalog, library, and rating operations. |
| `src/services/apple-catalog-*`, `apple-library-decoders.ts` | Response decoding, HTTP transport, and validated pagination. |
| `src/services/apple-playback*` | Playback controller, worker protocol, worker runtime, and browser host. |
| `src/services/chromium-process.ts` | Restricted Chromium environment, profile paths, and process inspection. |
| `src/services/apple-loopback-server.ts` | Loopback-only browser authorization and playback routes. |
| `src/services/credentials.ts` | Linux Secret Service credential adapter. |
| `scripts/` | Development launchers, environment filtering, and playback probe. |
| `services/apple-token/src/` | Worker routing, configuration, rate limiting, and ES256 token signing. |

## Runtime flow

The entry point creates the loopback server and auth manager when a signer URL
is configured. The auth manager validates the Apple session before it saves
credentials in the OS keyring. The catalog provider uses those credentials
through a callback so UI state never needs to hold a Music User Token.

Feature controllers own asynchronous requests, cancellation, pagination, and
selection. Presenters read their state and format terminal content. The app
module connects these pieces and owns their shared lifecycle.

Playback runs in a supervised child process. The controller and worker exchange
bounded, validated messages through private pipes. Chromium runs MusicKit in a
dedicated profile. Confirmed worker snapshots update the UI. PipeWire analysis
is optional and cannot prevent playback when capture fails.

The Cloudflare signer only issues developer tokens. It does not receive user
credentials or run the browser login flow. See
[integration boundaries](APPLE_COMPLIANCE.md) before changing authentication,
logging, browser transport, or audio capture.

The diagnostic playback probe uses the same browser adapter and Chromium
process helpers as normal playback. Production services import those shared
modules directly, so they do not depend on the diagnostic probe.

## Tests

Client tests use Bun and live beside the modules they exercise. Larger
integration suites are grouped by feature and share fixture builders without
sharing mutable application instances. Signer tests use Vitest and Cloudflare's
local runtime in `services/apple-token/test`.

`bun run check` runs both typechecks and both test suites. Automated tests cover
mocked browser behavior; real MusicKit login, DRM playback, and system audio
still need the manual probe described in [Apple Music setup](APPLE_MUSIC.md).
