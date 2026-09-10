import type { AppleCatalogTrack } from "../core/types"
import {
  launchPuppeteerPlaybackBrowser,
  type PlaybackProbeBrowser,
  type PlaybackProbeSnapshot,
} from "./apple-playback-browser"
import { loopbackPlaybackUrl } from "./apple-playback-origin"
import { detectChromiumAudioSink } from "./chromium-process"
import { requestDeveloperToken, type Fetch } from "./token-service"

export {
  launchPuppeteerPlaybackBrowser,
  type PlaybackProbeBrowser,
  type PlaybackProbeControl,
  type PlaybackProbeSnapshot,
} from "./apple-playback-browser"
export {
  applePlaybackProfilePath,
  defaultChromiumExecutablePath,
  isDescendantProcess,
  playbackBrowserEnvironment,
  readBoundedProcessOutput,
  type BoundedOutputProcess,
} from "./chromium-process"

const PLAYBACK_START_TIMEOUT_MS = 30_000
const CONTROL_TIMEOUT_MS = 10_000

export type ApplePlaybackProbeErrorCode =
  | "invalid_track"
  | "token_service_unavailable"
  | "browser_start_failed"
  | "musickit_unavailable"
  | "authorization_rejected"
  | "interaction_required"
  | "drm_unavailable"
  | "media_unavailable"
  | "playback_timeout"
  | "audio_output_missing"
  | "control_failed"
  | "untrusted_playback_origin"

export class ApplePlaybackProbeError extends Error {
  constructor(readonly code: ApplePlaybackProbeErrorCode) {
    super(probeErrorMessage(code))
    this.name = "ApplePlaybackProbeError"
  }
}

export interface ApplePlaybackProbeResult {
  title: string | null
  artist: string | null
  playedSeconds: number
  audioSinkDetected: boolean
  pauseConfirmed: boolean
  resumeConfirmed: boolean
  seekConfirmed: boolean
  stopConfirmed: boolean
}

export interface ApplePlaybackProbeOptions {
  serviceUrl: string
  musicUserToken: string
  track: AppleCatalogTrack
  executablePath: string
  proofDurationSeconds?: number
  launchBrowser?: (
    executablePath: string,
    playbackUrl: string,
    profilePath?: string,
  ) => Promise<PlaybackProbeBrowser>
  detectAudioSink?: (browserProcessId: number | null) => Promise<boolean>
  sleep?: (milliseconds: number) => Promise<void>
  now?: () => number
  signal?: AbortSignal
  fetch?: Fetch
  onProgress?: (snapshot: PlaybackProbeSnapshot) => void
  profilePath?: string
}

