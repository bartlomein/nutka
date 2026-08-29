import {
  MAX_PLAYBACK_METADATA_LENGTH,
  MAX_PLAYBACK_QUEUE_ITEMS,
  MAX_PLAYBACK_RESOURCE_ID_LENGTH,
  PLAYBACK_SPECTRUM_BAND_COUNT,
  type PlaybackWorkerRequest,
  type PlaybackWorkerResponse,
  type PlaybackWorkerSource,
} from "./apple-playback-protocol"
import {
  type PlaybackProbeBrowser,
  type PlaybackProbeSnapshot,
} from "./apple-playback-probe"
import {
  PlaybackWorkerState,
  type PlaybackWorkerStateSnapshot,
} from "./apple-playback-worker-state"
import type { SpectrumSample } from "./pipewire-audio-analysis"

const START_TIMEOUT_MS = 30_000
const CONTROL_TIMEOUT_MS = 10_000
const BROWSER_CLOSE_TIMEOUT_MS = 1_500

export interface PlaybackSpectrumSource {
  start(): void
  stop(): Promise<void>
}

export interface PlaybackSpectrumSourceOptions {
  browserProcessId: number
  onFrame(frame: SpectrumSample): void
  onUnavailable(): void
}

export interface ApplePlaybackWorkerRuntimeOptions {
  launchBrowser(
    executablePath: string,
    playbackUrl: string,
    profilePath: string,
  ): Promise<PlaybackProbeBrowser>
  createSpectrumSource(options: PlaybackSpectrumSourceOptions): PlaybackSpectrumSource
  write(message: PlaybackWorkerResponse): void
  drain(): Promise<void>
  sleep(milliseconds: number): Promise<void>
  now(): number
  kill(processId: number, signal: "SIGKILL"): void
  startTimeoutMs?: number
  controlTimeoutMs?: number
  browserCloseTimeoutMs?: number
}

class FatalWorkerError extends Error {}
class StaleWorkerOperation extends Error {}

export class ApplePlaybackWorkerRuntime {
  private browserInstance: PlaybackProbeBrowser | undefined
  private readonly playbackState = new PlaybackWorkerState()
  private commandQueue: Promise<void> = Promise.resolve()
  private commandRunning = false
  private commandEpoch = 0
  private pollEpoch = 0
  private activePoll?: Promise<void>
  private spectrumSource: PlaybackSpectrumSource | undefined
  private spectrumGeneration = 0
  private spectrumSequence = 0
  private spectrumEnabled = true
  private spectrumTransition: Promise<void> = Promise.resolve()
  private shutdownStarted = false
  private shutdownTask?: Promise<void>
  private resourceShutdown?: Promise<void>
  private shutdownExitCode = 0
  private readonly resolveShutdown: () => void
  readonly whenShutdown: Promise<void>

  constructor(private readonly options: ApplePlaybackWorkerRuntimeOptions) {
    let resolveShutdown!: () => void
    this.whenShutdown = new Promise<void>((resolve) => (resolveShutdown = resolve))
    this.resolveShutdown = resolveShutdown
  }

  get state(): PlaybackWorkerStateSnapshot {
    return this.playbackState.snapshot
  }

  get browser(): PlaybackProbeBrowser | undefined {
    return this.browserInstance
  }

  get isShuttingDown(): boolean {
    return this.shutdownStarted
  }

  get exitCode(): number {
    return this.shutdownExitCode
  }

  enqueue(request: PlaybackWorkerRequest): Promise<void> {
    if (this.shutdownStarted) return Promise.resolve()
    const operation = this.commandQueue.then(async () => {
      if (this.shutdownStarted) return
      if (request.type === "shutdown") {
        this.send({ type: "result", requestId: request.requestId, ok: true })
        this.markShutdown(0)
        await this.finishShutdown()
        return
      }

      const fatal = await this.executeRequest(request)
      if (fatal && !this.shutdownStarted) {
        this.markShutdown(1)
        await this.finishShutdown()
      }
    })
    this.commandQueue = operation.catch(async () => {
      if (!this.shutdownStarted) {
        this.markShutdown(1)
        await this.finishShutdown()
      }
    })
    return operation
  }

