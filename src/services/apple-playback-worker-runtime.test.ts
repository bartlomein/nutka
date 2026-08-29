import { describe, expect, test } from "bun:test"

import type {
  PlaybackRepeatMode,
  PlaybackShuffleMode,
} from "../core/types"
import type {
  PlaybackWorkerRequest,
  PlaybackWorkerResponse,
} from "./apple-playback-protocol"
import type {
  PlaybackProbeBrowser,
  PlaybackProbeControl,
  PlaybackProbeSnapshot,
} from "./apple-playback-probe"
import {
  ApplePlaybackWorkerRuntime,
  type ApplePlaybackWorkerRuntimeOptions,
  type PlaybackSpectrumSource,
  type PlaybackSpectrumSourceOptions,
} from "./apple-playback-worker-runtime"
import type { SpectrumSample } from "./pipewire-audio-analysis"

const spectrumFrame: SpectrumSample = {
  bands: Array.from({ length: 64 }, () => 120),
  rms: 100,
  peak: 160,
}

class FakeBrowser implements PlaybackProbeBrowser {
  readonly processId = 4242
  readonly operations: string[] = []
  current: PlaybackProbeSnapshot = idleBrowserSnapshot()
  initializeImpl?: () => Promise<void>
  snapshotImpl?: () => Promise<PlaybackProbeSnapshot>
  setQueueImpl?: (resourceIds: readonly string[]) => Promise<void>
  setStationImpl?: (resourceId: string) => Promise<void>
  setShuffleModeImpl?: (mode: PlaybackShuffleMode) => Promise<void>
  clickImpl?: (control: PlaybackProbeControl) => Promise<void>
  closeImpl?: () => Promise<void>
  closeCount = 0

  async initialize(): Promise<void> {
    this.operations.push("initialize")
    await this.initializeImpl?.()
    this.current.initialized = true
  }

  async setQueue(resourceIds: readonly string[]): Promise<void> {
    this.operations.push(`queue:${resourceIds.join(",")}`)
    if (this.setQueueImpl) return this.setQueueImpl(resourceIds)
    this.current.queueResourceIds = [...resourceIds]
    this.current.queuePosition = 0
    this.current.resourceId = resourceIds[0] ?? null
  }

  async setStation(resourceId: string): Promise<void> {
    this.operations.push(`station:${resourceId}`)
    if (this.setStationImpl) return this.setStationImpl(resourceId)
    this.current.queueResourceIds = [`${resourceId}-song`]
    this.current.queuePosition = 0
    this.current.resourceId = `${resourceId}-song`
  }

  async setShuffleMode(mode: PlaybackShuffleMode): Promise<void> {
    this.operations.push(`shuffle:${mode}`)
    if (this.setShuffleModeImpl) return this.setShuffleModeImpl(mode)
    this.current.shuffleMode = mode
  }

  async setRepeatMode(mode: PlaybackRepeatMode): Promise<void> {
    this.operations.push(`repeat:${mode}`)
    this.current.repeatMode = mode
  }

  async click(control: PlaybackProbeControl): Promise<void> {
    this.operations.push(`click:${control}`)
    if (this.clickImpl) return this.clickImpl(control)
    this.applyClick(control)
  }

  async seek(positionSeconds: number): Promise<void> {
    this.operations.push(`seek:${positionSeconds}`)
    this.current.positionSeconds = positionSeconds
  }

  async snapshot(): Promise<PlaybackProbeSnapshot> {
    this.operations.push("snapshot")
    return this.snapshotImpl ? this.snapshotImpl() : { ...this.current }
  }

  async close(): Promise<void> {
    this.closeCount++
    this.operations.push("close")
    await this.closeImpl?.()
  }

  applyClick(control: PlaybackProbeControl): void {
    this.current.completedCommandSequence = (this.current.completedCommandSequence ?? 0) + 1
    if (control === "play" || control === "resume") {
      this.current.isPlaying = true
      this.current.playbackState = 2
    } else if (control === "pause") {
      this.current.isPlaying = false
      this.current.playbackState = 3
    } else if (control === "stop") {
      this.current.isPlaying = false
      this.current.playbackState = 0
    }
  }
}

class FakeSpectrum implements PlaybackSpectrumSource {
  started = false
  stopCount = 0

  constructor(readonly options: PlaybackSpectrumSourceOptions) {}

  start(): void {
    this.started = true
  }

  async stop(): Promise<void> {
    this.stopCount++
  }

  frame(frame: SpectrumSample = spectrumFrame): void {
    this.options.onFrame(frame)
  }
}

