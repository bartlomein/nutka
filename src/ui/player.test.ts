import { describe, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"

import type { Track } from "../core/types"
import { createPlayerPanel, formatProgressLine } from "./player"

const currentTrack: Track = {
  id: "current",
  title: "Angel",
  artist: "Massive Attack",
  album: "Mezzanine",
  durationSeconds: 379,
  audioQuality: { format: "lossless", source: "catalog" },
}

const nextTrack: Track = {
  id: "next",
  title: "Teardrop",
  artist: "Massive Attack",
  album: "Mezzanine",
  durationSeconds: 330,
}

describe("PlayerPanel", () => {
  test("centers playback hierarchy and keeps next and quality at the edges", async () => {
    const setup = await createTestRenderer({ width: 100, height: 8 })
    const player = createPlayerPanel(setup.renderer)
    setup.renderer.root.add(player.root)
    player.applyResponsiveLayout(100, false)
    player.render({
      status: "playing",
      currentTrack,
      queue: [nextTrack],
      positionSeconds: 102,
      durationSeconds: 379,
      errorMessage: null,
      connected: true,
      shuffleMode: "songs",
      repeatMode: "all",
      canSetShuffleMode: true,
      canSetRepeatMode: true,
    })
    player.renderAudioAnalysis({
      sequence: 1,
      bands: Array.from({ length: 64 }, (_, index) => index * 4),
      rms: 160,
      peak: 240,
    })

    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("▶  Angel")
    expect(frame).toContain("Angel")
    expect(frame).toContain("Massive Attack  ·  Mezzanine")
    expect(frame).toContain("1:42")
    expect(frame).toContain("6:19")
    expect(frame).toContain("━")
    expect(frame).toContain("●")
    expect(frame).toMatch(/[▁▂▃▄▅▆▇█]{16,}/)
    expect(frame).toContain("NEXT  Teardrop  ·  Massive Attack")
    expect(frame).toContain("AUDIO  LOSSLESS")
    expect(frame).toContain("SHUFFLE ON")
    expect(frame).toContain("REPEAT ALL")
    expect(frame).not.toContain("SPACE  PAUSE")
    const lines = frame.split("\n")
    expect(lines.find((line) => line.includes("▶  Angel"))?.indexOf("▶")).toBeGreaterThan(40)
    expect(
      lines.find((line) => line.includes("Massive Attack  ·  Mezzanine"))
        ?.indexOf("Massive Attack"),
    ).toBeGreaterThan(30)
    setup.renderer.destroy()
  })

  test("collapses to title and progress in a compact terminal", async () => {
    const setup = await createTestRenderer({ width: 40, height: 4 })
    const player = createPlayerPanel(setup.renderer)
    setup.renderer.root.add(player.root)
    player.applyResponsiveLayout(40, true)
    player.render({
      status: "paused",
      currentTrack: { ...currentTrack, title: "Angel With A Very Long Terminal Title" },
      queue: [nextTrack],
      positionSeconds: 102,
      durationSeconds: 379,
      errorMessage: null,
      connected: true,
      shuffleMode: "songs",
      repeatMode: "one",
      canSetShuffleMode: true,
      canSetRepeatMode: true,
    })

    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("Ⅱ")
    expect(frame).toContain("Angel")
    expect(frame).toContain("1:42")
    expect(frame).toContain("6:19")
    expect(frame).not.toContain("Massive Attack")
    expect(frame).not.toContain("NEXT")
    expect(frame).not.toContain("SPACE")
    expect(frame).not.toMatch(/[▁▂▃▄▅▆▇█]{4,}/)
    expect(frame).toContain("[S:on] [R:1]")
    setup.renderer.destroy()
  })

  test("collapses and clears stale analysis when the visualizer is disabled", async () => {
    const setup = await createTestRenderer({ width: 80, height: 8 })
    const player = createPlayerPanel(setup.renderer)
    setup.renderer.root.add(player.root)
    player.render({
      status: "playing",
      currentTrack,
      queue: [],
      positionSeconds: 10,
      durationSeconds: 379,
      errorMessage: null,
      connected: true,
      shuffleMode: "off",
      repeatMode: "none",
      canSetShuffleMode: true,
      canSetRepeatMode: true,
    })
    player.renderAudioAnalysis({
      sequence: 1,
      bands: Array.from({ length: 64 }, () => 220),
      rms: 180,
      peak: 240,
    })
    await setup.renderOnce()
    expect(player.root.height).toBe(8)
    expect(setup.captureCharFrame()).toMatch(/[▁▂▃▄▅▆▇█]{8,}/)

    player.setVisualizerEnabled(false)
    player.renderAudioAnalysis({
      sequence: 2,
      bands: Array.from({ length: 64 }, () => 255),
      rms: 255,
      peak: 255,
    })
    await setup.renderOnce()
    expect(player.root.height).toBe(5)
    expect(setup.captureCharFrame()).not.toMatch(/[▁▂▃▄▅▆▇█]{8,}/)

    player.setVisualizerEnabled(true)
    await setup.renderOnce()
    expect(player.root.height).toBe(8)
    expect(setup.captureCharFrame()).not.toMatch(/[▁▂▃▄▅▆▇█]{8,}/)

    player.applyResponsiveLayout(80, true)
    await setup.renderOnce()
    expect(player.root.height).toBe(3)
    setup.renderer.destroy()
  })

  test("seeks proportionally when the progress rail is clicked or dragged", async () => {
    const seeks: number[] = []
    const setup = await createTestRenderer({ width: 100, height: 8 })
    const player = createPlayerPanel(setup.renderer, {
      onSeek: (positionSeconds) => seeks.push(positionSeconds),
    })
    setup.renderer.root.add(player.root)
    player.applyResponsiveLayout(100, false)
    player.render({
      status: "playing",
      currentTrack,
      queue: [],
      positionSeconds: 0,
      durationSeconds: 379,
      errorMessage: null,
      connected: true,
      shuffleMode: "off",
      repeatMode: "none",
      canSetShuffleMode: true,
      canSetRepeatMode: true,
    })

    await setup.renderOnce()
    const lines = setup.captureCharFrame().split("\n")
    const progressY = lines.findIndex((line) => line.includes("0:00") && line.includes("6:19"))
    const progressLine = lines[progressY]!
    const barStart = progressLine.indexOf("●")
    const barEnd = progressLine.lastIndexOf("─")
    const threeQuarters = barStart + Math.round((barEnd - barStart) * 0.75)
    const expectedPosition = 379 * (threeQuarters - barStart) / (barEnd - barStart)

    await setup.mockMouse.click(threeQuarters, progressY)
    expect(seeks.at(-1)).toBeCloseTo(expectedPosition, 5)

    await setup.mockMouse.drag(barStart, progressY, threeQuarters, progressY)
    expect(seeks.at(-1)).toBeCloseTo(expectedPosition, 5)
    setup.renderer.destroy()
  })

  test("renders a sanitized unavailable state without invented metadata", async () => {
    const setup = await createTestRenderer({ width: 80, height: 8 })
    const player = createPlayerPanel(setup.renderer)
    setup.renderer.root.add(player.root)
    player.applyResponsiveLayout(80, false)
    player.render({
      status: "idle",
      currentTrack: null,
      queue: [],
      positionSeconds: 0,
      durationSeconds: null,
      errorMessage: "Apple Music playback did not start",
      connected: true,
      shuffleMode: "off",
      repeatMode: "none",
      canSetShuffleMode: false,
      canSetRepeatMode: false,
    })

    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("×  playback unavailable")
    expect(frame).toContain("playback unavailable")
    expect(frame).toContain("Apple Music playback did not start")
    expect(frame).toContain("0:00")
    expect(frame).toContain("--:--")
    expect(frame).not.toContain("NEXT  ")
    setup.renderer.destroy()
  })

  test("renders confirmed playback modes around compact transport icons", async () => {
    const setup = await createTestRenderer({ width: 100, height: 8 })
    const player = createPlayerPanel(setup.renderer)
    setup.renderer.root.add(player.root)
    player.render({
      status: "playing",
      currentTrack,
      queue: [nextTrack],
      positionSeconds: 0,
      durationSeconds: 379,
      errorMessage: null,
      connected: true,
      shuffleMode: "off",
      repeatMode: "none",
      canSetShuffleMode: true,
      canSetRepeatMode: true,
    })

    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("SHUFFLE OFF")
    expect(frame).toContain("REPEAT OFF")
    expect(frame).toContain("│◀ Ⅱ ▶│")
    expect(frame).not.toContain("PREV b")
    expect(frame).not.toContain("NEXT n")
    setup.renderer.destroy()
  })

  test("describes repeat behavior at the end of the queue", async () => {
    const setup = await createTestRenderer({ width: 80, height: 8 })
    const player = createPlayerPanel(setup.renderer)
    setup.renderer.root.add(player.root)
    const state = {
      status: "playing" as const,
      currentTrack,
      queue: [nextTrack],
      positionSeconds: 0,
      durationSeconds: 379,
      errorMessage: null,
      connected: true,
      shuffleMode: "off" as const,
      repeatMode: "one" as const,
      canSetShuffleMode: true,
      canSetRepeatMode: true,
    }

    player.render(state)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("NEXT  repeat current song")

    player.render({ ...state, repeatMode: "all" })
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("NEXT  Teardrop")

    player.render({ ...state, queue: [], repeatMode: "all" })
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("NEXT  queue repeats")
    setup.renderer.destroy()
  })
})

describe("formatProgressLine", () => {
  test("clamps progress and handles missing duration", () => {
    expect(formatProgressLine(500, 100, 8, true)).toBe("1:40  ━━━━━━━●  1:40")
    expect(formatProgressLine(Number.NaN, null, 4, false)).toBe(
      "0:00  ────  --:--",
    )
  })
})