export async function runApplePlaybackProbe(
  options: ApplePlaybackProbeOptions,
): Promise<ApplePlaybackProbeResult> {
  const playbackUrl = loopbackPlaybackUrl(options.serviceUrl)
  if (!playbackUrl) throw new ApplePlaybackProbeError("untrusted_playback_origin")
  const playParams = options.track.apple.playParams
  if (
    options.track.apple.resourceType !== "songs" ||
    !playParams ||
    playParams.kind !== "song" ||
    playParams.id !== options.track.apple.resourceId
  ) {
    throw new ApplePlaybackProbeError("invalid_track")
  }

  let developerToken: string
  try {
    const issued = await requestDeveloperToken(options.serviceUrl, options.fetch)
    if (issued.mode !== "apple") {
      throw new ApplePlaybackProbeError("token_service_unavailable")
    }
    developerToken = issued.token
  } catch (error) {
    if (error instanceof ApplePlaybackProbeError) throw error
    throw new ApplePlaybackProbeError("token_service_unavailable")
  }

  const launchBrowser = options.launchBrowser ?? launchPuppeteerPlaybackBrowser
  const detectAudioSink = options.detectAudioSink ?? detectChromiumAudioSink
  const sleep = options.sleep ?? Bun.sleep
  const now = options.now ?? Date.now
  const proofDurationSeconds = options.proofDurationSeconds ?? 36
  if (!Number.isFinite(proofDurationSeconds) || proofDurationSeconds <= 0) {
    throw new ApplePlaybackProbeError("playback_timeout")
  }

  let browser: PlaybackProbeBrowser
  try {
    browser = await launchBrowser(
      options.executablePath,
      playbackUrl,
      options.profilePath,
    )
  } catch {
    throw new ApplePlaybackProbeError("browser_start_failed")
  }

  try {
    try {
      await browser.initialize(developerToken, options.musicUserToken)
      await browser.setQueue([playParams.id])
    } catch (error) {
      throw new ApplePlaybackProbeError(
        error instanceof Error && error.message === "authorization_rejected"
          ? "authorization_rejected"
          : "musickit_unavailable",
      )
    }

    await browser.click("play")
    const started = await waitForSnapshot(
      browser,
      (snapshot) =>
        snapshot.isPlaying === true &&
        snapshot.resourceId === playParams.id &&
        (snapshot.positionSeconds ?? 0) > 0,
      PLAYBACK_START_TIMEOUT_MS,
      sleep,
      now,
      options.signal,
    )
    const startPosition = started.positionSeconds ?? 0
    let snapshot = started
    options.onProgress?.(snapshot)
    let audioSinkDetected = false
    let notPlayingSince: number | undefined
    const proofDeadline = now() + (proofDurationSeconds + 15) * 1_000

    while ((snapshot.positionSeconds ?? 0) - startPosition < proofDurationSeconds) {
      if (options.signal?.aborted) {
        throw new ApplePlaybackProbeError("control_failed")
      }
      if (now() >= proofDeadline) {
        throw classifySnapshotError(snapshot, "playback_timeout")
      }
      await sleep(1_000)
      snapshot = await browser.snapshot()
      options.onProgress?.(snapshot)
      if (snapshot.lastErrorCode) throw classifySnapshotError(snapshot, "media_unavailable")
      if (snapshot.resourceId !== playParams.id) {
        throw new ApplePlaybackProbeError("media_unavailable")
      }
      if (snapshot.isPlaying !== true) {
        notPlayingSince ??= now()
        if (now() - notPlayingSince >= 10_000) {
          throw new ApplePlaybackProbeError("media_unavailable")
        }
        continue
      }
      notPlayingSince = undefined
      if (!audioSinkDetected && (snapshot.positionSeconds ?? 0) - startPosition >= 3) {
        audioSinkDetected = await detectAudioSink(browser.processId)
      }
    }

    if (!audioSinkDetected) {
      audioSinkDetected = await detectAudioSink(browser.processId)
    }
    if (!audioSinkDetected) throw new ApplePlaybackProbeError("audio_output_missing")

    await browser.click("pause")
    const paused = await waitForSnapshot(
      browser,
      (value) => value.isPlaying === false,
      CONTROL_TIMEOUT_MS,
      sleep,
      now,
      options.signal,
    )
    const pausedPosition = paused.positionSeconds ?? 0
    await sleep(1_500)
    const stillPaused = await browser.snapshot()
    if (
      stillPaused.isPlaying !== false ||
      Math.abs((stillPaused.positionSeconds ?? 0) - pausedPosition) > 0.75
    ) {
      throw new ApplePlaybackProbeError("control_failed")
    }

    await browser.click("resume")
    const resumed = await waitForSnapshot(
      browser,
      (value) =>
        value.isPlaying === true &&
        (value.positionSeconds ?? 0) > pausedPosition + 0.25,
      CONTROL_TIMEOUT_MS,
      sleep,
      now,
      options.signal,
    )

    const resumePosition = resumed.positionSeconds ?? pausedPosition
    const maximumSeek = Math.max(0, (resumed.durationSeconds ?? resumePosition + 10) - 2)
    const seekTarget = Math.min(resumePosition + 5, maximumSeek)
    await browser.seek(seekTarget)
    await waitForSnapshot(
      browser,
      (value) => Math.abs((value.positionSeconds ?? 0) - seekTarget) < 2,
      CONTROL_TIMEOUT_MS,
      sleep,
      now,
      options.signal,
    )

    await browser.click("stop")
    await waitForSnapshot(
      browser,
      (value) => value.isPlaying === false,
      CONTROL_TIMEOUT_MS,
      sleep,
      now,
      options.signal,
    )

    return {
      title: snapshot.title ?? null,
      artist: snapshot.artist ?? null,
      playedSeconds: (snapshot.positionSeconds ?? startPosition) - startPosition,
      audioSinkDetected,
      pauseConfirmed: true,
      resumeConfirmed: true,
      seekConfirmed: true,
      stopConfirmed: true,
    }
  } catch (error) {
    if (error instanceof ApplePlaybackProbeError) throw error
    throw new ApplePlaybackProbeError("control_failed")
  } finally {
    await browser.close().catch(() => {})
  }
}

async function waitForSnapshot(
  browser: PlaybackProbeBrowser,
  accept: (snapshot: PlaybackProbeSnapshot) => boolean,
  timeoutMs: number,
  sleep: (milliseconds: number) => Promise<void>,
  now: () => number,
  signal?: AbortSignal,
): Promise<PlaybackProbeSnapshot> {
  const deadline = now() + timeoutMs
  let snapshot = await browser.snapshot()
  while (!accept(snapshot)) {
    if (signal?.aborted) throw new ApplePlaybackProbeError("control_failed")
    if (snapshot.lastErrorCode) throw classifySnapshotError(snapshot, "control_failed")
    if (now() >= deadline) throw new ApplePlaybackProbeError("playback_timeout")
    await sleep(250)
    snapshot = await browser.snapshot()
  }
  return snapshot
}

function classifySnapshotError(
  snapshot: PlaybackProbeSnapshot,
  fallback: ApplePlaybackProbeErrorCode,
): ApplePlaybackProbeError {
  const code = snapshot.lastErrorCode?.toLowerCase() ?? ""
  if (code.includes("widevine") || code.includes("drm") || code.includes("keysystem")) {
    return new ApplePlaybackProbeError("drm_unavailable")
  }
  if (code.includes("interaction") || code.includes("notallowed")) {
    return new ApplePlaybackProbeError("interaction_required")
  }
  if (code.includes("authoriz") || code === "403") {
    return new ApplePlaybackProbeError("authorization_rejected")
  }
  return new ApplePlaybackProbeError(fallback)
}

function probeErrorMessage(code: ApplePlaybackProbeErrorCode): string {
  const messages: Record<ApplePlaybackProbeErrorCode, string> = {
    invalid_track: "The selected Apple Music track cannot be played",
    token_service_unavailable: "The Apple token service is unavailable",
    browser_start_failed: "Headless Chromium could not start",
    musickit_unavailable: "MusicKit could not initialize",
    authorization_rejected: "Apple Music rejected playback authorization",
    interaction_required: "The browser requires a playback interaction",
    drm_unavailable: "Apple Music DRM is unavailable in this browser",
    media_unavailable: "Apple Music media playback failed",
    playback_timeout: "Apple Music playback did not start in time",
    audio_output_missing: "Chromium did not create an audio output stream",
    control_failed: "An Apple Music playback control failed",
    untrusted_playback_origin: "The playback page must use the local token service",
  }
  return messages[code]
}