describe("ApplePlaybackWorkerRuntime", () => {
  test("serializes commands in FIFO order and drops commands after shutdown starts", async () => {
    const browser = new FakeBrowser()
    const setup = runtimeSetup([browser])
    await initialize(setup.runtime)
    await play(setup.runtime, 1, "song-1")
    browser.operations.length = 0
    setup.output.length = 0

    const firstGate = deferred<void>()
    let pauseCount = 0
    browser.clickImpl = async (control) => {
      if (control === "pause" && pauseCount++ === 0) await firstGate.promise
      browser.applyClick(control)
    }
    const pausing = setup.runtime.enqueue(request({ type: "pause" }, 3))
    const resuming = setup.runtime.enqueue(request({ type: "resume" }, 4))
    await until(() => browser.operations.includes("click:pause"))
    expect(browser.operations).not.toContain("click:resume")
    firstGate.resolve()
    await Promise.all([pausing, resuming])
    expect(browser.operations.filter((operation) => operation.startsWith("click:"))).toEqual([
      "click:pause",
      "click:resume",
    ])

    const shutdownGate = deferred<void>()
    browser.clickImpl = async (control) => {
      if (control === "pause") await shutdownGate.promise
      browser.applyClick(control)
    }
    const active = setup.runtime.enqueue(request({ type: "pause" }, 5))
    await until(() => browser.operations.filter((value) => value === "click:pause").length === 2)
    const outputAtShutdown = setup.output.length
    const shuttingDown = setup.runtime.shutdown()
    const dropped = setup.runtime.enqueue(request({ type: "resume" }, 6))
    shutdownGate.resolve()
    await Promise.all([active, dropped, shuttingDown])

    expect(browser.operations.filter((operation) => operation === "click:resume")).toHaveLength(1)
    expect(setup.output).toHaveLength(outputAtShutdown)
    expect(setup.runtime.state.loadId).toBeNull()
  })

  test("restores pre-mutation playback but stops and clears after queue mutation", async () => {
    const browser = new FakeBrowser()
    const setup = runtimeSetup([browser])
    await initialize(setup.runtime)
    await play(setup.runtime, 1, "old-song")

    let snapshotAttempt = 0
    browser.snapshotImpl = async () => {
      snapshotAttempt++
      if (snapshotAttempt === 2) throw new Error("baseline_failed")
      if (snapshotAttempt === 3) browser.snapshotImpl = undefined
      return { ...browser.current }
    }
    await setup.runtime.enqueue(request({
      type: "play-station",
      loadId: 2,
      stationResourceId: "station-2",
      title: "Station 2",
      isLive: false,
    }, 3))
    expect(setup.runtime.state.loadId).toBe(1)
    expect(browser.operations).not.toContain("station:station-2")
    expect(result(setup.output, 3)).toMatchObject({ ok: false, errorCode: "baseline_failed" })

    browser.current.shuffleMode = "songs"
    let failShuffle = true
    browser.setShuffleModeImpl = async (mode) => {
      browser.current.shuffleMode = mode
      if (mode === "off" && failShuffle) {
        failShuffle = false
        throw new Error("shuffle_failed")
      }
    }
    await setup.runtime.enqueue(request({
      type: "play-station",
      loadId: 3,
      stationResourceId: "station-3",
      title: "Station 3",
      isLive: false,
    }, 4))

    expect(setup.runtime.state).toEqual({
      loadId: 1,
      resourceIds: ["old-song"],
      source: { type: "finite" },
      status: "playing",
    })
    expect(browser.current.shuffleMode).toBe("songs")
    expect(browser.operations).not.toContain("station:station-3")
    expect(result(setup.output, 4)).toMatchObject({ ok: false, errorCode: "shuffle_failed" })

    browser.setShuffleModeImpl = async (mode) => {
      browser.current.shuffleMode = mode
    }
    browser.setQueueImpl = async (resourceIds) => {
      browser.current.queueResourceIds = [...resourceIds]
      browser.current.resourceId = resourceIds[0] ?? null
      throw new Error("queue_failed")
    }
    await setup.runtime.enqueue(request({
      type: "play",
      loadId: 4,
      tracks: [{ trackId: "new", resourceId: "new-song" }],
    }, 5))

    expect(browser.operations).toContain("queue:new-song")
    expect(browser.operations).toContain("click:stop")
    expect(browser.current.shuffleMode).toBe("songs")
    expect(setup.runtime.state).toEqual({
      loadId: null,
      resourceIds: [],
      source: null,
      status: "idle",
    })
    const rollbackSnapshot = setup.output.filter(isSnapshot).at(-1)!
    expect(rollbackSnapshot).toMatchObject({ loadId: null, source: null, status: "idle" })
    expect(result(setup.output, 5)).toMatchObject({ ok: false, errorCode: "queue_failed" })
  })

  test("makes polls single-flight, suppresses stale completion, and reconciles pause and stop", async () => {
    const browser = new FakeBrowser()
    const setup = runtimeSetup([browser])
    await initialize(setup.runtime)
    await play(setup.runtime, 1, "song-1")
    setup.output.length = 0

    const stalePoll = deferred<PlaybackProbeSnapshot>()
    let snapshotCount = 0
    browser.snapshotImpl = () => {
      snapshotCount++
      browser.snapshotImpl = undefined
      return stalePoll.promise
    }
    const firstPoll = setup.runtime.pollOnce()
    const samePoll = setup.runtime.pollOnce()
    expect(firstPoll).toBe(samePoll)
    await setup.runtime.enqueue(request({ type: "set-repeat-mode", mode: "all" }, 3))
    stalePoll.resolve({ ...browser.current, isPlaying: false, playbackState: 0 })
    await firstPoll

    expect(snapshotCount).toBe(1)
    expect(setup.runtime.state.status).toBe("playing")
    expect(setup.output.filter(isSnapshot).some((snapshot) => snapshot.status === "idle")).toBe(false)

    browser.current.isPlaying = false
    browser.current.playbackState = 3
    await setup.runtime.pollOnce()
    expect(setup.runtime.state.status).toBe("paused")
    expect(setup.output.filter(isSnapshot).at(-1)?.status).toBe("paused")

    browser.current.playbackState = 0
    await setup.runtime.pollOnce()
    expect(setup.runtime.state.loadId).toBeNull()
    expect(setup.output.filter(isSnapshot).at(-1)?.status).toBe("idle")

    const oldPoll = deferred<PlaybackProbeSnapshot>()
    browser.snapshotImpl = () => oldPoll.promise
    const pollingDuringShutdown = setup.runtime.pollOnce()
    const shuttingDown = setup.runtime.shutdown()
    oldPoll.resolve({ ...browser.current, lastErrorCode: "old_poll_failed" })
    await Promise.all([pollingDuringShutdown, shuttingDown])
    expect(setup.runtime.exitCode).toBe(0)
  })

  test("shuts down once during active work and kills browsers after close rejection or timeout", async () => {
    const rejectedBrowser = new FakeBrowser()
    const rejected = runtimeSetup([rejectedBrowser])
    await initialize(rejected.runtime)
    await play(rejected.runtime, 1, "song-1")
    const source = rejected.spectra[0]!
    const gate = deferred<void>()
    rejectedBrowser.clickImpl = async (control) => {
      await gate.promise
      rejectedBrowser.applyClick(control)
    }
    rejectedBrowser.closeImpl = () => Promise.reject(new Error("close failed"))
    const active = rejected.runtime.enqueue(request({ type: "pause" }, 3))
    await until(() => rejectedBrowser.operations.includes("click:pause"))
    const outputAtShutdown = rejected.output.length
    const firstShutdown = rejected.runtime.shutdown()
    const secondShutdown = rejected.runtime.shutdown()
    expect(secondShutdown).toBe(firstShutdown)
    gate.resolve()
    await Promise.all([active, firstShutdown])

    expect(source.stopCount).toBe(1)
    expect(rejectedBrowser.closeCount).toBe(1)
    expect(rejected.kills).toEqual([{ processId: 4242, signal: "SIGKILL" }])
    expect(rejected.output).toHaveLength(outputAtShutdown)

    const timedOutBrowser = new FakeBrowser()
    timedOutBrowser.closeImpl = () => new Promise<void>(() => {})
    const timedOut = runtimeSetup([timedOutBrowser], { sleep: async () => {} })
    await initialize(timedOut.runtime)
    await timedOut.runtime.shutdown()
    expect(timedOut.kills).toEqual([{ processId: 4242, signal: "SIGKILL" }])
  })

  test("replaces spectrum sources and suppresses disabled and stale frames", async () => {
    const browser = new FakeBrowser()
    const setup = runtimeSetup([browser])
    await initialize(setup.runtime)
    await play(setup.runtime, 1, "song-1")
    const first = setup.spectra[0]!
    first.frame()
    expect(setup.output.filter(isSpectrum)).toHaveLength(1)

    await setup.runtime.enqueue(request({
      type: "set-audio-analysis-enabled",
      enabled: false,
    }, 3))
    expect(first.stopCount).toBe(1)
    first.frame()
    expect(setup.output.filter(isSpectrum)).toHaveLength(1)

    await setup.runtime.enqueue(request({
      type: "set-audio-analysis-enabled",
      enabled: true,
    }, 4))
    const second = setup.spectra[1]!
    second.frame()
    expect(setup.output.filter(isSpectrum).map((frame) => frame.sequence)).toEqual([0, 1])

    await play(setup.runtime, 2, "song-2", 5)
    const replacement = setup.spectra[2]!
    expect(second.stopCount).toBe(1)
    second.frame()
    replacement.frame()
    expect(setup.output.filter(isSpectrum).map((frame) => [frame.loadId, frame.sequence])).toEqual([
      [1, 0],
      [1, 1],
      [2, 2],
    ])
    await setup.runtime.shutdown()
  })

  test("cleans up a browser after initialization failure and permits retry", async () => {
    const failed = new FakeBrowser()
    failed.initializeImpl = () => Promise.reject(new Error("authorization_rejected"))
    const retry = new FakeBrowser()
    const setup = runtimeSetup([failed, retry])

    await initialize(setup.runtime)
    expect(failed.closeCount).toBe(1)
    expect(setup.runtime.browser).toBeUndefined()
    expect(result(setup.output, 1)).toMatchObject({
      ok: false,
      errorCode: "authorization_rejected",
    })

    await initialize(setup.runtime, 2)
    expect(setup.runtime.browser).toBe(retry)
    expect(result(setup.output, 2)).toMatchObject({ ok: true })
    await setup.runtime.shutdown()
  })
})

