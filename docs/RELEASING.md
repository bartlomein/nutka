# Making Nutka available to download

Nutka needs two separate releases: a downloadable app that runs on the user's
computer, and a hosted Apple developer-token signer. The current design uses
Cloudflare Workers for the signer. GitHub Releases can host the app downloads,
so a separate website or download server is optional.

This is a plan, not a record of a completed deployment. As of September 10,
2026, Nutka runs from source, executable packaging remains pending, and real
playback has been verified on Linux. macOS playback verification is pending.

## What goes where

| Component | Location | Purpose |
| --- | --- | --- |
| Nutka executable | GitHub Releases, downloaded to the user's computer | Runs the terminal interface, login, and playback |
| Apple token signer | Cloudflare Workers | Issues short-lived Apple Music developer tokens |
| Apple private signing key | Cloudflare secrets | Stays out of the app and source repository |

The signer code already exists in `services/apple-token`. It does not receive
Apple passwords, Music User Tokens, or playback data.

## Release checklist

- [ ] Package the `nutka` executable, including the assets and worker code it
  needs at runtime.
- [ ] Add automated builds for the platforms and architectures we intend to
  support, with downloadable archives and checksums.
- [ ] Test installation, login, playback, saved login, and sign-out on a clean
  machine without the development checkout.
- [ ] Choose the initial supported platforms. A Linux preview is the proposed
  starting point; verify real macOS playback before advertising macOS support.
- [ ] Complete the existing pre-production Apple Developer Support confirmation
  described in [Apple Music integration boundaries](APPLE_COMPLIANCE.md).
  That document calls for confirmation of the open-source terminal client,
  hosted token endpoint, and hidden-browser MusicKit playback architecture
  before production hosting or public Apple-enabled distribution.
- [ ] Deploy the signer using [Cloudflare deployment](DEPLOY_CLOUDFLARE.md),
  configure the Apple credentials as secrets, and verify its health and token
  endpoints.
- [ ] Set the hosted HTTPS signer address as the app's
  `NUTKA_APPLE_SIGNER_URL` release default so users do not need to run a signer.
- [ ] Configure traffic alerts and test the signer's kill switch and Apple key
  rotation, as described in the deployment guide.
- [ ] Publish a GitHub release with the tested builds, checksums, installation
  instructions, and known limitations.

## User requirements

Users currently need an Apple Music subscription, an installed
Chromium-compatible browser, and a working system keyring for saved login.
Linux uses `secret-tool` with an unlocked Secret Service keyring; macOS uses
Keychain. Source installs also require Bun. Verify whether the final packaged
build removes the separate Bun requirement before documenting installation.

## Suggested next coding step

Build and test a Linux executable on a clean machine, then automate that build
for releases. Signer deployment is already documented and can follow the
pre-production confirmation above.

## Hosting references

- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Wrangler deployment commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/)
- [GitHub Releases and downloadable binaries](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
