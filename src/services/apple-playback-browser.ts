import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import puppeteer, { type Browser, type Page } from "puppeteer-core"

import type { PlaybackRepeatMode, PlaybackShuffleMode } from "../core/types"
import type { PlaybackBrowserSnapshot } from "./apple-playback-protocol"
import { isPlaybackDocumentUrl } from "./apple-playback-origin"
import { ChromiumAudioQualityTracker } from "./chromium-audio-quality"
import { playbackBrowserEnvironment } from "./chromium-process"

const PAGE_READY_TIMEOUT_MS = 30_000

export type PlaybackProbeSnapshot = PlaybackBrowserSnapshot

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
  setStation(resourceId: string): Promise<void>
  setShuffleMode(mode: PlaybackShuffleMode): Promise<void>
  setRepeatMode(mode: PlaybackRepeatMode): Promise<void>
  click(control: PlaybackProbeControl): Promise<void>
  seek(positionSeconds: number): Promise<void>
  snapshot(): Promise<PlaybackProbeSnapshot>
  close(): Promise<void>
}

type PlaybackPageGlobal = typeof globalThis & {
  __nutkaPlayback: {
    initialize(
      developerToken: string,
      musicUserToken: string,
    ): Promise<{ authorized: boolean }>
    setQueue(resourceIds: readonly string[]): void
    setStation(resourceId: string): void
    setShuffleMode(mode: PlaybackShuffleMode): void
    setRepeatMode(mode: PlaybackRepeatMode): void
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
    const result = await this.page.evaluate(
      async ({ developerToken, musicUserToken }) => {
        const playback = (globalThis as PlaybackPageGlobal).__nutkaPlayback
        return playback.initialize(developerToken, musicUserToken)
      },
      { developerToken, musicUserToken },
    )
    if (result.authorized !== true) throw new Error("authorization_rejected")
  }

  async setQueue(resourceIds: readonly string[]): Promise<void> {
    await this.page.evaluate((ids) => {
      ;(globalThis as PlaybackPageGlobal).__nutkaPlayback.setQueue(ids)
    }, [...resourceIds])
  }

  async setStation(resourceId: string): Promise<void> {
    await this.page.evaluate((id) => {
      ;(globalThis as PlaybackPageGlobal).__nutkaPlayback.setStation(id)
    }, resourceId)
  }

  async setShuffleMode(mode: PlaybackShuffleMode): Promise<void> {
    await this.page.evaluate((value) => {
      ;(globalThis as PlaybackPageGlobal).__nutkaPlayback.setShuffleMode(value)
    }, mode)
  }

  async setRepeatMode(mode: PlaybackRepeatMode): Promise<void> {
    await this.page.evaluate((value) => {
      ;(globalThis as PlaybackPageGlobal).__nutkaPlayback.setRepeatMode(value)
    }, mode)
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
