# Nutka

A keyboard-first terminal music player built with Bun, TypeScript, and OpenTUI.
Apple Music is the first provider.

Nutka supports catalog search, saved songs and playlists, artist and album
browsing, radio, and a playback queue. Login opens Chromium once. Normal playback
uses a hidden worker, with an optional PipeWire spectrum visualizer on Linux.

## Requirements

- [Bun](https://bun.sh/) 1.3.0 or newer. Development and CI use Bun 1.4.0.
- Linux or macOS on Apple Silicon for source-running. Packaged macOS support is
  not available yet.
- For Apple Music: a subscription and an installed Chromium-compatible browser.
- For saved login on Linux: `secret-tool` and an unlocked Secret Service keyring.
- For saved login on macOS: the built-in Keychain is used automatically.

The terminal shell and automated tests run without Apple credentials or Chromium.

## Run locally

```sh
bun install --frozen-lockfile
bun run start
```

Nutka gets developer tokens automatically from `https://api.nutka.fm`. You do
not need an Apple Developer account or a private signing key. Open `Ctrl+P` and
choose `Sign in to Apple Music`. See [Apple Music setup](docs/APPLE_MUSIC.md)
for browser configuration and local signer development.

Use `Ctrl+P` to sign in and navigate, `j`/`k` or arrows to move, `Enter` to play,
`Space` to pause, and `?` for help. See [all controls](docs/CONTROLS.md).

On Omarchy, Nutka reads the active theme at startup. Visualizer preferences,
log paths, and browser configuration are documented in
[Apple Music setup](docs/APPLE_MUSIC.md).

## Development

Install the signer dependencies before running all checks:

```sh
bun install --frozen-lockfile --cwd services/apple-token
bun run check
```

This checks both TypeScript packages and runs the client and Cloudflare Worker
tests. The GitHub Actions workflow runs the same command on Linux.

### macOS source-running

The current macOS target is Apple Silicon running from a development checkout.
Install Google Chrome in its standard location, or set
`NUTKA_CHROMIUM_PATH` to another Chromium-compatible browser. Then run:

```sh
bun install --frozen-lockfile
bun run start
```

Sign in through the app, then close it before running the real playback probe
because both use the fixed loopback port:

```sh
bun run playback:probe
```

The probe confirms real playback and controls on macOS, but skips the Linux-only
PipeWire audio-output check. The spectrum visualizer is Linux-only and is
unavailable on macOS in this source-running version.

See [Contributing](CONTRIBUTING.md) for focused checks and coding conventions,
[Architecture](docs/ARCHITECTURE.md) for the source layout, and
[PLAN.md](PLAN.md) for outstanding work.

## Project status

Nutka runs from source on Linux and macOS Apple Silicon. Executable packaging
remains pending. Uploaded library songs without an Apple catalog ID remain
visible but cannot play through the current worker. The spectrum visualizer
remains Linux-only.

For packaging and public downloads, see the [release checklist](docs/RELEASING.md).
For signer hosting, see [Cloudflare deployment](docs/DEPLOY_CLOUDFLARE.md).
The [Apple Music integration boundaries](docs/APPLE_COMPLIANCE.md) record the
credential handling and production deployment requirements.

## License

[MIT](LICENSE)
