import { AppleCatalogProvider } from "../src/services/apple-catalog"
import { AppleAuthManager } from "../src/services/apple-auth"
import { AppleDeveloperTokenProvider } from "../src/services/apple-developer-token-provider"
import { startAppleLoopbackServer } from "../src/services/apple-loopback-server"
import {
  ApplePlaybackProbeError,
  applePlaybackProfilePath,
  defaultChromiumExecutablePath,
  runApplePlaybackProbe,
} from "../src/services/apple-playback-probe"
import { createCredentialStore } from "../src/services/credentials"

const signerUrl = process.env.NUTKA_APPLE_SIGNER_URL ?? "http://127.0.0.1:8788"
const executablePath =
  process.env.NUTKA_CHROMIUM_PATH ?? defaultChromiumExecutablePath()
const query = process.argv.slice(2).join(" ").trim() || "Massive Attack Angel"
const cancellation = new AbortController()
process.once("SIGINT", () => cancellation.abort())
process.once("SIGTERM", () => cancellation.abort())

const developerTokenProvider = new AppleDeveloperTokenProvider(signerUrl)
const loopbackServer = startAppleLoopbackServer({ issuer: developerTokenProvider })
const serviceUrl = loopbackServer.origin

const auth = new AppleAuthManager({
  serviceUrl,
  credentialStore: createCredentialStore(),
})

try {
  await auth.restore()
  if (auth.status.state !== "signedIn") {
    throw new ApplePlaybackProbeError("authorization_rejected")
  }

  const provider = new AppleCatalogProvider(serviceUrl, auth.status.storefront, {
    limit: 5,
  })
  const page = await provider.searchSongs(query, { signal: cancellation.signal })
  const track = page.items.find((item) => item.apple.playParams)
  if (!track) throw new ApplePlaybackProbeError("invalid_track")

  console.log(`Headless playback probe: ${track.title} by ${track.artist}`)
  console.log(`Browser: ${executablePath}`)
  console.log("Waiting for 36 seconds of confirmed playback...")

  const result = await auth.useMusicUserToken((musicUserToken) =>
    runApplePlaybackProbe({
      serviceUrl,
      musicUserToken,
      track,
      executablePath,
      signal: cancellation.signal,
      profilePath: applePlaybackProfilePath(),
      onProgress: (snapshot) => {
        const position = Math.floor(snapshot.positionSeconds ?? 0)
        if (position % 5 === 0 || snapshot.isPlaying !== true) {
          console.log(
            `Playback state: ${snapshot.isPlaying ? "playing" : "waiting"} at ${position}s` +
              ` authorized=${snapshot.authorized === true}` +
              (snapshot.lastErrorCode ? ` (${snapshot.lastErrorCode})` : ""),
          )
        }
      },
    })
  )

  console.log(
    `PASS: ${result.title ?? track.title} played for ${Math.floor(result.playedSeconds)} seconds`,
  )
  console.log(
    `PASS: audio=${result.audioSinkDetected} pause=${result.pauseConfirmed} resume=${result.resumeConfirmed} seek=${result.seekConfirmed} stop=${result.stopConfirmed}`,
  )
} catch (error) {
  const code = error instanceof ApplePlaybackProbeError
    ? error.code
    : "probe_failed"
  console.error(`FAIL: ${code}`)
  process.exitCode = 1
} finally {
  await auth.dispose()
  loopbackServer.stop()
  developerTokenProvider.dispose()
}
