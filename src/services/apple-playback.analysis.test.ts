import { describe, expect, test } from "bun:test"

import { tracks, setupController } from "./test-support/playback-fixtures"

describe("ApplePlaybackController: analysis", () => {
  test("publishes only analysis frames for the active confirmed load", async () => {
    const { controller, workers } = setupController()
    const frames: Array<readonly number[] | null> = []
    controller.audioAnalysis.subscribe((frame) => frames.push(frame?.bands ?? null))

    await controller.play(tracks[0], [])
    const worker = workers[0]!
    worker.emitSpectrum({
      loadId: 1,
      sequence: 0,
      bands: Array.from({ length: 64 }, () => 100),
      rms: 100,
      peak: 120,
    })
    expect(frames).toEqual([null])

    worker.emit({
      loadId: 1,
      resourceId: "1",
      status: "playing",
      positionSeconds: 1,
      durationSeconds: 180,
      errorCode: null,
      audioQuality: null,
    })
    worker.emitSpectrum({
      loadId: 1,
      sequence: 1,
      bands: Array.from({ length: 64 }, () => 140),
      rms: 130,
      peak: 180,
    })
    expect(frames.at(-1)?.[0]).toBe(140)

    await controller.play(tracks[1], [])
    worker.emitSpectrum({
      loadId: 1,
      sequence: 2,
      bands: Array.from({ length: 64 }, () => 220),
      rms: 200,
      peak: 240,
    })
    expect(frames.at(-1)).toBeNull()

    worker.emit({
      loadId: 2,
      resourceId: "2",
      status: "playing",
      positionSeconds: 1,
      durationSeconds: 180,
      errorCode: null,
      audioQuality: null,
    })
    worker.emitSpectrum({
      loadId: 2,
      sequence: 3,
      bands: Array.from({ length: 64 }, () => 200),
      rms: 180,
      peak: 230,
    })
    expect(frames.at(-1)?.[0]).toBe(200)

    await controller.disconnect()
    expect(frames.at(-1)).toBeNull()
    await controller.dispose()
  })

  test("isolates throwing analysis listeners from playback updates", async () => {
    const { controller, workers } = setupController()
    const received: number[] = []
    controller.audioAnalysis.subscribe(() => {
      throw new Error("renderer failed")
    })
    controller.audioAnalysis.subscribe((frame) => {
      if (frame) received.push(frame.sequence)
    })
    await controller.play(tracks[0], [])
    const worker = workers[0]!
    worker.emit({
      loadId: 1,
      resourceId: "1",
      status: "playing",
      positionSeconds: 1,
      durationSeconds: 180,
      errorCode: null,
      audioQuality: null,
    })
    worker.emitSpectrum({
      loadId: 1,
      sequence: 4,
      bands: Array.from({ length: 64 }, () => 100),
      rms: 100,
      peak: 120,
    })

    expect(received).toEqual([4])
    expect(controller.snapshot.status).toBe("playing")
    await controller.dispose()
  })

  test("suspends analysis without starting a worker and restores it on demand", async () => {
    const { controller, workers } = setupController()
    const frames: Array<readonly number[] | null> = []
    controller.audioAnalysis.subscribe((frame) => frames.push(frame?.bands ?? null))

    await controller.audioAnalysis.setEnabled(false)
    expect(workers).toHaveLength(0)
    await controller.play(tracks[0], [])
    const worker = workers[0]!
    expect(worker.analysisEnabledChanges).toEqual([false])
    worker.emit({
      loadId: 1,
      resourceId: "1",
      status: "playing",
      positionSeconds: 1,
      durationSeconds: 180,
      errorCode: null,
      audioQuality: null,
    })
    worker.emitSpectrum({
      loadId: 1,
      sequence: 1,
      bands: Array.from({ length: 64 }, () => 180),
      rms: 160,
      peak: 220,
    })
    expect(frames).toEqual([null])

    await controller.audioAnalysis.setEnabled(true)
    expect(worker.analysisEnabledChanges).toEqual([false, true])
    worker.emitSpectrum({
      loadId: 1,
      sequence: 2,
      bands: Array.from({ length: 64 }, () => 200),
      rms: 180,
      peak: 230,
    })
    expect(frames.at(-1)?.[0]).toBe(200)

    let releaseAnalysis!: () => void
    worker.analysisGate = new Promise<void>((resolve) => (releaseAnalysis = resolve))
    const disabling = controller.audioAnalysis.setEnabled(false)
    const enabling = controller.audioAnalysis.setEnabled(true)
    worker.emitSpectrum({
      loadId: 1,
      sequence: 3,
      bands: Array.from({ length: 64 }, () => 230),
      rms: 210,
      peak: 245,
    })
    expect(frames.at(-1)).toBeNull()
    releaseAnalysis()
    await Promise.all([disabling, enabling])
    worker.analysisGate = undefined
    worker.emitSpectrum({
      loadId: 1,
      sequence: 4,
      bands: Array.from({ length: 64 }, () => 210),
      rms: 190,
      peak: 235,
    })
    expect(frames.at(-1)?.[0]).toBe(210)

    await controller.audioAnalysis.setEnabled(false)
    expect(frames.at(-1)).toBeNull()
    worker.emitSpectrum({
      loadId: 1,
      sequence: 5,
      bands: Array.from({ length: 64 }, () => 240),
      rms: 220,
      peak: 250,
    })
    expect(frames.at(-1)).toBeNull()
    await controller.dispose()
  })
})
