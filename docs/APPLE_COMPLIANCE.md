# Apple Music integration boundaries

This document records engineering boundaries, not legal advice.

## Public source versus private deployment data

The Nutka client and token-service implementation can be published as open
source. The following must remain private and outside Git:

- Apple Music private keys (`.p8`, `.pem`, or `.key`)
- deployment secrets and account credentials
- production service configuration that contains secrets
- issued developer tokens in logs or diagnostics
- Music User Tokens in logs, URLs, environment variables, or plaintext files

The client requests a short-lived developer token from the service. The local
authorization broker passes a Music User Token from Apple-hosted MusicKit JS to
the same machine through one-time loopback capabilities. Nutka validates it
before storing it in Linux Secret Service or macOS Keychain. There is no
plaintext fallback.

Authorization routes bind only to `127.0.0.1`. A five-minute, one-time browser
capability is delivered in a URL fragment, which browsers do not send in HTTP
requests, and is immediately removed from browser history before it is claimed.
Session and CSRF capabilities and both Apple tokens must remain out of logs and
UI state. Structured diagnostics may contain only event names, sanitized error
codes, HTTP statuses, and timestamps.

The authorization page uses `strict-origin-when-cross-origin` because MusicKit
requires Apple to receive the page origin during user authorization. The URL
fragment is excluded from referrers by browser semantics; non-page API responses
retain `no-referrer`.

The Linux playback controller passes both Apple tokens to a separate supervised
worker through private standard-I/O pipes. That worker passes them to a
sandboxed, dedicated Chromium profile only through the private browser
automation pipe. Tokens must not be placed in process or Chromium arguments,
their environments, the playback page URL, browser console output, diagnostics,
or the TUI. The persistent profile is mode `0700` because it retains MusicKit's
browser authorization state. Worker messages and commands are bounded and
strictly decoded, and worker failure clears playback state.
Signing out waits for bounded worker teardown and deletes the dedicated profile
so browser authorization is not retained across accounts.

## Product constraints

- Use documented MusicKit and Apple Music API behavior only.
- Do not download, cache, modify, redistribute, or rehost Apple Music content.
- Do not bundle or alter MusicKit JS in this repository.
- Load MusicKit JS only from Apple's documented v3 CDN.
- Keep standard playback controls and require the user's Apple Music subscription.
- Follow Apple's current identity and branding guidance before public release.

## Confirmation required before production

Before hosting the service or distributing a public Apple-enabled build, ask
Apple Developer Support to confirm the exact architecture: an open-source
terminal client, a hosted developer-token endpoint, and MusicKit JS running in a
hidden browser process on macOS and Linux after interactive login. The Linux DRM
and headless playback path remains a technical prototype rather than a supported
production capability. Full-track Linux playback, PipeWire audio, queue loading,
pause, resume, seek, stop, process supervision, and TUI state synchronization are
verified in headless Chromium.

Current primary references:

- <https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens>
- <https://developer.apple.com/support/terms/apple-developer-program-license-agreement/>
- <https://developer.apple.com/musickit/>
