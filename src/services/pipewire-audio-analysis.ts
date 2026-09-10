import {
  isDescendantProcess,
  playbackBrowserEnvironment,
} from "./chromium-process"
import { PLAYBACK_SPECTRUM_BAND_COUNT } from "./apple-playback-protocol"

const sampleRate = 48_000
const fftSize = 4_096
const frameHopSamples = 3_072
const minimumFrequency = 40
const maximumFrequency = 18_000
const maximumPactlOutputBytes = 256 * 1024
const discoveryRetryMs = 750
const discoveryTimeoutMs = 1_000
const captureRetryMs = 1_500
const processStopTimeoutMs = 1_000
const processForceKillMs = 250

export interface SpectrumSample {
  readonly bands: readonly number[]
  readonly rms: number
  readonly peak: number
}

export interface PipeWireAudioStream {
  readonly serial: string
  readonly processId: number
  readonly corked: boolean
}

interface ChildProcess {
  readonly stdout: ReadableStream<Uint8Array>
  readonly exited: Promise<number>
  kill(signal?: number | string): void
}

export interface PipeWireSpectrumSourceOptions {
  browserProcessId: number
  onFrame(frame: SpectrumSample): void
  onUnavailable?(): void
  environment?: NodeJS.ProcessEnv
  discoverStream?: (
    browserProcessId: number,
    signal: AbortSignal,
  ) => Promise<PipeWireAudioStream | null>
  spawnCapture?: (stream: PipeWireAudioStream) => ChildProcess
  sleep?: (milliseconds: number) => Promise<void>
}

export class PcmSpectrumAnalyzer {
  private readonly samples = new Float64Array(fftSize)
  private readonly smoothedBands = new Float64Array(PLAYBACK_SPECTRUM_BAND_COUNT)
  private remainder = new Uint8Array(0)
  private writeIndex = 0
  private samplesSeen = 0
  private nextFrameAt = fftSize

  constructor(private readonly onFrame: (frame: SpectrumSample) => void) {}

  push(chunk: Uint8Array): void {
    if (chunk.byteLength === 0) return
    const bytes = this.remainder.byteLength > 0
      ? joinBytes(this.remainder, chunk)
      : chunk
    const completeBytes = bytes.byteLength - bytes.byteLength % Float32Array.BYTES_PER_ELEMENT
    const view = new DataView(bytes.buffer, bytes.byteOffset, completeBytes)

    for (let offset = 0; offset < completeBytes; offset += Float32Array.BYTES_PER_ELEMENT) {
      const value = view.getFloat32(offset, true)
      this.samples[this.writeIndex] = Number.isFinite(value)
        ? Math.max(-1, Math.min(1, value))
        : 0
      this.writeIndex = (this.writeIndex + 1) % fftSize
      this.samplesSeen++
      if (this.samplesSeen >= this.nextFrameAt) {
        this.onFrame(analyzeWindow(this.orderedWindow(), this.smoothedBands))
        this.nextFrameAt += frameHopSamples
      }
    }

    this.remainder = completeBytes === bytes.byteLength
      ? new Uint8Array(0)
      : bytes.slice(completeBytes)
  }

  reset(): void {
    this.samples.fill(0)
    this.smoothedBands.fill(0)
    this.remainder = new Uint8Array(0)
    this.writeIndex = 0
    this.samplesSeen = 0
    this.nextFrameAt = fftSize
  }

  private orderedWindow(): Float64Array {
    const window = new Float64Array(fftSize)
    for (let index = 0; index < fftSize; index++) {
      window[index] = this.samples[(this.writeIndex + index) % fftSize]!
    }
    return window
  }
}

export class PipeWireSpectrumSource {
  private active = false
  private loopPromise?: Promise<void>
  private child?: ChildProcess
  private discovery?: AbortController
  private wakeWait?: () => void
  private available = false

  constructor(private readonly options: PipeWireSpectrumSourceOptions) {}

  start(): void {
    if (this.active) return
    this.active = true
    const loop = this.run().catch(() => {})
    this.loopPromise = loop
    void loop.then(() => {
      if (this.loopPromise === loop) this.loopPromise = undefined
    })
  }

