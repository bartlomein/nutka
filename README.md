# Nutka

A keyboard-first terminal music player built with Bun, TypeScript, and OpenTUI.
Apple Music is the first provider.

Nutka supports catalog search, saved songs and playlists, artist and album
browsing, radio, and a playback queue. Login opens Chromium once. Normal playback
uses a hidden worker, with an optional PipeWire spectrum visualizer on Linux.

## Requirements

- [Bun](https://bun.sh/) 1.3.0 or newer. Development and CI use Bun 1.4.0.
- Linux. Other operating systems are not currently supported.
- For Apple Music: a subscription, an installed Chromium-compatible browser,
  and a configured [developer-token signer](services/apple-token/README.md).
- For saved login: `secret-tool` and an unlocked Secret Service keyring.

The terminal shell and automated tests run without Apple credentials or Chromium.

## Run locally

```sh
bun install --frozen-lockfile
bun install --frozen-lockfile --cwd services/apple-token
bun run dev
```

This opens an empty terminal interface. To connect Apple Music, follow
[Apple Music setup](docs/APPLE_MUSIC.md), configure the local signer, then run:

```sh
bun run dev:apple
```

Use `Ctrl+P` to sign in and navigate, `j`/`k` or arrows to move, `Enter` to play,
`Space` to pause, and `?` for help. See [all controls](docs/CONTROLS.md).

On Omarchy, Nutka reads the active theme at startup. Visualizer preferences,
log paths, and browser configuration are documented in
[Apple Music setup](docs/APPLE_MUSIC.md).

## Development

```sh
bun run check
```

This checks both TypeScript packages and runs the client and Cloudflare Worker
tests. The GitHub Actions workflow runs the same command on Linux.

See [Contributing](CONTRIBUTING.md) for focused checks and coding conventions,
[Architecture](docs/ARCHITECTURE.md) for the source layout, and
[PLAN.md](PLAN.md) for outstanding work.

## Project status

Nutka runs from source on Linux. Executable packaging remains pending. Uploaded library songs without an Apple catalog ID remain
visible but cannot play through the current worker.

For packaging and public downloads, see the [release checklist](docs/RELEASING.md).
For signer hosting, see [Cloudflare deployment](docs/DEPLOY_CLOUDFLARE.md).
The [Apple Music integration boundaries](docs/APPLE_COMPLIANCE.md) record the
credential handling and production deployment requirements.

## License

[MIT](LICENSE)
