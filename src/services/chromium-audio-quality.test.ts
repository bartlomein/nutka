import { describe, expect, test } from "bun:test"

import {
  ChromiumAudioQualityTracker,
  deriveChromiumAudioQuality,
} from "./chromium-audio-quality"

describe("Chromium audio quality", () => {
  test("decodes actual AAC bitrate and sample rate", () => {
    const properties = new Map([
      ["kAudioTracks", JSON.stringify([{
        codec: "aac",
        channels: 2,
        "samples per second": 44_100,
      }])],
      ["kBitrate", "263526"],
    ])

    expect(deriveChromiumAudioQuality(properties)).toEqual({
      format: "aac",
      bitrateKbps: 264,
      sampleRateKhz: 44.1,
      source: "playback",
    })
  })

  test("recognizes lossless and rejects malformed diagnostics", () => {
    expect(deriveChromiumAudioQuality(new Map([
      ["kAudioCodecName", "ALAC"],
      ["kAudioSampleRate", "96000"],
    ]))).toEqual({
      format: "lossless",
      sampleRateKhz: 96,
      source: "playback",
    })
    expect(deriveChromiumAudioQuality(new Map([
      ["kAudioTracks", "not-json"],
      ["kBitrate", "secret"],
    ]))).toBeNull()
  })

  test("tracks bounded properties for the latest media player", () => {
    const tracker = new ChromiumAudioQualityTracker()
    tracker.update("player-1", [
      { name: "kAudioCodecName", value: "aac" },
      { name: "kAudioBitrate", value: "128000" },
    ])
    tracker.update("invalid/player", [
      { name: "kAudioCodecName", value: "ALAC" },
    ])
    expect(tracker.quality).toEqual({
      format: "aac",
      bitrateKbps: 128,
      source: "playback",
    })
  })
})