function runtimeSetup(
  browsers: FakeBrowser[],
  overrides: Partial<ApplePlaybackWorkerRuntimeOptions> = {},
): {
  runtime: ApplePlaybackWorkerRuntime
  output: PlaybackWorkerResponse[]
  spectra: FakeSpectrum[]
  kills: Array<{ processId: number; signal: "SIGKILL" }>
} {
  const output: PlaybackWorkerResponse[] = []
  const spectra: FakeSpectrum[] = []
  const kills: Array<{ processId: number; signal: "SIGKILL" }> = []
  let now = 0
  const defaults: ApplePlaybackWorkerRuntimeOptions = {
    launchBrowser: async () => {
      const browser = browsers.shift()
      if (!browser) throw new Error("no_browser")
      return browser
    },
    createSpectrumSource: (options) => {
      const source = new FakeSpectrum(options)
      spectra.push(source)
      return source
    },
    write: (message) => output.push(message),
    drain: async () => {},
    sleep: async (milliseconds) => {
      now += milliseconds
    },
    now: () => now,
    kill: (processId, signal) => kills.push({ processId, signal }),
    startTimeoutMs: 1_000,
    controlTimeoutMs: 1_000,
    browserCloseTimeoutMs: 10,
  }
  const runtime = new ApplePlaybackWorkerRuntime({ ...defaults, ...overrides })
  return { runtime, output, spectra, kills }
}

