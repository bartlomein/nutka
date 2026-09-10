import { afterEach, describe, expect, test } from "bun:test"

import type { Track } from "../core/types"
import type { VisualizerSettings } from "./visualizer"
import { catalogTracks } from "./test-support/app-data"
import { FakePlaybackController } from "./test-support/fake-playback"
import { createAppFixture } from "./test-support/app-fixture"

const fixture = createAppFixture()
const { createApp } = fixture
afterEach(fixture.destroy)

describe("Nutka TUI: visualizer", () => {
  test("toggles visualizer rendering and analysis capture with v", async () => {
    const playback = new FakePlaybackController()
    await createApp({ playback })
    playback.confirm({
      status: "playing",
      currentTrack: catalogTracks[0]!,
      queue: [],
      positionSeconds: 1,
      durationSeconds: 180,
      errorCode: null,
    })
    playback.confirmAnalysis({
      sequence: 1,
      bands: Array.from({ length: 64 }, () => 220),
      rms: 180,
      peak: 240,
    })
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame().match(/[▁▂▃▄▅▆▇█]/gu)?.length).toBeGreaterThanOrEqual(8)

    fixture.setup.mockInput.pressKey("v")
    await fixture.setup.renderOnce()
    expect(playback.analysisEnabledChanges).toEqual([false])
    expect(fixture.setup.captureCharFrame()).not.toMatch(/[▁▂▃▄▅▆▇█]/)

    fixture.setup.mockInput.pressKey("v")
    playback.confirmAnalysis({
      sequence: 2,
      bands: Array.from({ length: 64 }, () => 200),
      rms: 170,
      peak: 230,
    })
    await fixture.setup.renderOnce()
    expect(playback.analysisEnabledChanges).toEqual([false, true])
    expect(fixture.setup.captureCharFrame().match(/[▁▂▃▄▅▆▇█]/gu)?.length).toBeGreaterThanOrEqual(8)
  })

  test("previews, applies, and cancels visualizer settings with shift+v", async () => {
    const saved: VisualizerSettings[] = []
    await createApp({
      kittyKeyboard: true,
      visualizerSettings: {
        kind: "spectrum",
        style: "dense",
        palette: "theme",
        height: 3,
      },
      saveVisualizerSettings: (settings) => saved.push({ ...settings }),
    })

    fixture.setup.mockInput.pressKey("v", { shift: true })
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("visualizer settings")
    expect(fixture.setup.captureCharFrame()).toContain("‹ Dense ›")

    fixture.setup.mockInput.pressArrow("down")
    fixture.setup.mockInput.pressArrow("right")
    fixture.setup.mockInput.pressArrow("down")
    fixture.setup.mockInput.pressArrow("right")
    fixture.setup.mockInput.pressArrow("down")
    fixture.setup.mockInput.pressArrow("right")
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("‹ Spaced ›")
    expect(fixture.setup.captureCharFrame()).toContain("‹ Monochrome ›")
    expect(fixture.setup.captureCharFrame()).toContain("‹ 4 rows ›")

    fixture.setup.mockInput.pressEnter()
    expect(saved).toEqual([{
      kind: "spectrum",
      style: "spaced",
      palette: "monochrome",
      height: 4,
    }])

    fixture.setup.mockInput.pressKey("v", { shift: true })
    fixture.setup.mockInput.pressArrow("down")
    fixture.setup.mockInput.pressArrow("right")
    fixture.setup.mockInput.pressEscape()
    fixture.setup.mockInput.pressKey("v", { shift: true })
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("‹ Spaced ›")
    expect(fixture.setup.captureCharFrame()).not.toContain("‹ Wide ›")
  })

  test("keeps visualizer settings open when persistence fails", async () => {
    await createApp({
      kittyKeyboard: true,
      visualizerSettings: {
        kind: "spectrum",
        style: "dense",
        palette: "theme",
        height: 3,
      },
      saveVisualizerSettings: () => {
        throw new Error("disk unavailable")
      },
    })

    fixture.setup.mockInput.pressKey("v", { shift: true })
    fixture.setup.mockInput.pressArrow("down")
    fixture.setup.mockInput.pressArrow("right")
    fixture.setup.mockInput.pressEnter()
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("Could not save visualizer settings")

    fixture.setup.mockInput.pressEscape()
    fixture.setup.mockInput.pressKey("v", { shift: true })
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("‹ Dense ›")
  })

  test("keeps visualizer controls usable in a very small terminal", async () => {
    await createApp({ width: 30, height: 8, kittyKeyboard: true })

    fixture.setup.mockInput.pressKey("v", { shift: true })
    await fixture.setup.renderOnce()
    const frame = fixture.setup.captureCharFrame()
    expect(frame).toContain("Visualizer")
    expect(frame).toContain("Style")
    expect(frame).toContain("Palette")
    expect(frame).toContain("Height")
  })

  test("opens visualizer settings from an uppercase terminal key", async () => {
    await createApp()

    fixture.setup.mockInput.pressKey("V")
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("visualizer settings")
  })

  test("toggles the visualizer from the command palette", async () => {
    const playback = new FakePlaybackController()
    await createApp({ playback })

    fixture.setup.mockInput.pressKey("p", { ctrl: true })
    await fixture.setup.mockInput.typeText("visualizer")
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("Toggle visualizer")

    fixture.setup.mockInput.pressEnter()
    expect(fixture.app.getState().mode.type).toBe("normal")
    expect(playback.analysisEnabledChanges).toEqual([false])

    fixture.setup.mockInput.pressKey("p", { ctrl: true })
    await fixture.setup.mockInput.typeText("palette color height")
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("Visualizer settings")
    fixture.setup.mockInput.pressEnter()
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("visualizer settings")
  })

  test("keeps track rows visible at the visualizer layout threshold", async () => {
    await createApp({ width: 100, height: 18 })
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("l")
    await fixture.setup.renderOnce()

    expect(fixture.setup.captureCharFrame()).toContain("First Track")
  })

  test("reclaims the visualizer rows for workspace content when disabled", async () => {
    const tracks = Array.from({ length: 30 }, (_, index): Track => ({
      id: `track-${index + 1}`,
      title: `Track ${String(index + 1).padStart(2, "0")}`,
      artist: "Artist",
      album: "Album",
      durationSeconds: 180,
    }))
    await createApp({ width: 100, height: 32, tracks })
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("l")
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).not.toContain("Track 16")

    fixture.setup.mockInput.pressKey("v")
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("Track 16")
  })
})
