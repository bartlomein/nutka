import { chmod, mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import puppeteer, { type Browser, type Page } from "puppeteer-core"

import type { AppleCatalogTrack, AudioQuality } from "../core/types"
import {
  isPlaybackDocumentUrl,
  loopbackPlaybackUrl,
} from "./apple-playback-origin"
import { requestDeveloperToken, type Fetch } from "./token-service"
import { ChromiumAudioQualityTracker } from "./chromium-audio-quality"

const PAGE_READY_TIMEOUT_MS = 30_000
const PLAYBACK_START_TIMEOUT_MS = 30_000
const CONTROL_TIMEOUT_MS = 10_000
const MAX_PACTL_OUTPUT_BYTES = 256 * 1024

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

export interface PlaybackProbeSnapshot {
  initialized: boolean
  authorized?: boolean
  isPlaying?: boolean
  playbackState?: number | null
  positionSeconds?: number
  durationSeconds?: number | null
  resourceId?: string | null
  title?: string | null
  artist?: string | null
  lastErrorCode?: string | null
  commandSequence?: number
  completedCommandSequence?: number
  audioQuality?: AudioQuality | null
}

export type PlaybackProbeControl =
  | "play"
  | "pause"
  | "resume"
  | "previous"
  | "next"
  | "stop"

export interface PlaybackProbeBrowser {
  readonly processId: number | null
  initialize(developerToken: string, musicUserToken: string): Promise<void>
  setQueue(resourceIds: readonly string[]): Promise<void>
  click(control: PlaybackProbeControl): Promise<void>
  seek(positionSeconds: number): Promise<void>
  snapshot(): Promise<PlaybackProbeSnapshot>
  close(): Promise<void>
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
    } catch {
      throw new ApplePlaybackProbeError("musickit_unavailable")
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

type PlaybackPageGlobal = typeof globalThis & {
  __nutkaPlayback: {
    initialize(developerToken: string, musicUserToken: string): Promise<unknown>
    setQueue(resourceIds: readonly string[]): void
    snapshot(): PlaybackProbeSnapshot
    seek(positionSeconds: number): Promise<void>
  }
}

export async function launchPuppeteerPlaybackBrowser(
  executablePath: string,
  playbackUrl: string,
  persistentProfilePath?: string,
): Promise<PlaybackProbeBrowser> {
  const profilePath = persistentProfilePath ?? await mkdtemp(join(tmpdir(), "nutka-playback-"))
  if (persistentProfilePath) {
    await mkdir(profilePath, { recursive: true })
  }
  await chmod(profilePath, 0o700)
  let browser: Browser | undefined
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      pipe: true,
      userDataDir: profilePath,
      ignoreDefaultArgs: ["--mute-audio"],
      env: playbackBrowserEnvironment(process.env),
    })
    const page = await browser.newPage()
    const audioQuality = new ChromiumAudioQualityTracker()
    try {
      const media = await page.createCDPSession()
      media.on("Media.playerPropertiesChanged", (event) => {
        audioQuality.update(event.playerId, event.properties)
      })
      await media.send("Media.enable")
    } catch {
      // Playback remains usable when Chromium's optional media diagnostics are absent.
    }
    page.on("console", () => {})
    page.on("pageerror", () => {})
    await page.goto(playbackUrl, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_READY_TIMEOUT_MS,
    })
    if (!isPlaybackDocumentUrl(page.url(), playbackUrl)) {
      throw new Error("untrusted_playback_origin")
    }
    await page.waitForFunction(
      "typeof window.__nutkaPlayback === 'object'",
      { timeout: PAGE_READY_TIMEOUT_MS },
    )
    return new PuppeteerPlaybackBrowser(
      browser,
      page,
      profilePath,
      persistentProfilePath === undefined,
      playbackUrl,
      audioQuality,
    )
  } catch (error) {
    await browser?.close().catch(() => {})
    if (!persistentProfilePath) {
      await rm(profilePath, { recursive: true, force: true }).catch(() => {})
    }
    throw error
  }
}

class PuppeteerPlaybackBrowser implements PlaybackProbeBrowser {
  constructor(
    private readonly browser: Browser,
    private readonly page: Page,
    private readonly profilePath: string,
    private readonly removeProfile: boolean,
    private readonly playbackUrl: string,
    private readonly audioQuality: ChromiumAudioQualityTracker,
  ) {}