  pollOnce(): Promise<void> {
    if (this.activePoll) return this.activePoll
    if (this.shutdownStarted || this.commandRunning || !this.browserInstance) {
      return Promise.resolve()
    }
    const browser = this.browserInstance
    const commandEpoch = this.commandEpoch
    const pollEpoch = ++this.pollEpoch
    const operation = (async () => {
      try {
        const snapshot = await browser.snapshot()
        if (!this.pollIsCurrent(browser, commandEpoch, pollEpoch)) return
        await this.emitSnapshot(
          snapshot,
          true,
          () => this.pollIsCurrent(browser, commandEpoch, pollEpoch),
        )
      } catch {
        if (!this.pollIsCurrent(browser, commandEpoch, pollEpoch)) return
        await this.shutdown(true)
      }
    })()
    this.activePoll = operation
    void operation.finally(() => {
      if (this.activePoll === operation) this.activePoll = undefined
    })
    return operation
  }

  shutdown(fatal = false): Promise<void> {
    if (this.shutdownStarted) return this.shutdownTask ?? this.whenShutdown
    const pendingCommands = this.commandQueue
    this.markShutdown(fatal ? 1 : 0)
    const shutdown = (async () => {
      await pendingCommands.catch(() => {})
      await this.finishShutdown()
    })()
    this.shutdownTask = shutdown
    return shutdown
  }

  private async executeRequest(request: Exclude<PlaybackWorkerRequest, { type: "shutdown" }>): Promise<boolean> {
    this.commandRunning = true
    const epoch = ++this.commandEpoch
    this.pollEpoch++
    try {
      await this.handleRequest(request, epoch)
      return false
    } catch (error) {
      if (error instanceof FatalWorkerError) return true
      if (error instanceof StaleWorkerOperation || this.shutdownStarted) return false
      this.send({
        type: "result",
        requestId: request.requestId,
        ok: false,
        errorCode: await this.commandErrorCode(error),
      })
      return false
    } finally {
      this.commandRunning = false
    }
  }

