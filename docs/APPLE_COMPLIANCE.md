# Apple Music integration boundaries

This document records engineering boundaries, not legal advice.

## Public source versus private deployment data

The Nuta client and token-service implementation can be published as open
source. The following must remain private and outside Git:

- Apple Music private keys (`.p8`, `.pem`, or `.key`)
- deployment secrets and account credentials
- production service configuration that contains secrets
- issued developer tokens in logs or diagnostics

The client requests a short-lived developer token from the service. Apple login,
Music User Tokens, catalog requests, and playback should go directly between the
user's machine and Apple wherever the documented MusicKit flow permits it.

## Product constraints

- Use documented MusicKit and Apple Music API behavior only.
- Do not download, cache, modify, redistribute, or rehost Apple Music content.
- Do not bundle or alter MusicKit JS in this repository.
- Keep standard playback controls and require the user's Apple Music subscription.
- Follow Apple's current identity and branding guidance before public release.

## Confirmation required before production

Before hosting the service or distributing a public Apple-enabled build, ask
Apple Developer Support to confirm the exact architecture: an open-source
terminal client, a hosted developer-token endpoint, and MusicKit JS running in a
hidden browser process on macOS and Linux after interactive login. The Linux DRM
and headless playback path remains a technical spike, not a proven capability.

Current primary references:

- <https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens>
- <https://developer.apple.com/support/terms/apple-developer-program-license-agreement/>
- <https://developer.apple.com/musickit/>
