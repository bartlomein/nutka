# Apple Music setup

Start with the [installation steps](../README.md#run-locally).
Apple Music login and playback require a subscription, an installed Chromium
browser, and access to `https://api.nutka.fm`, Nutka's default token signer.
You do not need your own Apple Developer account or signing credentials.
On Linux, install `secret-tool` and run an unlocked Secret Service keyring. On
macOS, Nutka uses the built-in Keychain.

Run `bun run start`, then use `Ctrl+P` > `Sign in to Apple Music`.
Set `NUTKA_APPLE_SIGNER_URL` to override the hosted signer with your own HTTPS
signer or a local development signer.

## Local signer development

This section is only needed when developing or hosting the signer yourself.
Install its dependencies with
`bun install --frozen-lockfile --cwd services/apple-token`.

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
[`services/apple-token/README.md`](../services/apple-token/README.md).

Wrangler output is kept out of the full-screen terminal and written to
`~/.local/state/nutka/apple-signer.log` (or
`$XDG_STATE_HOME/nutka/apple-signer.log`) with `0600` permissions. The file is
replaced on each `bun run dev:apple` launch. Set `NUTKA_APPLE_SIGNER_LOG` to a
different path, or to `off` to discard signer output. Startup failures include
the active log path so the signer can be diagnosed without corrupting the TUI.

## Login and playback

Open `Ctrl+P` and run `Sign in to Apple
Music`. Nutka opens one visible Chromium window using its private playback
profile. The localhost page connects through a one-time URL fragment, Apple
handles account login, and Nutka validates the resulting session before storing
it in the platform credential store. Nutka closes the window
before playback starts. No pairing code or plaintext credential fallback is
used. On macOS, the saved Music User Token is stored in the `dev.nutka.cli`
Keychain service and is migrated from the historical `dev.nuta.cli` service when
needed.

Authorization diagnostics are written to
`~/.local/state/nutka/auth.log` (or `$XDG_STATE_HOME/nutka/auth.log`) with `0600`
permissions. The rotating structured log contains only stages, sanitized error
codes, and HTTP statuses; it never records URLs, headers, request bodies,
developer tokens, session capabilities, or Music User Tokens. Set
`NUTKA_AUTH_LOG=off` to disable it.

After signing in, selecting a playable Apple Music song and pressing `Enter`
starts normal playback in an invisible worker. The optional standalone proof
exercises the same profile and MusicKit host. Sign in through Nutka first, then
close Nutka before running the probe because both use the fixed loopback port.
The probe uses the hosted signer by default:

```sh
bun run playback:probe
```

Nutka's authorization opens one visible browser window. Normal playback and the
probe then use the platform's configured browser without downloading a browser
or opening a second window. Linux defaults to `/usr/bin/chromium`; macOS
defaults to Google Chrome at
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. Set
`NUTKA_CHROMIUM_PATH` to override either default.
The probe tests one real song for 36 seconds plus pause, resume, seek, and stop.
The Linux worker passes with full-track playback and PipeWire audio. The macOS
source-running probe verifies playback and controls but does not claim a Core
Audio output proof.
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

On macOS, the spectrum visualizer is unavailable in the current source-running
version; macOS Core Audio capture is not implemented.

## macOS source-running test

The supported macOS v1 target is Apple Silicon from a source checkout. Install
Bun and Google Chrome, then run:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run start
```

After signing in, close Nutka and run `bun run playback:probe` to verify a real
track plus pause, resume, seek, and stop. Packaged, signed, and notarized macOS
distribution is not part of this source-running target.