  get processId(): number | null {
    return this.browser.process()?.pid ?? null
  }

  async initialize(developerToken: string, musicUserToken: string): Promise<void> {
    if (!isPlaybackDocumentUrl(this.page.url(), this.playbackUrl)) {
      throw new Error("untrusted_playback_origin")
    }
    await this.page.evaluate(
      async ({ developerToken, musicUserToken }) => {
        const playback = (globalThis as PlaybackPageGlobal).__nutkaPlayback
        await playback.initialize(developerToken, musicUserToken)
      },
      { developerToken, musicUserToken },
    )
  }

  async setQueue(resourceIds: readonly string[]): Promise<void> {
    await this.page.evaluate((ids) => {
      ;(globalThis as PlaybackPageGlobal).__nutkaPlayback.setQueue(ids)
    }, [...resourceIds])
  }

  async click(control: PlaybackProbeControl): Promise<void> {
    await this.page.click(`#${control}`)
  }

  async seek(positionSeconds: number): Promise<void> {
    await this.page.evaluate(async (position) => {
      await (globalThis as PlaybackPageGlobal).__nutkaPlayback.seek(position)
    }, positionSeconds)
  }

  async snapshot(): Promise<PlaybackProbeSnapshot> {
    const snapshot = await this.page.evaluate(
      () => (globalThis as PlaybackPageGlobal).__nutkaPlayback.snapshot(),
    )
    return { ...snapshot, audioQuality: this.audioQuality.quality }
  }

  async close(): Promise<void> {
    try {
      await this.browser.close()
    } finally {
      if (this.removeProfile) {
        await rm(this.profilePath, { recursive: true, force: true })
      }
    }
  }
}

export function playbackBrowserEnvironment(
  environment: NodeJS.ProcessEnv,
): Record<string, string> {
  const allowed = [
    "DBUS_SESSION_BUS_ADDRESS",
    "DISPLAY",
    "HOME",
    "LANG",
    "LC_ALL",
    "PATH",
    "PIPEWIRE_REMOTE",
    "PULSE_SERVER",
    "TZ",
    "WAYLAND_DISPLAY",
    "XAUTHORITY",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_RUNTIME_DIR",
  ]
  return Object.fromEntries(
    allowed.flatMap((name) => environment[name] ? [[name, environment[name]]] : []),
  )
}

async function detectChromiumAudioSink(browserProcessId: number | null): Promise<boolean> {
  if (process.platform !== "linux" || !browserProcessId) return false
  const child = Bun.spawn({
    cmd: ["/usr/bin/pactl", "-f", "json", "list", "sink-inputs"],
    env: playbackBrowserEnvironment(process.env),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  })
  const output = new Uint8Array(await new Response(child.stdout).arrayBuffer())
  const exitCode = await child.exited
  if (exitCode !== 0 || output.byteLength > MAX_PACTL_OUTPUT_BYTES) return false

  let inputs: unknown
  try {
    inputs = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(output))
  } catch {
    return false
  }
  if (!Array.isArray(inputs)) return false
  for (const input of inputs) {
    if (!input || typeof input !== "object") continue
    const properties = (input as { properties?: unknown }).properties
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) continue
    const processId = Number((properties as Record<string, unknown>)["application.process.id"])
    if (Number.isInteger(processId) && await isDescendantProcess(processId, browserProcessId)) {
      return true
    }
  }
  return false
}

export function applePlaybackProfilePath(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const stateHome = environment.XDG_STATE_HOME || join(homedir(), ".local", "state")
  return join(stateHome, "nutka", "chromium-profile")
}

export async function isDescendantProcess(
  processId: number,
  ancestorId: number,
): Promise<boolean> {
  let current = processId
  for (let depth = 0; depth < 32 && current > 1; depth++) {
    if (current === ancestorId) return true
    try {
      const status = await readFile(`/proc/${current}/status`, "utf8")
      const match = status.match(/^PPid:\s+(\d+)$/m)
      if (!match) return false
      current = Number(match[1])
    } catch {
      return false
    }
  }
  return false
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
