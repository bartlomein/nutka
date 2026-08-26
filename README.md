# Nutka

Open-source music in your terminal.

Nutka is a keyboard-first terminal music player. Apple Music is the first
provider; other services can be added behind the same provider interface later.

## Requirements

- [Bun](https://bun.sh/) 1.3.0 or newer
- macOS or Linux for the initial development targets

## Run locally

```sh
bun install
bun run dev
```

This starts the empty TUI shell and needs no service or Apple credentials.
On Omarchy, Nutka reads the active theme colors at startup and matches apps using
the system theme, including OpenCode.

To run the local token-service connection as well:

```sh
bun run dev:apple
```

That command starts the token service, waits for it, then starts Nutka. It shuts
the service down when Nutka exits. Real Apple signing and browser-assisted login
are enabled through private environment variables documented in
[`services/apple-token/README.md`](services/apple-token/README.md).

With real Apple credentials configured, open `Ctrl+P` and run
`Sign in to Apple Music`. Nutka opens a localhost page for Apple authorization,
connects that page automatically through a one-time URL fragment, validates the
resulting session, and stores it in Secret Service on Linux or Keychain on
macOS. No pairing code or plaintext credential fallback is used.

Authorization diagnostics are written to
`~/.local/state/nutka/auth.log` (or `$XDG_STATE_HOME/nutka/auth.log`) with `0600`
permissions. The rotating structured log contains only stages, sanitized error
codes, and HTTP statuses; it never records URLs, headers, request bodies,
developer tokens, session capabilities, or Music User Tokens. Set
`NUTKA_AUTH_LOG=off` to disable it.

To authorize Nutka's private Chromium profile once, run this while `dev:apple` is
running:

```sh
bun run playback:authorize
```

After that, selecting a playable Apple Music song and pressing `Enter` starts
normal playback in an invisible worker. The optional standalone proof exercises
the same profile and MusicKit host:

```sh
bun run playback:probe
```

Authorization opens one visible browser window. Normal playback and the probe
then use the system `/usr/bin/chromium`, download no browser, and open no window.
The probe tests one real song for 36 seconds plus pause, resume, seek, and stop.
Set `NUTKA_CHROMIUM_PATH` to select another installed Chrome-compatible browser.
The Linux worker passes with full-track playback and PipeWire audio.
Signing out stops the worker and removes this dedicated profile; run
`playback:authorize` again after signing back in.

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
The token service supports real
ES256 signing, a loopback-only MusicKit login, Apple session validation, secure
OS-keyring persistence, and secret-safe diagnostics. Live authorization and
restart restoration are verified.

See [PLAN.md](PLAN.md) for the MVP, architecture, delivery phases, and known
Apple Music risks.

## Product constraint

Normal playback must not open a visible browser. A browser window is acceptable
only for provider login when unavoidable.

## License

MIT
