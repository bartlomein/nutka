import { describe, expect, test } from "bun:test"

import {
  PcmSpectrumAnalyzer,
  PipeWireSpectrumSource,
  selectPipeWireAudioStream,
  type SpectrumSample,
} from "./pipewire-audio-analysis"

describe("PcmSpectrumAnalyzer", () => {
  test("places real sine energy into low, middle, and high frequency bands", () => {
    const low = analyzeSine(80)
    const middle = analyzeSine(1_000)
    const high = analyzeSine(8_000)

    expect(maximumBand(low.bands)).toBeLessThan(16)
    expect(maximumBand(middle.bands)).toBeWithin(28, 41)
    expect(maximumBand(high.bands)).toBeGreaterThan(50)
    expect(low.peak).toBeGreaterThan(200)
  })

  test("keeps equal-amplitude tones level across logarithmic band widths", () => {
    const levels = [7, 85, 682].map((bin) =>
      Math.max(...analyzeSine(bin * 48_000 / 4_096).bands))

    expect(Math.max(...levels) - Math.min(...levels)).toBeLessThanOrEqual(2)
  })

  test("handles arbitrary byte boundaries without changing the analysis", () => {
    const pcm = sinePcm(440, 8_192)
    const whole: SpectrumSample[] = []
    const chunked: SpectrumSample[] = []
    const wholeAnalyzer = new PcmSpectrumAnalyzer((frame) => whole.push(frame))
    const chunkedAnalyzer = new PcmSpectrumAnalyzer((frame) => chunked.push(frame))

    wholeAnalyzer.push(pcm)
    for (let offset = 0; offset < pcm.byteLength; offset += 137) {
      chunkedAnalyzer.push(pcm.slice(offset, offset + 137))
    }

    expect(chunked).toEqual(whole)
    expect(whole).toHaveLength(2)
  })

  test("does not skip transients between spectrum frames", () => {
    const frames: SpectrumSample[] = []
    const analyzer = new PcmSpectrumAnalyzer((frame) => frames.push(frame))
    const bytes = new Uint8Array(10_240 * Float32Array.BYTES_PER_ELEMENT)
    const view = new DataView(bytes.buffer)
    for (let index = 2_200; index < 3_000; index++) {
      view.setFloat32(index * Float32Array.BYTES_PER_ELEMENT, 0.9, true)
    }

    analyzer.push(bytes)

    expect(frames.some((frame) => frame.peak > 0)).toBe(true)
  })

  test("releases displayed energy toward zero during silence", () => {
    const frames: SpectrumSample[] = []
    const analyzer = new PcmSpectrumAnalyzer((frame) => frames.push(frame))
    analyzer.push(sinePcm(220, 8_192))
    const active = Math.max(...frames.at(-1)!.bands)
    analyzer.push(new Uint8Array(32_768 * Float32Array.BYTES_PER_ELEMENT))

    expect(Math.max(...frames.at(-1)!.bands)).toBeLessThan(active / 2)
    expect(frames.at(-1)!.rms).toBe(0)
  })
})