  private async handleRequest(
    request: Exclude<PlaybackWorkerRequest, { type: "shutdown" }>,
    epoch: number,
  ): Promise<void> {
    switch (request.type) {
      case "initialize":
        await this.initialize(request, epoch)
        return

      case "play":
      case "play-station":
        await this.replacePlayback(request, epoch)
        return

      case "set-audio-analysis-enabled":
        this.spectrumEnabled = request.enabled
        await this.reconcileSpectrumCapture()
        this.assertCommandCurrent(epoch)
        this.send({ type: "result", requestId: request.requestId, ok: true })
        return

      case "pause":
        await this.clickAndWait("pause", this.controlTimeoutMs, epoch)
        await this.waitForSnapshot((snapshot) => snapshot.isPlaying === false, this.controlTimeoutMs, epoch)
        this.playbackState.confirm("paused")
        await this.reconcileSpectrumCapture()
        await this.emitCommandSnapshot(epoch)
        this.send({ type: "result", requestId: request.requestId, ok: true })
        return

      case "resume":
        await this.clickAndWait("resume", this.controlTimeoutMs, epoch)
        await this.waitForSnapshot((snapshot) => snapshot.isPlaying === true, this.controlTimeoutMs, epoch)
        this.playbackState.confirm("playing")
        await this.emitCommandSnapshot(epoch)
        await this.reconcileSpectrumCapture()
        this.assertCommandCurrent(epoch)
        this.send({ type: "result", requestId: request.requestId, ok: true })
        return

      case "previous":
      case "next": {
        const skipped = await this.clickAndWait(request.type, this.controlTimeoutMs, epoch)
        this.playbackState.confirm(skipped.isPlaying === true
          ? "playing"
          : skipped.playbackState === 3
            ? "paused"
            : this.playbackState.snapshot.status)
        await this.reconcileSpectrumCapture()
        await this.emitCommandSnapshot(epoch)
        this.send({ type: "result", requestId: request.requestId, ok: true })
        return
      }

      case "set-shuffle-mode":
        await this.requireBrowser().setShuffleMode(request.mode)
        this.assertCommandCurrent(epoch)
        await this.waitForSnapshot(
          (snapshot) => snapshot.shuffleMode === request.mode,
          this.controlTimeoutMs,
          epoch,
        )
        await this.emitCommandSnapshot(epoch)
        this.send({ type: "result", requestId: request.requestId, ok: true })
        return

      case "set-repeat-mode":
        await this.requireBrowser().setRepeatMode(request.mode)
        this.assertCommandCurrent(epoch)
        await this.waitForSnapshot(
          (snapshot) => snapshot.repeatMode === request.mode,
          this.controlTimeoutMs,
          epoch,
        )
        await this.emitCommandSnapshot(epoch)
        this.send({ type: "result", requestId: request.requestId, ok: true })
        return

      case "seek":
        await this.requireBrowser().seek(request.positionSeconds)
        this.assertCommandCurrent(epoch)
        await this.waitForSnapshot(
          (snapshot) => Math.abs((snapshot.positionSeconds ?? 0) - request.positionSeconds) < 2,
          this.controlTimeoutMs,
          epoch,
        )
        await this.emitCommandSnapshot(epoch)
        this.send({ type: "result", requestId: request.requestId, ok: true })
        return

      case "stop":
        await this.clickAndWait("stop", this.controlTimeoutMs, epoch)
        await this.waitForSnapshot((snapshot) => snapshot.isPlaying === false, this.controlTimeoutMs, epoch)
        this.playbackState.clear()
        await this.reconcileSpectrumCapture()
        await this.emitCommandSnapshot(epoch)
        this.send({ type: "result", requestId: request.requestId, ok: true })
    }
  }

  private async initialize(
    request: Extract<PlaybackWorkerRequest, { type: "initialize" }>,
    epoch: number,
  ): Promise<void> {
    if (this.browserInstance) throw new Error("already_initialized")
    const launched = await this.options.launchBrowser(
      request.executablePath,
      request.playbackUrl,
      request.profilePath,
    )
    if (!this.commandIsCurrent(epoch)) {
      await this.closeBrowser(launched)
      throw new StaleWorkerOperation()
    }
    this.browserInstance = launched
    try {
      await launched.initialize(request.developerToken, request.musicUserToken)
      this.assertCommandCurrent(epoch)
      await this.emitCommandSnapshot(epoch)
      this.send({ type: "result", requestId: request.requestId, ok: true })
    } catch (error) {
      if (this.browserInstance === launched) this.browserInstance = undefined
      await this.closeBrowser(launched)
      throw error
    }
  }

