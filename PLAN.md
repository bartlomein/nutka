# Nuta

Open-source music in your terminal.

## Current state

- Project name: **Nuta**
- Repository/folder: `nuta`
- CLI command: `nuta`
- Status: Phase 4 complete on Linux; real catalog playback is connected to the TUI
- First provider: Apple Music
- Future providers: Spotify, Tidal, and others behind the same provider interface

## Product rules

1. Nuta is a real terminal application built with OpenTUI.
2. Normal use must never show a browser window.
3. A visible browser is acceptable only when a provider requires interactive login.
4. Playback may use a hidden background browser process if Apple Music requires MusicKit JS.
5. macOS and Linux are first-class targets; Windows should remain possible.

## MVP

The first useful version should let a user:

- run `nuta`
- sign in to Apple Music once
- search the Apple Music catalog
- move through results with `j`/`k` or arrow keys
- press `Enter` to play and `Space` to pause
- see the current track and queue without a visible browser

## Architecture

```text
OpenTUI interface
       |
Application core
       |
Apple Music provider
   |-- Apple Music API: search, library, metadata
   `-- Hidden playback worker: MusicKit JS
```

Keep provider-specific behavior behind a small interface so another service can
be added later without rewriting the terminal UI.

## Build plan

### Phase 1 — Foundation

Estimated time: 15–30 minutes.

Status: **complete**

- initialize Git with a `main` branch
- create a Bun + TypeScript project
- install OpenTUI
- add the minimal source layout, scripts, `.gitignore`, README, and license
- run a blank Nuta screen successfully

### Phase 2 — TUI foundation

Estimated time: 1–2 hours.

Status: **complete**

- build search, results, queue, and now-playing regions
- keep UI work independent from Apple credentials
- add `j`/`k`, arrow, `Enter`, `Space`, and `q` keyboard controls
- define the provider and playback interfaces

### Phase 3 — Apple authentication spike

Estimated time: about half a day after Apple credentials are available.

Status: **complete** — real signing, catalog access, browser authorization,
Apple validation, OS-keyring persistence, and restart restoration are verified.

- keep the signing key in a separate token service, never in the client
- support a safe local mock mode and real short-lived ES256 signing
- launch the local service and TUI together with `bun run dev:apple`
- create/configure the MusicKit identifier and private key
- verify a real developer token against one Apple catalog request
- complete Apple Music user authorization
- store the resulting session securely enough for the prototype

### Phase 4 — Hidden playback spike

This is the highest-risk phase and should happen before polishing the app.

Status: **complete on Linux** — a supervised headless Chromium worker controls
MusicKit through a private pipe and the TUI renders only worker-confirmed state.

- [x] load real catalog song search results with typed pagination
- [x] open a selected song's album through Apple resource relationships
- [x] browse personalized and saved playlists with paginated track details
- [x] build the isolated headless Chromium playback probe
- prove one Apple Music track can play through MusicKit JS on macOS
- [x] prove the same approach on Linux
- [x] run the playback process with no visible browser window after login
- [x] bridge play, pause, seek, track changes, and errors back to the TUI

### Phase 5 — Integration and packaging

- add Apple Music library albums, artists, and songs
- harden and package login persistence across supported platforms
- package the `nuta` executable
- add macOS and Linux CI builds, then test Windows

## Important risks

### Developer-token distribution

Apple Music API requests require a signed developer token. The MusicKit private
key must never be shipped inside an open-source client. A local prototype can
use the developer's key, but a public release will likely need a small token
service or another Apple-approved token strategy.

### Linux playback and DRM

Apple officially supports playback through MusicKit on the Web, but protected
audio may depend on browser DRM components that are not present in a bundled
headless Chromium build. Phase 4 must prove this on Linux before Nuta commits to
a playback implementation.

## Immediate next action

Prove the worker on macOS, then add library and richer catalog browsing without
changing the confirmed-state playback boundary.
