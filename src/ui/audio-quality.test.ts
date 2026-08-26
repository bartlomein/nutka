import { describe, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"

import { createAudioQualityBadge, formatAudioQuality } from "./audio-quality"

describe("AudioQualityBadge", () => {
  test("formats catalog capability without inventing stream measurements", () => {
    expect(formatAudioQuality({
      format: "lossless",
      source: "catalog",
    })).toBe("AUDIO  LOSSLESS")
    expect(formatAudioQuality({
      format: "hi-res-lossless",
      source: "catalog",
    }, true)).toBe("AUDIO  HI-RES")
  })

  test("formats confirmed bitrate and lossless measurements", () => {
    expect(formatAudioQuality({
      format: "aac",
      bitrateKbps: 256,
      source: "playback",
    })).toBe("AAC · 256 kbps")
    expect(formatAudioQuality({
      format: "lossless",
      bitDepth: 24,
      sampleRateKhz: 96,
      source: "playback",
    })).toBe("LOSSLESS · 24-bit/96 kHz")
  })

  test("renders on the right-sized player and hides in compact layouts", async () => {
    const setup = await createTestRenderer({ width: 80, height: 3 })
    const badge = createAudioQualityBadge(setup.renderer)
    setup.renderer.root.add(badge.root)
    badge.applyResponsiveLayout(80, false)
    badge.render({ format: "dolby-atmos", source: "catalog" })
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("AUDIO  DOLBY ATMOS")

    badge.applyResponsiveLayout(80, true)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).not.toContain("DOLBY ATMOS")
    setup.renderer.destroy()
  })
})