  private async replacePlayback(
    request: Extract<PlaybackWorkerRequest, { type: "play" | "play-station" }>,
    epoch: number,
  ): Promise<void> {
    const browser = this.requireBrowser()
    const activeModes = await browser.snapshot()
    this.assertCommandCurrent(epoch)
    const source: PlaybackWorkerSource = request.type === "play"
      ? { type: "finite" }
      : {
          type: "station",
          stationId: request.stationResourceId,
          title: request.title,
          isLive: request.isLive,
        }
    const previousState = this.playbackState.beginLoad(
      request.loadId,
      source,
      request.type === "play" ? request.tracks.map((track) => track.resourceId) : [],
    )
    let queueMutated = false
    let shuffleChanged = false
    try {
      if (activeModes.shuffleMode === "songs") {
        shuffleChanged = true
        await browser.setShuffleMode("off")
        this.assertCommandCurrent(epoch)
        await this.waitForSnapshot(
          (snapshot) => snapshot.shuffleMode === "off",
          this.controlTimeoutMs,
          epoch,
        )
      }
      const queueBaseline = await browser.snapshot()
      this.assertCommandCurrent(epoch)
      queueMutated = true
      if (request.type === "play") {
        await browser.setQueue(request.tracks.map((track) => track.resourceId))
      } else {
        await browser.setStation(request.stationResourceId)
      }
      this.assertCommandCurrent(epoch)
      await this.clickAndWait("play", this.startTimeoutMs, epoch)
      await this.waitForSnapshot(
        (snapshot) =>
          snapshot.isPlaying === true &&
          (request.type === "play"
            ? snapshot.resourceId === request.tracks[0]!.resourceId
            : safeResourceId(snapshot.resourceId) !== null &&
              stationQueueChanged(queueBaseline, snapshot)),
        this.startTimeoutMs,
        epoch,
      )
      if (request.type === "play" && shuffleChanged) {
        await browser.setShuffleMode("songs")
        this.assertCommandCurrent(epoch)
        await this.waitForSnapshot(
          (snapshot) => snapshot.shuffleMode === "songs",
          this.controlTimeoutMs,
          epoch,
        )
      }
      this.playbackState.confirm("playing")
      await this.emitCommandSnapshot(epoch)
      await this.reconcileSpectrumCapture()
      this.assertCommandCurrent(epoch)
      this.send({ type: "result", requestId: request.requestId, ok: true })
    } catch (error) {
      if (error instanceof StaleWorkerOperation || this.shutdownStarted) throw error
      await this.rollbackReplacement(
        browser,
        previousState,
        activeModes,
        queueMutated,
        shuffleChanged,
        epoch,
      )
      throw error
    }
  }

  private async rollbackReplacement(
    browser: PlaybackProbeBrowser,
    previousState: PlaybackWorkerStateSnapshot,
    activeModes: PlaybackProbeSnapshot,
    queueMutated: boolean,
    shuffleChanged: boolean,
    epoch: number,
  ): Promise<void> {
    let cleanupFailed = false
    let current: PlaybackProbeSnapshot | undefined
    if (queueMutated) {
      try {
        await this.clickAndWait("stop", this.controlTimeoutMs, epoch)
        await this.waitForSnapshot(
          (snapshot) => snapshot.isPlaying === false,
          this.controlTimeoutMs,
          epoch,
        )
      } catch (error) {
        if (error instanceof StaleWorkerOperation) throw error
        cleanupFailed = true
      }
      this.playbackState.clear()
    } else {
      try {
        current = await browser.snapshot()
        this.assertCommandCurrent(epoch)
      } catch (error) {
        if (error instanceof StaleWorkerOperation) throw error
        cleanupFailed = true
      }
      if (current) {
        this.playbackState.restore(previousState, current.isPlaying === true
          ? "playing"
          : current.playbackState === 3
            ? "paused"
            : previousState.status)
      } else {
        this.playbackState.clear()
      }
    }

    if (shuffleChanged) {
      try {
        await browser.setShuffleMode(activeModes.shuffleMode === "songs" ? "songs" : "off")
        this.assertCommandCurrent(epoch)
        await this.waitForSnapshot(
          (snapshot) => snapshot.shuffleMode === activeModes.shuffleMode,
          this.controlTimeoutMs,
          epoch,
        )
      } catch (error) {
        if (error instanceof StaleWorkerOperation) throw error
        cleanupFailed = true
      }
    }

    await this.reconcileSpectrumCapture()
    this.assertCommandCurrent(epoch)
    if (cleanupFailed) throw new FatalWorkerError()
    await this.emitCommandSnapshot(epoch)
  }