  async stop(): Promise<void> {
    this.active = false
    this.discovery?.abort()
    this.wakeWait?.()
    const child = this.child
    if (child) killProcess(child, "SIGTERM")
    const loop = this.loopPromise
    if (!loop) return
    const stopped = await Promise.race([
      loop.then(() => true, () => true),
      Bun.sleep(processStopTimeoutMs).then(() => false),
    ])
    if (!stopped && child && child === this.child) killProcess(child, "SIGKILL")
    await loop.catch(() => {})
  }

  private async run(): Promise<void> {
    const discover = this.options.discoverStream ?? ((browserProcessId, signal) =>
      discoverPipeWireAudioStream(
        browserProcessId,
        this.options.environment ?? process.env,
        signal,
      ))
    const spawnCapture = this.options.spawnCapture ?? ((stream) =>
      spawnPipeWireCapture(stream, this.options.environment ?? process.env))
    const sleep = this.options.sleep ?? Bun.sleep

    while (this.active) {
      const stream = await this.discover(discover)
      if (!this.active) return
      if (!stream || stream.corked) {
        this.markUnavailable()
        await this.wait(discoveryRetryMs, sleep)
        continue
      }

      const analyzer = new PcmSpectrumAnalyzer((frame) => {
        this.available = true
        this.options.onFrame(frame)
      })
      let child: ChildProcess
      try {
        child = spawnCapture(stream)
      } catch {
        await this.wait(captureRetryMs, sleep)
        continue
      }
      this.child = child
      try {
        await this.consumeCapture(child, stream, analyzer, discover, sleep)
      } catch {
      } finally {
        await stopChildProcess(child)
        if (this.child === child) this.child = undefined
      }
      this.markUnavailable()
      if (this.active) await this.wait(captureRetryMs, sleep)
    }
  }

