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
    expect(frame).toContain("NEXT  Teardrop  ·  Massive Attack")
    expect(frame).toContain("AUDIO  LOSSLESS")
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
      currentTrack,
      queue: [nextTrack],
      positionSeconds: 102,
      durationSeconds: 379,
      errorMessage: null,
      connected: true,
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
    })

    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("×  playback unavailable")
    expect(frame).toContain("playback unavailable")
    expect(frame).toContain("Apple Music playback did not start")
    expect(frame).toContain("0:00")
    expect(frame).toContain("--:--")
    expect(frame).not.toContain("NEXT")
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