  private async emitCommandSnapshot(epoch: number): Promise<void> {
    const snapshot = await this.requireBrowser().snapshot()
    this.assertCommandCurrent(epoch)
    await this.emitSnapshot(snapshot, false)
  }

  private async emitSnapshot(
    snapshot: PlaybackProbeSnapshot,
    reconcile: boolean,
    isCurrent: () => boolean = () => !this.shutdownStarted,
  ): Promise<void> {
    if (!isCurrent()) return
    if (reconcile) {
      const action = this.playbackState.reconcile(snapshot, false)
      if (action === "reconcile-spectrum") await this.reconcileSpectrumCapture()
      if (action === "stop-spectrum") await this.stopSpectrumCapture()
    }
    if (!isCurrent()) return
    const rawQueueResourceIds = snapshot.queueResourceIds ?? []
    const queueResourceIds = rawQueueResourceIds.length <= MAX_PLAYBACK_QUEUE_ITEMS &&
        rawQueueResourceIds.every((resourceId) => safeResourceId(resourceId) !== null)
      ? [...rawQueueResourceIds]
      : []
    const queuePosition = Number.isInteger(snapshot.queuePosition) &&
        snapshot.queuePosition! >= -1 && snapshot.queuePosition! < queueResourceIds.length
      ? snapshot.queuePosition!
      : -1
    this.playbackState.updateFiniteQueue(queueResourceIds)
    const state = this.playbackState.snapshot
    const isLive = state.source?.type === "station" && state.source.isLive
    this.send({
      type: "snapshot",
      loadId: state.loadId,
      resourceId: safeResourceId(snapshot.resourceId),
      queueResourceIds,
      currentItem: safeItem(snapshot.currentItem),
      queueItems: safeItems(snapshot.queueItems),
      queuePosition,
      source: state.source,
      dynamicQueue: state.source?.type === "station",
      status: state.status,
      positionSeconds: finiteNonNegative(snapshot.positionSeconds) ?? 0,
      durationSeconds: finiteNonNegative(snapshot.durationSeconds),
      errorCode: safeCode(snapshot.lastErrorCode),
      audioQuality: snapshot.audioQuality ?? null,
      shuffleMode: snapshot.shuffleMode === "songs" ? "songs" : "off",
      repeatMode: snapshot.repeatMode === "one"
        ? "one"
        : snapshot.repeatMode === "all"
          ? "all"
          : "none",
      canSetShuffleMode: !isLive && snapshot.canSetShuffleMode === true,
      canSetRepeatMode: !isLive && snapshot.canSetRepeatMode === true,
      canSeek: !isLive && snapshot.canSeek === true,
      canSkipNext: !isLive && snapshot.canSkipNext === true,
      canSkipPrevious: !isLive && snapshot.canSkipPrevious === true,
    })
  }

  private async waitForSnapshot(
    accept: (snapshot: PlaybackProbeSnapshot) => boolean,
    timeoutMs: number,
    epoch: number,
  ): Promise<PlaybackProbeSnapshot> {
    const browser = this.requireBrowser()
    const deadline = this.options.now() + timeoutMs
    let snapshot = await browser.snapshot()
    this.assertCommandCurrent(epoch)
    while (true) {
      if (snapshot.lastErrorCode) throw new Error(snapshot.lastErrorCode)
      if (accept(snapshot)) return snapshot
      if (this.options.now() >= deadline) throw new Error("playback_timeout")
      await this.options.sleep(250)
      this.assertCommandCurrent(epoch)
      snapshot = await browser.snapshot()
      this.assertCommandCurrent(epoch)
    }
  }

  private async clickAndWait(
    control: "play" | "pause" | "resume" | "previous" | "next" | "stop",
    timeoutMs: number,
    epoch: number,
  ): Promise<PlaybackProbeSnapshot> {
    const browser = this.requireBrowser()
    const before = (await browser.snapshot()).completedCommandSequence ?? 0
    this.assertCommandCurrent(epoch)
    await browser.click(control)
    this.assertCommandCurrent(epoch)
    return this.waitForSnapshot(
      (snapshot) => (snapshot.completedCommandSequence ?? 0) > before,
      timeoutMs,
      epoch,
    )
  }

