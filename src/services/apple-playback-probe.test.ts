import { describe, expect, test } from "bun:test"

import type { AppleCatalogTrack } from "../core/types"
import {
  ApplePlaybackProbeError,
  runApplePlaybackProbe,
  type PlaybackProbeBrowser,
  type PlaybackProbeControl,
  type PlaybackProbeSnapshot,
} from "./apple-playback-probe"

const track: AppleCatalogTrack = {
  id: "apple:song:12345",
  title: "A Song",
  artist: "An Artist",
  album: "An Album",
  durationSeconds: 180,
  apple: {
    resourceId: "12345",
    resourceType: "songs",
    playParams: { id: "12345", kind: "song" },
  },
}

const tokenFetch = async () => Response.json({
  token: "developer-secret",
  expiresAt: "2030-01-01T00:00:00.000Z",
  mode: "apple",
})

class FakeProbeBrowser implements PlaybackProbeBrowser {
  readonly processId = 42
  readonly controls: PlaybackProbeControl[] = []
  initializedWith?: { developerToken: string; musicUserToken: string }
  resourceId: string | null = null
  positionSeconds = 0
  isPlaying = false
  closed = false

  async initialize(developerToken: string, musicUserToken: string): Promise<void> {
    this.initializedWith = { developerToken, musicUserToken }
  }

  async setQueue(resourceIds: readonly string[]): Promise<void> {
    this.resourceId = resourceIds[0] ?? null
  }

  async setShuffleMode(): Promise<void> {}

  async setRepeatMode(): Promise<void> {}

  async click(control: PlaybackProbeControl): Promise<void> {
    this.controls.push(control)
    if (control === "play" || control === "resume") {
      this.isPlaying = true
      if (this.positionSeconds === 0) this.positionSeconds = 0.1
    } else {
      this.isPlaying = false
    }
  }

  async seek(positionSeconds: number): Promise<void> {
    this.positionSeconds = positionSeconds
  }

  async snapshot(): Promise<PlaybackProbeSnapshot> {
    return {
      initialized: true,
      authorized: true,
      isPlaying: this.isPlaying,
      positionSeconds: this.positionSeconds,
      durationSeconds: 180,
      resourceId: this.resourceId,
      title: track.title,
      artist: track.artist,
      lastErrorCode: null,
    }
  }

  async close(): Promise<void> {
    this.closed = true
  }

  advance(milliseconds: number): void {
    if (this.isPlaying) this.positionSeconds += milliseconds / 1_000
  }
}

describe("Apple playback probe", () => {
  test("proves time progression, audio, and playback controls", async () => {
    const browser = new FakeProbeBrowser()
    let now = 0

    const result = await runApplePlaybackProbe({
      serviceUrl: "http://127.0.0.1:8787",
      musicUserToken: "music-user-secret",
      track,
      executablePath: "/usr/bin/chromium",
      proofDurationSeconds: 2,
      fetch: tokenFetch,
      launchBrowser: async () => browser,
      detectAudioSink: async (processId) => processId === 42,
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds
        browser.advance(milliseconds)
      },
    })

    expect(browser.initializedWith).toEqual({
      developerToken: "developer-secret",
      musicUserToken: "music-user-secret",
    })
    expect(browser.controls).toEqual(["play", "pause", "resume", "stop"])
    expect(browser.closed).toBe(true)
    expect(result).toMatchObject({
      title: "A Song",
      artist: "An Artist",
      audioSinkDetected: true,
      pauseConfirmed: true,
      resumeConfirmed: true,
      seekConfirmed: true,
      stopConfirmed: true,
    })
    expect(result.playedSeconds).toBeGreaterThanOrEqual(2)
  })

  test("rejects invalid play parameters before launching a browser", async () => {
    let launched = false
    await expect(runApplePlaybackProbe({
      serviceUrl: "http://127.0.0.1:8787",
      musicUserToken: "music-user-secret",
      track: { ...track, apple: { ...track.apple, playParams: undefined } },
      executablePath: "/usr/bin/chromium",
      fetch: tokenFetch,
      launchBrowser: async () => {
        launched = true
        return new FakeProbeBrowser()
      },
    })).rejects.toMatchObject({ code: "invalid_track" })
    expect(launched).toBe(false)
  })

  test("rejects a non-loopback page before fetching or injecting tokens", async () => {
    let fetched = false
    let launched = false
    await expect(runApplePlaybackProbe({
      serviceUrl: "https://music.example.test",
      musicUserToken: "music-user-secret",
      track,
      executablePath: "/usr/bin/chromium",
      fetch: async () => {
        fetched = true
        return tokenFetch()
      },
      launchBrowser: async () => {
        launched = true
        return new FakeProbeBrowser()
      },
    })).rejects.toMatchObject({ code: "untrusted_playback_origin" })
    expect(fetched).toBe(false)
    expect(launched).toBe(false)
  })

  test("sanitizes browser launch failures", async () => {
    const secret = "music-user-secret"
    try {
      await runApplePlaybackProbe({
        serviceUrl: "http://127.0.0.1:8787",
        musicUserToken: secret,
        track,
        executablePath: "/usr/bin/chromium",
        fetch: tokenFetch,
        launchBrowser: async () => {
          throw new Error(`browser failed with ${secret}`)
        },
      })
      throw new Error("expected rejection")
    } catch (error) {
      expect(error).toBeInstanceOf(ApplePlaybackProbeError)
      expect(error).toMatchObject({ code: "browser_start_failed" })
      expect(String(error)).not.toContain(secret)
    }
  })

  test("reports when the persistent playback profile is not authorized", async () => {
    const browser = new FakeProbeBrowser()
    browser.initialize = async () => {
      throw new Error("authorization_rejected")
    }

    await expect(runApplePlaybackProbe({
      serviceUrl: "http://127.0.0.1:8787",
      musicUserToken: "music-user-secret",
      track,
      executablePath: "/usr/bin/chromium",
      fetch: tokenFetch,
      launchBrowser: async () => browser,
    })).rejects.toMatchObject({ code: "authorization_rejected" })
    expect(browser.closed).toBe(true)
  })
})