  private async discover(
    discover: NonNullable<PipeWireSpectrumSourceOptions["discoverStream"]>,
  ): Promise<PipeWireAudioStream | null | undefined> {
    const controller = new AbortController()
    this.discovery = controller
    let timeout: ReturnType<typeof setTimeout> | undefined
    const aborted = new Promise<undefined>((resolve) => {
      controller.signal.addEventListener("abort", () => resolve(undefined), { once: true })
      timeout = setTimeout(() => controller.abort(), discoveryTimeoutMs)
      timeout.unref()
    })
    try {
      return await Promise.race([
        discover(this.options.browserProcessId, controller.signal).catch(() => undefined),
        aborted,
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
      if (this.discovery === controller) this.discovery = undefined
    }
  }

  private async consumeCapture(
    child: ChildProcess,
    stream: PipeWireAudioStream,
    analyzer: PcmSpectrumAnalyzer,
    discover: NonNullable<PipeWireSpectrumSourceOptions["discoverStream"]>,
    sleep: (milliseconds: number) => Promise<void>,
  ): Promise<void> {
    const reader = child.stdout.getReader()
    let pending = reader.read()
    const never = new Promise<never>(() => {})
    let check: Promise<{ type: "check" }> | undefined = this.wait(
      discoveryRetryMs,
      sleep,
    ).then(() => ({ type: "check" as const }))
    let checking: Promise<{
      type: "discovery"
      stream: PipeWireAudioStream | null | undefined
    }> | undefined
    while (this.active) {
      const outcome = await Promise.race([
        pending.then((result) => ({ type: "read" as const, result })),
        check ?? never,
        checking ?? never,
      ])
      if (outcome.type === "check") {
        if (!this.active) return
        check = undefined
        checking = this.discover(discover).then((stream) => ({
          type: "discovery" as const,
          stream,
        }))
        continue
      }
      if (outcome.type === "discovery") {
        checking = undefined
        const current = outcome.stream
        if (
          !this.active ||
          (current !== undefined && (
            !current ||
            current.corked ||
            current.serial !== stream.serial
          ))
        ) {
          killProcess(child, "SIGTERM")
          return
        }
        check = this.wait(discoveryRetryMs, sleep).then(() => ({ type: "check" as const }))
        continue
      }
      if (outcome.result.done) return
      analyzer.push(outcome.result.value)
      pending = reader.read()
    }
  }

  private async wait(
    milliseconds: number,
    sleep: (milliseconds: number) => Promise<void>,
  ): Promise<void> {
    let wake!: () => void
    const interrupted = new Promise<void>((resolve) => (wake = resolve))
    this.wakeWait = wake
    try {
      await Promise.race([sleep(milliseconds), interrupted])
    } finally {
      if (this.wakeWait === wake) this.wakeWait = undefined
    }
  }

  private markUnavailable(): void {
    if (!this.available) return
    this.available = false
    this.options.onUnavailable?.()
  }
}

export async function discoverPipeWireAudioStream(
  browserProcessId: number,
  environment: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
): Promise<PipeWireAudioStream | null> {
  if (process.platform !== "linux" || !Number.isInteger(browserProcessId)) return null
  const child = Bun.spawn({
    cmd: ["/usr/bin/pactl", "-f", "json", "list", "sink-inputs"],
    env: playbackBrowserEnvironment(environment),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  }) as unknown as ChildProcess
  const abort = (): void => {
    killProcess(child, "SIGTERM")
    killProcess(child, "SIGKILL")
  }
  if (signal?.aborted) abort()
  else signal?.addEventListener("abort", abort, { once: true })
  let output: Uint8Array | null
  let exitCode: number
  try {
    output = await readBounded(child.stdout, maximumPactlOutputBytes)
    if (!output) killProcess(child, "SIGKILL")
    exitCode = await child.exited
  } finally {
    signal?.removeEventListener("abort", abort)
  }
  if (signal?.aborted) return null
  if (!output || exitCode !== 0) throw new Error("pipewire_discovery_failed")

  let inputs: unknown
  try {
    inputs = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(output))
  } catch {
    throw new Error("pipewire_discovery_failed")
  }
  return selectPipeWireAudioStream(inputs, browserProcessId, isDescendantProcess)
}

export async function selectPipeWireAudioStream(
  inputs: unknown,
  browserProcessId: number,
  isDescendant: (processId: number, ancestorId: number) => Promise<boolean>,
): Promise<PipeWireAudioStream | null> {
  if (!Array.isArray(inputs)) return null
  const candidates: PipeWireAudioStream[] = []
  for (const input of inputs) {
    if (!input || typeof input !== "object" || Array.isArray(input)) continue
    const record = input as Record<string, unknown>
    const properties = record.properties
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) continue
    const values = properties as Record<string, unknown>
    if (values["media.class"] !== "Stream/Output/Audio") continue
    const processId = Number(values["application.process.id"])
    const serialValue = values["object.serial"] ?? record.index
    const serial = typeof serialValue === "number" ? String(serialValue) : serialValue
    if (
      !Number.isInteger(processId) ||
      typeof serial !== "string" ||
      !/^\d{1,20}$/.test(serial) ||
      !(await isDescendant(processId, browserProcessId))
    ) continue
    candidates.push({
      serial,
      processId,
      corked: String(values["pulse.corked"]) === "true",
    })
  }
  return candidates.sort((left, right) =>
    Number(left.corked) - Number(right.corked) || Number(right.serial) - Number(left.serial)
  )[0] ?? null
}

function spawnPipeWireCapture(
  stream: PipeWireAudioStream,
  environment: NodeJS.ProcessEnv,
): ChildProcess {
  return Bun.spawn({
    cmd: [
      "/usr/bin/pw-record",
      "--target",
      stream.serial,
      "--latency",
      "64ms",
      "--rate",
      String(sampleRate),
      "--channels",
      "1",
      "--channel-map",
      "MONO",
      "--format",
      "f32",
      "--raw",
      "-",
    ],
    env: playbackBrowserEnvironment(environment),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  }) as unknown as ChildProcess
}