  private async commandErrorCode(error: unknown): Promise<string> {
    try {
      const snapshot = await this.browserInstance?.snapshot()
      const code = safeCode(snapshot?.lastErrorCode)
      if (code) return code
    } catch {}
    return error instanceof Error && safeCode(error.message) ? error.message : "control_failed"
  }

  private reconcileSpectrumCapture(): Promise<void> {
    const state = this.playbackState.snapshot
    return this.spectrumEnabled && state.status === "playing" && state.loadId !== null
      ? this.restartSpectrumCapture(state.loadId)
      : this.stopSpectrumCapture()
  }

  private restartSpectrumCapture(loadId: number): Promise<void> {
    const generation = ++this.spectrumGeneration
    return this.queueSpectrumTransition(async () => {
      if (generation !== this.spectrumGeneration) return
      const previous = this.spectrumSource
      this.spectrumSource = undefined
      await previous?.stop().catch(() => {})
      if (
        this.shutdownStarted ||
        !this.spectrumEnabled ||
        generation !== this.spectrumGeneration ||
        this.playbackState.snapshot.loadId !== loadId ||
        this.playbackState.snapshot.status !== "playing"
      ) return
      const browserProcessId = this.browserInstance?.processId
      if (!browserProcessId) return

      let source: PlaybackSpectrumSource | undefined
      source = this.options.createSpectrumSource({
        browserProcessId,
        onFrame: (frame) => {
          if (source) this.sendSpectrumFrame(source, generation, loadId, frame)
        },
        onUnavailable: () => {
          if (source) {
            this.sendSpectrumFrame(source, generation, loadId, {
              bands: Array.from({ length: PLAYBACK_SPECTRUM_BAND_COUNT }, () => 0),
              rms: 0,
              peak: 0,
            })
          }
        },
      })
      this.spectrumSource = source
      source.start()
    })
  }

  private sendSpectrumFrame(
    source: PlaybackSpectrumSource,
    generation: number,
    loadId: number,
    frame: SpectrumSample,
  ): void {
    if (
      this.shutdownStarted ||
      !this.spectrumEnabled ||
      generation !== this.spectrumGeneration ||
      source !== this.spectrumSource ||
      this.playbackState.snapshot.loadId !== loadId ||
      this.playbackState.snapshot.status !== "playing"
    ) return
    this.send({
      type: "spectrum",
      loadId,
      sequence: this.spectrumSequence++,
      bands: frame.bands,
      rms: frame.rms,
      peak: frame.peak,
    })
  }

  private stopSpectrumCapture(): Promise<void> {
    this.spectrumGeneration++
    return this.queueSpectrumTransition(async () => {
      const source = this.spectrumSource
      this.spectrumSource = undefined
      await source?.stop().catch(() => {})
    })
  }

  private queueSpectrumTransition(operation: () => Promise<void>): Promise<void> {
    const transition = this.spectrumTransition.then(operation, operation)
    this.spectrumTransition = transition.catch(() => {})
    return transition
  }

  private markShutdown(exitCode: number): void {
    if (this.shutdownStarted) return
    this.shutdownStarted = true
    this.shutdownExitCode = exitCode
    this.commandEpoch++
    this.pollEpoch++
    this.spectrumGeneration++
  }

  private finishShutdown(): Promise<void> {
    this.resourceShutdown ??= (async () => {
      await this.stopSpectrumCapture()
      const browser = this.browserInstance
      this.browserInstance = undefined
      if (browser) await this.closeBrowser(browser)
      this.playbackState.clear()
      await this.options.drain().catch(() => {})
      this.resolveShutdown()
    })()
    return this.resourceShutdown
  }

