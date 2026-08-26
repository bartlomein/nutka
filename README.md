# Nuta

Open-source music in your terminal.

Nuta is a keyboard-first terminal music player. Apple Music is the first
provider; other services can be added behind the same provider interface later.

## Requirements

- [Bun](https://bun.sh/) 1.3.0 or newer
- macOS or Linux for the initial development targets

## Run locally

```sh
bun install
bun run dev
```

This starts the fake-data TUI and needs no service or Apple credentials.

To run the local token-service connection as well:

```sh
bun run dev:apple
```

That command starts the token service in explicit mock mode, waits for it, then
starts Nuta. It shuts the service down when Nuta exits. Real Apple signing is
opt-in through private environment variables documented in
[`services/apple-token/README.md`](services/apple-token/README.md).

## Controls

- `j`/`k` or arrow keys: move through tracks
- `Enter`: play the selected fake track
- `Space`: pause or resume
- `/`: filter the catalog; `Enter` returns to normal mode
- `q`: exit

## Current status

Phase 2 is complete and the Phase 3 token-service foundation is in progress.
The local demo includes a responsive library, searchable fake catalog, queue,
now-playing state, and keyboard controls. Playback is simulated. The token
service supports local mock mode and real ES256 signing, but Apple login,
catalog requests, and audio are not implemented yet.

See [PLAN.md](PLAN.md) for the MVP, architecture, delivery phases, and known
Apple Music risks.

## Product constraint

Normal playback must not open a visible browser. A browser window is acceptable
only for provider login when unavoidable.

## License

MIT