describe("PipeWire spectrum capture", () => {
  test("selects only an active stream owned by a Chromium descendant", async () => {
    const selected = await selectPipeWireAudioStream([
      sinkInput("10", 500, false),
      sinkInput("11", 201, true),
      sinkInput("12", 202, false),
    ], 100, async (processId, ancestorId) =>
      ancestorId === 100 && [201, 202].includes(processId))

    expect(selected).toEqual({ serial: "12", processId: 202, corked: false })
  })

  test("stops and waits for its supervised capture process", async () => {
    let streamController!: ReadableStreamDefaultController<Uint8Array>
    let resolveExit!: (code: number) => void
    const exited = new Promise<number>((resolve) => (resolveExit = resolve))
    const kills: Array<number | string | undefined> = []
    const frames: SpectrumSample[] = []
    const child = {
      stdout: new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller
          controller.enqueue(sinePcm(440, 4_096))
        },
      }),
      exited,
      kill(signal?: number | string) {
        kills.push(signal)
        streamController.close()
        resolveExit(0)
      },
    }
    const source = new PipeWireSpectrumSource({
      browserProcessId: 100,
      onFrame: (frame) => frames.push(frame),
      discoverStream: async () => ({ serial: "12", processId: 202, corked: false }),
      spawnCapture: () => child,
    })

    source.start()
    while (frames.length === 0) await Bun.sleep(0)
    await source.stop()

    expect(frames).toHaveLength(1)
    expect(kills).toContain("SIGTERM")
  })

  test("stops promptly while stream discovery is pending", async () => {
    const source = new PipeWireSpectrumSource({
      browserProcessId: 100,
      onFrame: () => {},
      discoverStream: () => new Promise(() => {}),
    })

    source.start()
    await Bun.sleep(0)
    const started = performance.now()
    await source.stop()

    expect(performance.now() - started).toBeLessThan(100)
  })

  test("stops promptly during a pending retry delay", async () => {
    let discoveryCount = 0
    const source = new PipeWireSpectrumSource({
      browserProcessId: 100,
      onFrame: () => {},
      discoverStream: async () => {
        discoveryCount++
        return null
      },
      sleep: () => new Promise(() => {}),
    })

    source.start()
    while (discoveryCount === 0) await Bun.sleep(0)
    const started = performance.now()
    await source.stop()

    expect(performance.now() - started).toBeLessThan(100)
  })

  test("continues consuming PCM while periodic discovery is pending", async () => {
    let discoveryCount = 0
    let streamController!: ReadableStreamDefaultController<Uint8Array>
    let resolveExit!: (code: number) => void
    const exited = new Promise<number>((resolve) => (resolveExit = resolve))
    const frames: SpectrumSample[] = []
    const child = {
      stdout: new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller
          controller.enqueue(sinePcm(440, 4_096))
        },
      }),
      exited,
      kill() {
        streamController.close()
        resolveExit(0)
      },
    }
    const source = new PipeWireSpectrumSource({
      browserProcessId: 100,
      onFrame: (frame) => frames.push(frame),
      discoverStream: async (_processId, signal) => {
        discoveryCount++
        if (discoveryCount === 1) {
          return { serial: "1", processId: 202, corked: false }
        }
        return new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve(null), { once: true })
        })
      },
      spawnCapture: () => child,
      sleep: () => Bun.sleep(1),
    })

    source.start()
    while (discoveryCount < 2) await Bun.sleep(0)
    streamController.enqueue(sinePcm(440, 3_072))
    const deadline = Date.now() + 100
    while (frames.length < 2 && Date.now() < deadline) await Bun.sleep(0)
    await source.stop()

    expect(frames).toHaveLength(2)
  })

  test("clears stale output and replaces a changed capture stream", async () => {
    let discoveryCount = 0
    let unavailableCount = 0
    const kills: Array<number | string | undefined> = []
    let streamController!: ReadableStreamDefaultController<Uint8Array>
    let resolveExit!: (code: number) => void
    const exited = new Promise<number>((resolve) => (resolveExit = resolve))
    const child = {
      stdout: new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller
          controller.enqueue(sinePcm(440, 4_096))
        },
      }),
      exited,
      kill(signal?: number | string) {
        kills.push(signal)
        if (signal === "SIGKILL") {
          streamController.close()
          resolveExit(0)
        }
      },
    }
    const source = new PipeWireSpectrumSource({
      browserProcessId: 100,
      onFrame: () => {},
      onUnavailable: () => unavailableCount++,
      discoverStream: async () => {
        discoveryCount++
        return discoveryCount <= 2
          ? { serial: String(discoveryCount), processId: 202, corked: false }
          : null
      },
      spawnCapture: () => child,
      sleep: () => Bun.sleep(1),
    })

    source.start()
    while (unavailableCount === 0) await Bun.sleep(0)
    await source.stop()

    expect(discoveryCount).toBeGreaterThanOrEqual(2)
    expect(kills).toContain("SIGTERM")
    expect(kills).toContain("SIGKILL")
    expect(unavailableCount).toBe(1)
  })
})

function analyzeSine(frequency: number): SpectrumSample {
  const frames: SpectrumSample[] = []
  const analyzer = new PcmSpectrumAnalyzer((frame) => frames.push(frame))
  analyzer.push(sinePcm(frequency, 8_192))
  return frames.at(-1)!
}

function sinePcm(frequency: number, length: number): Uint8Array {
  const bytes = new Uint8Array(length * Float32Array.BYTES_PER_ELEMENT)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < length; index++) {
    view.setFloat32(
      index * Float32Array.BYTES_PER_ELEMENT,
      Math.sin(2 * Math.PI * frequency * index / 48_000) * 0.8,
      true,
    )
  }
  return bytes
}

function maximumBand(bands: readonly number[]): number {
  let maximumIndex = 0
  for (let index = 1; index < bands.length; index++) {
    if (bands[index]! > bands[maximumIndex]!) maximumIndex = index
  }
  return maximumIndex
}

function sinkInput(serial: string, processId: number, corked: boolean): object {
  return {
    index: Number(serial),
    properties: {
      "object.serial": serial,
      "application.process.id": String(processId),
      "media.class": "Stream/Output/Audio",
      "pulse.corked": String(corked),
    },
  }
}