function analyzeWindow(
  samples: Float64Array,
  smoothedBands: Float64Array,
): SpectrumSample {
  let squareSum = 0
  let peak = 0
  const real = new Float64Array(fftSize)
  const imaginary = new Float64Array(fftSize)
  for (let index = 0; index < fftSize; index++) {
    const sample = samples[index]!
    squareSum += sample * sample
    peak = Math.max(peak, Math.abs(sample))
    const hann = 0.5 * (1 - Math.cos(2 * Math.PI * index / (fftSize - 1)))
    real[index] = sample * hann
  }

  fft(real, imaginary)
  const magnitudes = new Float64Array(fftSize / 2)
  for (let index = 1; index < magnitudes.length; index++) {
    magnitudes[index] = Math.hypot(real[index]!, imaginary[index]!) * 4 / fftSize
  }

  const bands = new Array<number>(PLAYBACK_SPECTRUM_BAND_COUNT)
  const ratio = maximumFrequency / minimumFrequency
  const binWidth = sampleRate / fftSize
  for (let band = 0; band < bands.length; band++) {
    const low = minimumFrequency * Math.pow(ratio, band / bands.length)
    const high = minimumFrequency * Math.pow(ratio, (band + 1) / bands.length)
    let firstBin = Math.max(1, Math.ceil(low / binWidth))
    let lastBin = Math.min(magnitudes.length - 1, Math.floor(high / binWidth))
    if (lastBin < firstBin) {
      firstBin = Math.max(1, Math.min(magnitudes.length - 1, Math.round((low + high) / 2 / binWidth)))
      lastBin = firstBin
    }
    let magnitude = 0
    for (let bin = firstBin; bin <= lastBin; bin++) {
      magnitude = Math.max(magnitude, magnitudes[bin]!)
    }
    const target = normalizeDecibels(magnitude, -78, -6)
    const previous = smoothedBands[band]!
    const smoothing = target > previous ? 0.68 : 0.2
    const smoothed = previous + (target - previous) * smoothing
    smoothedBands[band] = smoothed
    bands[band] = toByte(smoothed)
  }

  return {
    bands,
    rms: toByte(normalizeDecibels(Math.sqrt(squareSum / fftSize), -60, -3)),
    peak: toByte(normalizeDecibels(peak, -60, -1)),
  }
}

function fft(real: Float64Array, imaginary: Float64Array): void {
  const length = real.length
  for (let index = 1, reversed = 0; index < length; index++) {
    let bit = length >> 1
    while (reversed & bit) {
      reversed ^= bit
      bit >>= 1
    }
    reversed ^= bit
    if (index >= reversed) continue
    const realValue = real[index]!
    real[index] = real[reversed]!
    real[reversed] = realValue
    const imaginaryValue = imaginary[index]!
    imaginary[index] = imaginary[reversed]!
    imaginary[reversed] = imaginaryValue
  }

  for (let size = 2; size <= length; size <<= 1) {
    const angle = -2 * Math.PI / size
    const stepReal = Math.cos(angle)
    const stepImaginary = Math.sin(angle)
    for (let start = 0; start < length; start += size) {
      let rotationReal = 1
      let rotationImaginary = 0
      for (let offset = 0; offset < size / 2; offset++) {
        const even = start + offset
        const odd = even + size / 2
        const oddReal = real[odd]! * rotationReal - imaginary[odd]! * rotationImaginary
        const oddImaginary = real[odd]! * rotationImaginary + imaginary[odd]! * rotationReal
        real[odd] = real[even]! - oddReal
        imaginary[odd] = imaginary[even]! - oddImaginary
        real[even] += oddReal
        imaginary[even] += oddImaginary
        const nextReal = rotationReal * stepReal - rotationImaginary * stepImaginary
        rotationImaginary = rotationReal * stepImaginary + rotationImaginary * stepReal
        rotationReal = nextReal
      }
    }
  }
}

function normalizeDecibels(amplitude: number, floor: number, ceiling: number): number {
  if (!Number.isFinite(amplitude) || amplitude <= 0) return 0
  const decibels = 20 * Math.log10(amplitude)
  return Math.max(0, Math.min(1, (decibels - floor) / (ceiling - floor)))
}

function toByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value * 255)))
}

function joinBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const joined = new Uint8Array(left.byteLength + right.byteLength)
  joined.set(left)
  joined.set(right, left.byteLength)
  return joined
}

async function readBounded(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of stream) {
    size += chunk.byteLength
    if (size > maximumBytes) return null
    chunks.push(chunk)
  }
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function killProcess(child: ChildProcess, signal: number | string): void {
  try {
    child.kill(signal)
  } catch {}
}

async function stopChildProcess(child: ChildProcess): Promise<void> {
  killProcess(child, "SIGTERM")
  if (await exitsWithin(child, processForceKillMs)) return
  killProcess(child, "SIGKILL")
  await exitsWithin(child, processForceKillMs)
}

function exitsWithin(child: ChildProcess, milliseconds: number): Promise<boolean> {
  return Promise.race([
    child.exited.then(() => true, () => true),
    Bun.sleep(milliseconds).then(() => false),
  ])
}