  private async closeBrowser(browser: PlaybackProbeBrowser): Promise<void> {
    const closed = await Promise.race([
      Promise.resolve().then(() => browser.close()).then(() => true, () => false),
      this.options.sleep(this.browserCloseTimeoutMs).then(() => false),
    ])
    if (!closed && browser.processId) {
      try {
        this.options.kill(browser.processId, "SIGKILL")
      } catch {}
    }
  }

  private pollIsCurrent(
    browser: PlaybackProbeBrowser,
    commandEpoch: number,
    pollEpoch: number,
  ): boolean {
    return !this.shutdownStarted &&
      !this.commandRunning &&
      browser === this.browserInstance &&
      commandEpoch === this.commandEpoch &&
      pollEpoch === this.pollEpoch
  }

  private commandIsCurrent(epoch: number): boolean {
    return !this.shutdownStarted && this.commandRunning && epoch === this.commandEpoch
  }

  private assertCommandCurrent(epoch: number): void {
    if (!this.commandIsCurrent(epoch)) throw new StaleWorkerOperation()
  }

  private requireBrowser(): PlaybackProbeBrowser {
    if (!this.browserInstance) throw new Error("not_initialized")
    return this.browserInstance
  }

  private send(message: PlaybackWorkerResponse): void {
    if (this.shutdownStarted) return
    this.options.write(message)
  }

  private get startTimeoutMs(): number {
    return this.options.startTimeoutMs ?? START_TIMEOUT_MS
  }

  private get controlTimeoutMs(): number {
    return this.options.controlTimeoutMs ?? CONTROL_TIMEOUT_MS
  }

  private get browserCloseTimeoutMs(): number {
    return this.options.browserCloseTimeoutMs ?? BROWSER_CLOSE_TIMEOUT_MS
  }
}

function stationQueueChanged(
  before: PlaybackProbeSnapshot,
  current: PlaybackProbeSnapshot,
): boolean {
  if (before.isPlaying !== true && current.isPlaying === true) return true
  if (before.resourceId !== current.resourceId) return true
  const beforeQueue = before.queueResourceIds ?? []
  const currentQueue = current.queueResourceIds ?? []
  return beforeQueue.length !== currentQueue.length ||
    beforeQueue.some((resourceId, index) => resourceId !== currentQueue[index])
}

function safeResourceId(value: string | null | undefined): string | null {
  return typeof value === "string" &&
      value.length <= MAX_PLAYBACK_RESOURCE_ID_LENGTH &&
      /^[A-Za-z0-9._-]+$/.test(value)
    ? value
    : null
}

function safeCode(value: string | null | undefined): string | null {
  return typeof value === "string" && /^[a-z0-9_.:-]{1,64}$/i.test(value) ? value : null
}

function finiteNonNegative(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}

function safeItem(value: PlaybackProbeSnapshot["currentItem"]): NonNullable<
  Extract<PlaybackWorkerResponse, { type: "snapshot" }>["currentItem"]
> | null {
  if (!value) return null
  const resourceId = safeResourceId(value.resourceId)
  if (!resourceId) return null
  return {
    resourceId,
    title: safeMetadata(value.title),
    artist: safeMetadata(value.artist),
    album: safeMetadata(value.album),
    durationSeconds: finiteNonNegative(value.durationSeconds),
  }
}

function safeItems(
  values: PlaybackProbeSnapshot["queueItems"],
): Extract<PlaybackWorkerResponse, { type: "snapshot" }>["queueItems"] {
  if (!Array.isArray(values)) return []
  return values.slice(0, MAX_PLAYBACK_QUEUE_ITEMS).flatMap((value) => {
    const item = safeItem(value)
    return item ? [item] : []
  })
}

function safeMetadata(value: string | null | undefined): string | null {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, MAX_PLAYBACK_METADATA_LENGTH)
    : null
}
