# Nutka

Open-source music in your terminal.

Nutka is a keyboard-first terminal music player. Apple Music is the first
provider; other services can be added behind the same provider interface later.

## Requirements

- [Bun](https://bun.sh/) 1.3.0 or newer
- macOS or Linux for the initial development targets
- Chromium for Apple Music login and playback

## Run locally

```sh
bun install
bun install --cwd services/apple-token
bun run dev
```

This starts the empty TUI shell and needs no service or Apple credentials.
On Omarchy, Nutka reads the active theme colors at startup and matches apps using
the system theme, including OpenCode.

To run the local Cloudflare signer and Apple-enabled client together, first
create an untracked `services/apple-token/.dev.vars` from that package's
`.dev.vars.example`. Put the Apple key contents there and set
`SIGNING_ENABLED="true"`. Then run:

```sh
bun run dev:apple
```

That command starts Wrangler on `127.0.0.1:8788`, waits for it, then starts
Nutka. Nutka starts its own authorization and playback server on
`127.0.0.1:8787`. Both processes stop when Nutka exits. Real Apple signing is
configured through private Worker bindings documented in
[`services/apple-token/README.md`](services/apple-token/README.md).

With real Apple credentials configured, open `Ctrl+P` and run `Sign in to Apple
Music`. Nutka opens one visible Chromium window using its private playback
profile. The localhost page connects through a one-time URL fragment, Apple
handles account login, and Nutka validates the resulting session before storing
it in Secret Service on Linux or Keychain on macOS. Nutka closes the window
before playback starts. No pairing code or plaintext credential fallback is
used.

Authorization diagnostics are written to
`~/.local/state/nutka/auth.log` (or `$XDG_STATE_HOME/nutka/auth.log`) with `0600`
permissions. The rotating structured log contains only stages, sanitized error
codes, and HTTP statuses; it never records URLs, headers, request bodies,
developer tokens, session capabilities, or Music User Tokens. Set
`NUTKA_AUTH_LOG=off` to disable it.

After signing in, selecting a playable Apple Music song and pressing `Enter`
starts normal playback in an invisible worker. The optional standalone proof
exercises the same profile and MusicKit host. Run `bun run signer:dev` in another
terminal first, and do not run Nutka at the same time because both use the fixed
loopback port:

```sh
bun run playback:probe
```

Authorization opens one visible browser window. Normal playback and the probe
then use `/usr/bin/chromium` on Linux or Google Chrome's standard application
path on macOS, download no browser, and open no window.
The probe tests one real song for 36 seconds plus pause, resume, seek, and stop.
Set `NUTKA_CHROMIUM_PATH` to select another installed Chrome-compatible browser.
The Linux worker passes with full-track playback and PipeWire audio.
Signing out stops the worker and removes this dedicated profile; run
`Sign in to Apple Music` again to recreate it.

On Linux, the three-row spectrum visualizer analyzes Nutka's exact Chromium
PipeWire stream. It does not capture the microphone, other applications, or the
whole output device. The visualizer stays blank if PipeWire capture is
unavailable and never affects playback. Press `v` to hide it and suspend audio
analysis for the rest of the session; press `v` again to restore it. Set
`NUTKA_THEME_PATH` to a custom
Omarchy-compatible TOML theme and optionally define `visualizer_low`,
`visualizer_mid`, `visualizer_high`, and `visualizer_peak` as `#RRGGBB` colors.

## Controls

- `j`/`k` or arrow keys: move through tracks or playlists
- `Enter`: play the selected Apple Music song and queue the visible songs after it
- `i`: inspect the selected track, playlist, or its loaded album/playlist context;
  use `j`/`k` or arrows to scroll and `i`/`Escape` to close
- `Space`: pause or resume confirmed playback
- `b`, `r`, `n`: play the previous track, a random visible track, or the next track;
  the now-playing panel shows compact transport icons
- `v`: toggle the visualizer and suspend or resume PipeWire audio analysis
- `Ctrl+P`: open commands and navigation
- `g l`, `g p`, `g s`, `g q`: go to Library, Playlists, Search, or Queue
- Playlists: browse deduplicated For You and Your Library sections; press `Enter`
  to open a playlist, press `r` to shuffle-play the selected playlist without
  opening it, and press `Escape` to return
- Playlist tracks: press `Enter` to play the selected song and queue the visible
  songs after it; press `m` to load the next page when available
- Search: type a query and press `Enter` to search Apple Music songs
- `/`: fuzzy-filter the currently displayed list without another API request
- Search results: press `s` for a new search and `m` to load the next page
- Search results: press `a` to open the selected song's album; press `Escape` to return
- Filter: type to narrow, use arrows or `Ctrl+N`/`Ctrl+P` to navigate,
  `Enter` to apply, and `Escape` to cancel
- `?`: show keyboard help
- `q`: exit

## Current status

Phase 4 Linux playback integration is complete. Nutka has no bundled catalog;
Search loads real Apple Music songs and selected-song albums, Playlists loads
personalized recommendations and saved library playlists, Library remains empty,
and Queue shows the worker-confirmed upcoming songs. A supervised hidden
Chromium worker provides real play, pause, resume, previous, next, seek, stop,
now-playing updates, and a PipeWire-driven spectrum without optimistic UI state.
The hosted Hono signer supports real ES256 signing without receiving user
credentials. Nutka owns the loopback-only MusicKit login and playback pages,
Apple session validation, secure OS-keyring persistence, and secret-safe
diagnostics. Live authorization and restart restoration are verified.

See [PLAN.md](PLAN.md) for the MVP, architecture, delivery phases, and known
Apple Music risks. See
[`docs/DEPLOY_CLOUDFLARE.md`](docs/DEPLOY_CLOUDFLARE.md) for signer deployment.

## Product constraint

Normal playback must not open a visible browser. A browser window is acceptable
only for provider login when unavoidable.

## License

MIT