function initialize(runtime: ApplePlaybackWorkerRuntime, requestId = 1): Promise<void> {
  return runtime.enqueue({
    type: "initialize",
    requestId,
    executablePath: "/chromium",
    playbackUrl: "http://127.0.0.1/playback",
    profilePath: "/profile",
    developerToken: "developer-token",
    musicUserToken: "music-user-token",
  })
}

function play(
  runtime: ApplePlaybackWorkerRuntime,
  loadId: number,
  resourceId: string,
  requestId = 2,
): Promise<void> {
  return runtime.enqueue({
    type: "play",
    requestId,
    loadId,
    tracks: [{ trackId: `track-${resourceId}`, resourceId }],
  })
}

function request<T extends Omit<PlaybackWorkerRequest, "requestId">>(
  value: T,
  requestId: number,
): T & { requestId: number } {
  return { ...value, requestId }
}

function idleBrowserSnapshot(): PlaybackProbeSnapshot {
  return {
    initialized: false,
    isPlaying: false,
    playbackState: 0,
    positionSeconds: 0,
    durationSeconds: null,
    resourceId: null,
    queueResourceIds: [],
    queuePosition: -1,
    shuffleMode: "off",
    repeatMode: "none",
    completedCommandSequence: 0,
    canSetShuffleMode: true,
    canSetRepeatMode: true,
    canSeek: true,
    canSkipNext: true,
    canSkipPrevious: true,
  }
}

function result(output: PlaybackWorkerResponse[], requestId: number): Extract<
  PlaybackWorkerResponse,
  { type: "result" }
> | undefined {
  return output.find((message) => message.type === "result" && message.requestId === requestId) as
    | Extract<PlaybackWorkerResponse, { type: "result" }>
    | undefined
}

function isSnapshot(
  message: PlaybackWorkerResponse,
): message is Extract<PlaybackWorkerResponse, { type: "snapshot" }> {
  return message.type === "snapshot"
}

function isSpectrum(
  message: PlaybackWorkerResponse,
): message is Extract<PlaybackWorkerResponse, { type: "spectrum" }> {
  return message.type === "spectrum"
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value?: T): void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve: resolve as (value?: T) => void }
}

async function until(accept: () => boolean): Promise<void> {
  while (!accept()) await Bun.sleep(0)
}
