import { describe, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"

import type { AudioSpectrumFrame } from "../../core/types"
import { createSpectrumVisualizer, formatSpectrumFrame, resampleSpectrum } from "./spectrum"

const palette = {
  low: "#112233",
  mid: "#445566",
  high: "#778899",
  peak: "#ffffff",
}

const frame: AudioSpectrumFrame = {
  sequence: 1,
  bands: Array.from({ length: 64 }, (_, index) => index * 4),
  rms: 128,
  peak: 240,
}

describe("SpectrumVisualizer", () => {
  test("resamples bounded frequency bands to the available width", () => {
    expect(resampleSpectrum([0, 64, 128, 255], 2)).toEqual([64, 255])
    expect(resampleSpectrum([0, 255], 3)).toEqual([0, 128, 255])
    expect(resampleSpectrum([], 3)).toEqual([0, 0, 0])

    const boundaryPeak = Array.from({ length: 64 }, () => 0)
    boundaryPeak[21] = 255
    expect(resampleSpectrum(boundaryPeak, 3)).toEqual([0, 255, 0])
  })

  test("formats bottom-up bars across three rows", () => {
    const formatted = formatSpectrumFrame([0, 128, 255], 3, 3, palette)
    const lines = formatted.chunks.map((chunk) => chunk.text).join("").split("\n")

    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe("  █")
    expect(lines[1]).toBe(" ▄█")
    expect(lines[2]).toBe(" ██")
  })

  test("uses the custom frequency palette and peak color", () => {
    const gradient = formatSpectrumFrame([200, 200, 200], 3, 1, palette)
    expect(gradient.chunks.map((chunk) => chunk.fg?.toInts().slice(0, 3))).toEqual([
      [17, 34, 51],
      [68, 85, 102],
      [119, 136, 153],
    ])

    const peaks = formatSpectrumFrame([255, 255, 255], 3, 1, palette)
    expect(peaks.chunks.every((chunk) => chunk.fg?.toInts().slice(0, 3).join() === "255,255,255"))
      .toBe(true)
  })

  test("renders real frames, freezes on pause, and hides when compact", async () => {
    const setup = await createTestRenderer({ width: 80, height: 10 })
    const visualizer = createSpectrumVisualizer(setup.renderer, {
      kind: "spectrum",
      palette,
      height: 3,
    })
    setup.renderer.root.add(visualizer.root)

    visualizer.renderStatus("playing")
    visualizer.renderFrame(frame)
    await setup.renderOnce()
    const playing = setup.captureCharFrame()
    expect(playing).toMatch(/[▁▂▃▄▅▆▇█]/)

    visualizer.renderStatus("paused")
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toBe(playing)

    visualizer.applyResponsiveLayout(40, true)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).not.toMatch(/[▁▂▃▄▅▆▇█]/)
    setup.renderer.destroy()
  })
})
