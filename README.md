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

To run the local Cloudflare signer and Apple-enabled client together, run:

```sh
bun run dev:apple
```

The launcher accepts either an untracked `services/apple-token/.dev.vars` or the
existing root `.env` variables used by the original local service. When using a
root `APPLE_PRIVATE_KEY_PATH`, it gives Wrangler a temporary mode-`0600` env file
and deletes it on exit.

That command starts Wrangler on `127.0.0.1:8788`, waits for it, then starts
Nutka. Nutka starts its own authorization and playback server on
`127.0.0.1:8787`. Both processes stop when Nutka exits. Real Apple signing is
configured through private Worker bindings documented in
[`services/apple-token/README.md`](services/apple-token/README.md).

Wrangler output is kept out of the full-screen terminal and written to
`~/.local/state/nutka/apple-signer.log` (or
`$XDG_STATE_HOME/nutka/apple-signer.log`) with `0600` permissions. The file is
replaced on each `bun run dev:apple` launch. Set `NUTKA_APPLE_SIGNER_LOG` to a
different path, or to `off` to discard signer output. Startup failures include
the active log path so the signer can be diagnosed without corrupting the TUI.

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
Playback attempts are recorded in `~/.local/state/nutka/playback.log` (or
`$XDG_STATE_HOME/nutka/playback.log`) using structured stages and sanitized
error codes. Set `NUTKA_PLAYBACK_LOG` to another path or to `off` to disable it.
Signing out stops the worker and removes this dedicated profile; run
`Sign in to Apple Music` again to recreate it.

On Linux, the three-row spectrum visualizer analyzes Nutka's exact Chromium
PipeWire stream. It does not capture the microphone, other applications, or the
whole output device. The visualizer stays blank if PipeWire capture is
unavailable and never affects playback. Press `v` to hide it and suspend audio
analysis for the rest of the session; press `v` again to restore it. Press
`Shift+V` to choose the visualizer kind, dense/spaced/wide style, palette, and
height with a live preview. Nutka saves these choices to
`$XDG_CONFIG_HOME/nutka/config.toml` or `~/.config/nutka/config.toml`. Set
`NUTKA_CONFIG_PATH` to use another file. Set `NUTKA_THEME_PATH` to a custom
Omarchy-compatible TOML theme and optionally define `visualizer_low`,
`visualizer_mid`, `visualizer_high`, and `visualizer_peak` as `#RRGGBB` colors.

## Controls

- `j`/`k` or arrow keys: move through tracks, playlists, stations, or radio genres
- `Enter`: play the selected Apple Music song and queue the visible songs after it,
  or start the selected Radio station
- `i`: inspect the selected track, playlist, or its loaded album/playlist context;
  use `j`/`k` or arrows to scroll and `i`/`Escape` to close
- `Space`: pause or resume confirmed playback
- `b`, `s`, `n`: play the previous track, toggle shuffle, or play the next track;
  when nothing is playing, `s` shuffle-plays the current source
- `r`: cycle repeat through all songs, the current song, and off
- `f`: favorite or unfavorite the selected station in Nutka
- The now-playing panel shows confirmed `SHUFFLE ON/OFF` and
  `REPEAT OFF/ALL/1` states; compact layouts retain active `S` and `R` badges
- `v`: toggle the visualizer and suspend or resume PipeWire audio analysis
- `Shift+V`: configure the visualizer with a live preview
- `Ctrl+P`: open commands and navigation
- `g n`: open actions for the confirmed now-playing song's album, artists, and
  song or artist stations; if a new song starts, the open page remains pinned
- `g h`, `g l`, `g p`, `g r`, `g s`, `g q`: go to Home, Library, Playlists,
  Radio, Search, or Queue
- Radio: browse favorite, personal, live, and recently played stations, plus
  Apple's station genres; press `Enter` on a genre to open its stations
- Radio: press `/` to search Apple's station catalog by name, for example `NPR`;
  press `m` to load more search or genre results
- Artist pages: browse top songs, latest release, albums, singles and EPs, and
  similar artists; press `Enter` to play or open and `m` to load more
- `Escape` or `Ctrl+O`: return through now-playing artist and album pages
- Home: browse favorite stations and Apple's titled playlist or station
  recommendations; press `m` to load more sections when available
- Playlists: browse playlists saved in Your Library
- Library: press `1`, `2`, or `3` to browse saved songs, albums, or artists.
  Press `Enter` on an artist to open their saved albums, or on an album to open
  its saved tracks. `Escape` or `Ctrl+O` returns to the previous list and restores
  its selection and filter.
- Library: each list loads all pages automatically and shows items as they arrive.
  `/` fuzzy-filters the loaded items; `m` retries a failed request, and `Shift+R` refreshes the current list. Press `Enter` on a song to
  play it and queue the loaded, filtered songs after it. Songs without a usable
  Apple catalog ID remain visible as `[unavailable]` and are skipped in playback.
- Home and Playlists: press `Enter` to open a playlist, press `s` to
  shuffle-play it without opening it, turn shuffle mode on, and press `Escape`
  to return
- Playlist tracks: press `Enter` to play the selected song and queue the visible
  songs after it; press `m` to load the next page when available
- Search: type a query and press `Enter` to search Apple Music songs
- `/`: fuzzy-filter the current list, except in Radio where it searches Apple's
  station catalog; the command palette still exposes local Radio filtering
- Search results: press `s` for a new search and `m` to load the next page
- Search results: press `a` to open the selected song's album; press `Escape` to return
- Filter: type to narrow, use arrows or `Ctrl+N`/`Ctrl+P` to navigate,
  `Enter` to apply, and `Escape` to cancel
- `?`: show keyboard help
- `q`: exit

Station favorites are local to Nutka and scoped by Apple storefront. They are
stored in `$XDG_DATA_HOME/nutka/apple-station-favorites.json` or
`~/.local/share/nutka/apple-station-favorites.json`; set `NUTKA_FAVORITES_PATH`
to use another file. Favoriting does not add a station to the Apple Music
library. The command palette exposes a separate station-like action that affects
Apple Music recommendations. Each storefront can hold up to 25 local favorites.

## Current status

Phase 4 Linux playback integration is complete. Nutka has no bundled catalog;
Home loads favorite stations and titled personalized playlist or station
recommendations. Search loads real Apple Music songs and selected-song albums,
and `g n` opens the confirmed current song's album, artist catalog pages, and
station actions. Radio supports local favorites, catalog search, genre browsing,
personal stations, live stations, and recently played stations. Playlists loads saved library playlists.
Library browses saved songs, albums, artists, and their saved relationships with
pagination, filtering, refresh, and playback. Queue shows the worker-confirmed
upcoming songs. A
supervised hidden Chromium worker provides real play, pause, resume, previous,
next, seek, shuffle, repeat, stop, now-playing updates, and a PipeWire-driven
spectrum without optimistic UI state.
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
