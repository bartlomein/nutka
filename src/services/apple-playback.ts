import { rm } from "node:fs/promises"
import { join } from "node:path"

import type {
  AudioAnalysisSource,
  AudioSpectrumFrame,
  AppleCatalogTrack,
  PlaybackController,
  PlaybackRepeatMode,
  PlaybackShuffleMode,
  PlaybackSnapshot,
} from "../core/types"
import {
  MAX_PLAYBACK_MESSAGE_BYTES,
  decodePlaybackWorkerResponse,
  encodePlaybackMessage,
  type PlaybackWorkerResponse,
  type PlaybackWorkerTrack,
} from "./apple-playback-protocol"
import { loopbackPlaybackUrl } from "./apple-playback-origin"
import {
  applePlaybackProfilePath,
  defaultChromiumExecutablePath,
  playbackBrowserEnvironment,
} from "./apple-playback-probe"
import { requestDeveloperToken, type Fetch } from "./token-service"

const INITIALIZE_TIMEOUT_MS = 45_000
const PLAY_TIMEOUT_MS = 35_000
const CONTROL_TIMEOUT_MS = 15_000
const SHUTDOWN_TIMEOUT_MS = 2_000

export class ApplePlaybackError extends Error {
  constructor(readonly code: string) {
    super("Apple Music playback is unavailable")
    this.name = "ApplePlaybackError"
  }
}

interface PlaybackWorkerInitialization {
  executablePath: string
  playbackUrl: string
  profilePath: string
  developerToken: string
  musicUserToken: string
}

export interface PlaybackWorkerClient {
  initialize(options: PlaybackWorkerInitialization): Promise<void>
  setAudioAnalysisEnabled(enabled: boolean): Promise<void>
  play(loadId: number, tracks: readonly PlaybackWorkerTrack[]): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  previous(): Promise<void>
  next(): Promise<void>
  setShuffleMode(mode: PlaybackShuffleMode): Promise<void>
  setRepeatMode(mode: PlaybackRepeatMode): Promise<void>
  seek(positionSeconds: number): Promise<void>
  stop(): Promise<void>
  dispose(): Promise<void>
}

export interface ApplePlaybackControllerOptions {
  serviceUrl: string
  useMusicUserToken<T>(use: (musicUserToken: string) => T | Promise<T>): Promise<T>
  executablePath?: string
  profilePath?: string
  fetch?: Fetch
  removeProfile?: (profilePath: string) => Promise<void>
  createWorkerClient?: (
    onSnapshot: (snapshot: Extract<PlaybackWorkerResponse, { type: "snapshot" }>) => void,
    onExit: (errorCode: string) => void,
    onSpectrum: (frame: Extract<PlaybackWorkerResponse, { type: "spectrum" }>) => void,
  ) => PlaybackWorkerClient
}

const idleSnapshot: PlaybackSnapshot<AppleCatalogTrack> = {
  status: "idle",
  currentTrack: null,
  queue: [],
  positionSeconds: 0,
  durationSeconds: null,
  errorCode: null,
  shuffleMode: "off",
  repeatMode: "none",
  canSetShuffleMode: false,
  canSetRepeatMode: false,
}

export class ApplePlaybackController implements PlaybackController<AppleCatalogTrack> {
  private currentSnapshot = idleSnapshot
  private currentAnalysis: AudioSpectrumFrame | null = null
  private readonly listeners = new Set<(
    snapshot: PlaybackSnapshot<AppleCatalogTrack>,
  ) => void>()
  private readonly analysisListeners = new Set<(
    frame: AudioSpectrumFrame | null,
  ) => void>()
  private readonly queues = new Map<number, readonly AppleCatalogTrack[]>()
  private worker?: PlaybackWorkerClient
  private workerPromise?: Promise<PlaybackWorkerClient>
  private disconnectPromise?: Promise<void>
  private authorizationClearPromise?: Promise<void>
  private workerGeneration = 0
  private nextLoadId = 1
  private activeLoadId: number | null = null
  private activeQueuePosition = -1
  private commandRunning = false
  private authorizationEnabled = true
  private analysisEnabled = true
  private analysisAcceptingFrames = true
  private analysisControlVersion = 0
  private disposed = false

  constructor(private readonly options: ApplePlaybackControllerOptions) {}

  readonly audioAnalysis: AudioAnalysisSource = {
    subscribe: (listener) => this.subscribeAudioAnalysis(listener),
    setEnabled: (enabled) => this.setAudioAnalysisEnabled(enabled),
  }

  get snapshot(): PlaybackSnapshot<AppleCatalogTrack> {
    return this.currentSnapshot
  }

  subscribe(
    listener: (snapshot: PlaybackSnapshot<AppleCatalogTrack>) => void,
  ): () => void {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    try {
      listener(this.currentSnapshot)
    } catch {}
    return () => this.listeners.delete(listener)
  }

  async play(
    track: AppleCatalogTrack,
    upcomingTracks: readonly AppleCatalogTrack[],
  ): Promise<void> {
    this.assertUsable()
    return this.runCommand(async () => {
      const generation = this.workerGeneration
      const tracks = playableQueue(track, upcomingTracks)
      const loadId = this.nextLoadId++
      this.activeLoadId = null
      this.activeQueuePosition = -1
      this.analysisAcceptingFrames = false
      this.setAnalysis(null)
      this.queues.set(loadId, tracks)
      try {
        await (await this.getWorker()).play(
          loadId,
          tracks.map((item) => ({
            trackId: item.id,
            resourceId: item.apple.playParams!.id,
          })),
        )
        this.analysisAcceptingFrames = this.analysisEnabled
        for (const knownLoadId of this.queues.keys()) {
          if (knownLoadId < loadId) this.queues.delete(knownLoadId)
        }
      } catch (error) {
        this.queues.delete(loadId)
        if (generation === this.workerGeneration) {
          this.analysisAcceptingFrames = this.analysisEnabled
          this.setError(playbackErrorCode(error))
        }
        throw error
      }
    })
  }

  async pause(): Promise<void> {
    this.assertUsable()
    if (this.currentSnapshot.status !== "playing") return
    await this.runCommand(() => this.runControl((worker) => worker.pause()))
  }

  async resume(): Promise<void> {
    this.assertUsable()
    if (this.currentSnapshot.status !== "paused") return
    await this.runCommand(() => this.runControl((worker) => worker.resume()))
  }

  async previous(): Promise<void> {
    this.assertUsable()
    if (!this.hasPreviousTrack()) return
    await this.runCommand(() => this.runControl((worker) => worker.previous()))
  }

  async next(): Promise<void> {
    this.assertUsable()
    if (
      this.activeLoadId === null ||
      (
        this.currentSnapshot.queue.length === 0 &&
        this.currentSnapshot.repeatMode === "none"
      )
    ) return
    await this.runCommand(() => this.runControl((worker) => worker.next()))
  }

  async setShuffleMode(mode: PlaybackShuffleMode): Promise<void> {
    this.assertUsable()
    if (!this.currentSnapshot.canSetShuffleMode || this.currentSnapshot.shuffleMode === mode) {
      return
    }
    await this.runCommand(() => this.runControl((worker) => worker.setShuffleMode(mode)))
  }

  async setRepeatMode(mode: PlaybackRepeatMode): Promise<void> {
    this.assertUsable()
    if (!this.currentSnapshot.canSetRepeatMode || this.currentSnapshot.repeatMode === mode) return
    await this.runCommand(() => this.runControl((worker) => worker.setRepeatMode(mode)))
  }

  async seek(positionSeconds: number): Promise<void> {
    this.assertUsable()
    if (!Number.isFinite(positionSeconds) || positionSeconds < 0) {
      throw new ApplePlaybackError("invalid_seek")
    }
    await this.runCommand(() => this.runControl((worker) => worker.seek(positionSeconds)))
  }

  async stop(): Promise<void> {
    this.assertUsable()
    if (!this.worker && !this.workerPromise) return
    await this.runCommand(() => this.runControl((worker) => worker.stop()))
  }

  disconnect(): Promise<void> {
    if (this.disconnectPromise) return this.disconnectPromise
    const disconnecting = this.runDisconnect()
    this.disconnectPromise = disconnecting
    return disconnecting.finally(() => {
      if (this.disconnectPromise === disconnecting) this.disconnectPromise = undefined
    })
  }

  private async runDisconnect(): Promise<void> {
    this.workerGeneration++
    const worker = this.worker
    const starting = this.workerPromise
    this.worker = undefined
    this.workerPromise = undefined
    this.queues.clear()
    this.activeLoadId = null
    this.activeQueuePosition = -1
    this.setAnalysis(null)
    this.setSnapshot(idleSnapshot)
    await worker?.dispose().catch(() => {})
    if (starting) {
      await starting.then((pendingWorker) => pendingWorker.dispose()).catch(() => {})
    }
  }

  clearAuthorization(): Promise<void> {
    if (this.authorizationClearPromise) return this.authorizationClearPromise
    const clearing = this.runAuthorizationClear()
    this.authorizationClearPromise = clearing
    return clearing.finally(() => {
      if (this.authorizationClearPromise === clearing) {
        this.authorizationClearPromise = undefined
      }
    })
  }

  private async runAuthorizationClear(): Promise<void> {
    this.authorizationEnabled = false
    await this.disconnect()
    try {
      const profilePath = this.options.profilePath ?? applePlaybackProfilePath()
      if (this.options.removeProfile) await this.options.removeProfile(profilePath)
      else await rm(profilePath, { recursive: true, force: true })
    } catch (error) {
      this.authorizationEnabled = true
      throw error
    }
  }

  enableAuthorization(): void {
    if (!this.disposed) this.authorizationEnabled = true
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    await this.authorizationClearPromise
    await this.disconnect()
    this.disposed = true
    this.listeners.clear()
    this.analysisListeners.clear()
  }

  private async getWorker(): Promise<PlaybackWorkerClient> {
    await this.disconnectPromise
    await this.authorizationClearPromise
    this.assertUsable()
    if (this.worker) return this.worker
    if (this.workerPromise) return this.workerPromise

    const generation = this.workerGeneration
    const starting = this.startWorker(generation)
    this.workerPromise = starting
    try {
      const worker = await starting
      if (this.disposed || generation !== this.workerGeneration) {
        await worker.dispose().catch(() => {})
        throw new ApplePlaybackError(this.disposed ? "disposed" : "worker_disconnected")
      }
      this.worker = worker
      return worker
    } finally {
      if (this.workerPromise === starting) this.workerPromise = undefined
    }
  }

  private async startWorker(generation: number): Promise<PlaybackWorkerClient> {
    const createWorker = this.options.createWorkerClient ?? createProcessPlaybackWorkerClient
    let worker: PlaybackWorkerClient | undefined
    try {
      const playbackUrl = loopbackPlaybackUrl(this.options.serviceUrl)
      if (!playbackUrl) throw new ApplePlaybackError("untrusted_playback_origin")
      const issued = await requestDeveloperToken(this.options.serviceUrl, this.options.fetch)
      if (issued.mode !== "apple") throw new ApplePlaybackError("token_service_unavailable")
      worker = createWorker(
        (snapshot) => {
          if (generation === this.workerGeneration) this.handleWorkerSnapshot(snapshot)
        },
        (errorCode) => {
          if (generation === this.workerGeneration) this.handleWorkerExit(worker, errorCode)
        },
        (frame) => {
          if (generation === this.workerGeneration) this.handleWorkerSpectrum(frame)
        },
      )
      await this.options.useMusicUserToken((musicUserToken) =>
        worker!.initialize({
          executablePath:
            this.options.executablePath ?? defaultChromiumExecutablePath(),
          playbackUrl,
          profilePath: this.options.profilePath ?? applePlaybackProfilePath(),
          developerToken: issued.token,
          musicUserToken,
        })
      )
      if (!this.analysisEnabled) await worker.setAudioAnalysisEnabled(false)
      return worker
    } catch (error) {
      await worker?.dispose().catch(() => {})
      if (generation === this.workerGeneration) this.setError(playbackErrorCode(error))
      throw error
    }
  }

  private handleWorkerSnapshot(
    snapshot: Extract<PlaybackWorkerResponse, { type: "snapshot" }>,
  ): void {
    if (this.disposed) return
    if (snapshot.status === "idle" || snapshot.loadId === null) {
      this.activeLoadId = null
      this.activeQueuePosition = -1
      this.setAnalysis(null)
      this.setSnapshot({
        ...idleSnapshot,
        positionSeconds: snapshot.positionSeconds,
        durationSeconds: snapshot.durationSeconds,
        errorCode: snapshot.errorCode,
        shuffleMode: snapshot.shuffleMode,
        repeatMode: snapshot.repeatMode,
        canSetShuffleMode: snapshot.canSetShuffleMode,
        canSetRepeatMode: snapshot.canSetRepeatMode,
      })
      return
    }

    const tracks = this.queues.get(snapshot.loadId)
    const tracksByResourceId = new Map(
      tracks?.map((track) => [track.apple.playParams!.id, track]) ?? [],
    )
    const orderedTracks = snapshot.queueResourceIds.flatMap((resourceId) => {
      const track = tracksByResourceId.get(resourceId)
      return track ? [track] : []
    })
    const currentIndex = snapshot.queuePosition >= 0 &&
        orderedTracks[snapshot.queuePosition]?.apple.playParams?.id === snapshot.resourceId
      ? snapshot.queuePosition
      : orderedTracks.findIndex(
          (track) => track.apple.playParams?.id === snapshot.resourceId,
        )
    const catalogTrack = orderedTracks[currentIndex]
    if (!catalogTrack) return
    this.activeLoadId = snapshot.loadId
    this.activeQueuePosition = currentIndex
    const currentTrack = snapshot.audioQuality
      ? { ...catalogTrack, audioQuality: snapshot.audioQuality }
      : catalogTrack
    this.setSnapshot({
      status: snapshot.status,
      currentTrack,
      queue: orderedTracks.slice(currentIndex + 1),
      positionSeconds: snapshot.positionSeconds,
      durationSeconds: snapshot.durationSeconds,
      errorCode: snapshot.errorCode,
      shuffleMode: snapshot.shuffleMode,
      repeatMode: snapshot.repeatMode,
      canSetShuffleMode: snapshot.canSetShuffleMode,
      canSetRepeatMode: snapshot.canSetRepeatMode,
    })
  }

  private handleWorkerSpectrum(
    frame: Extract<PlaybackWorkerResponse, { type: "spectrum" }>,
  ): void {
    if (
      this.disposed ||
      !this.analysisEnabled ||
      !this.analysisAcceptingFrames ||
      frame.loadId !== this.activeLoadId
    ) return
    this.setAnalysis({
      sequence: frame.sequence,
      bands: frame.bands,
      rms: frame.rms,
      peak: frame.peak,
    })
  }

  private handleWorkerExit(
    worker: PlaybackWorkerClient | undefined,
    errorCode: string,
  ): void {
    if (this.worker === worker) this.worker = undefined
    if (this.disposed) return
    this.queues.clear()
    this.activeLoadId = null
    this.activeQueuePosition = -1
    this.setAnalysis(null)
    this.setSnapshot({ ...idleSnapshot, errorCode })
  }

  private hasPreviousTrack(): boolean {
    return this.activeLoadId !== null && (
      this.activeQueuePosition > 0 || this.currentSnapshot.repeatMode !== "none"
    )
  }

  private async runControl(
    control: (worker: PlaybackWorkerClient) => Promise<void>,
  ): Promise<void> {
    const generation = this.workerGeneration
    try {
      await control(await this.getWorker())
    } catch (error) {
      if (generation === this.workerGeneration) this.setError(playbackErrorCode(error))
      throw error
    }
  }

  private async runCommand(command: () => Promise<void>): Promise<void> {
    if (this.commandRunning) throw new ApplePlaybackError("command_in_progress")
    this.commandRunning = true
    try {
      await command()
    } finally {
      this.commandRunning = false
    }
  }

  private setError(errorCode: string): void {
    this.setSnapshot({ ...this.currentSnapshot, errorCode })
  }

  private setSnapshot(snapshot: PlaybackSnapshot<AppleCatalogTrack>): void {
    this.currentSnapshot = snapshot
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch {}
    }
  }

  private subscribeAudioAnalysis(
    listener: (frame: AudioSpectrumFrame | null) => void,
  ): () => void {
    if (this.disposed) return () => {}
    this.analysisListeners.add(listener)
    try {
      listener(this.currentAnalysis)
    } catch {}
    return () => this.analysisListeners.delete(listener)
  }

  private async setAudioAnalysisEnabled(enabled: boolean): Promise<void> {
    this.assertUsable()
    const version = ++this.analysisControlVersion
    this.analysisEnabled = enabled
    this.analysisAcceptingFrames = false
    if (!enabled) this.setAnalysis(null)

    const activeWorker = this.worker
    const startingWorker = this.workerPromise
    if (!activeWorker && !startingWorker) {
      if (enabled && version === this.analysisControlVersion) {
        this.analysisAcceptingFrames = true
      }
      return
    }
    const worker = activeWorker ?? await startingWorker!
    if (
      this.disposed ||
      version !== this.analysisControlVersion ||
      enabled !== this.analysisEnabled
    ) return
    await worker.setAudioAnalysisEnabled(enabled)
    if (enabled && version === this.analysisControlVersion) {
      this.analysisAcceptingFrames = true
    }
  }

  private setAnalysis(frame: AudioSpectrumFrame | null): void {
    if (frame === null && this.currentAnalysis === null) return
    this.currentAnalysis = frame
    for (const listener of this.analysisListeners) {
      try {
        listener(frame)
      } catch {}
    }
  }

  private assertUsable(): void {
    if (this.disposed) throw new ApplePlaybackError("disposed")
    if (!this.authorizationEnabled) throw new ApplePlaybackError("authorization_invalid")
  }
}

class ProcessPlaybackWorkerClient implements PlaybackWorkerClient {
  private readonly child: PlaybackWorkerProcess
  private readonly pending = new Map<number, {
    resolve: () => void
    reject: (error: unknown) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private nextRequestId = 1
  private failed = false
  private disposing = false
  private disposePromise?: Promise<void>

  constructor(
    private readonly onSnapshot: (
      snapshot: Extract<PlaybackWorkerResponse, { type: "snapshot" }>,
    ) => void,
    private readonly onExit: (errorCode: string) => void,
    private readonly onSpectrum: (
      frame: Extract<PlaybackWorkerResponse, { type: "spectrum" }>,
    ) => void,
  ) {
    this.child = spawnPlaybackWorker()
    void this.readResponses()
    void this.child.exited.then((exitCode) => {
      if (!this.disposing) this.fail(exitCode === 0 ? "worker_exited" : "worker_crashed")
    })
  }

  initialize(options: PlaybackWorkerInitialization): Promise<void> {
    return this.request({ type: "initialize", ...options }, INITIALIZE_TIMEOUT_MS)
  }

  setAudioAnalysisEnabled(enabled: boolean): Promise<void> {
    return this.request({ type: "set-audio-analysis-enabled", enabled }, CONTROL_TIMEOUT_MS)
  }

  play(loadId: number, tracks: readonly PlaybackWorkerTrack[]): Promise<void> {
    return this.request({ type: "play", loadId, tracks }, PLAY_TIMEOUT_MS)
  }

  pause(): Promise<void> {
    return this.request({ type: "pause" }, CONTROL_TIMEOUT_MS)
  }

  resume(): Promise<void> {
    return this.request({ type: "resume" }, CONTROL_TIMEOUT_MS)
  }

  previous(): Promise<void> {
    return this.request({ type: "previous" }, CONTROL_TIMEOUT_MS)
  }

  next(): Promise<void> {
    return this.request({ type: "next" }, CONTROL_TIMEOUT_MS)
  }

  setShuffleMode(mode: PlaybackShuffleMode): Promise<void> {
    return this.request({ type: "set-shuffle-mode", mode }, CONTROL_TIMEOUT_MS)
  }

  setRepeatMode(mode: PlaybackRepeatMode): Promise<void> {
    return this.request({ type: "set-repeat-mode", mode }, CONTROL_TIMEOUT_MS)
  }

  seek(positionSeconds: number): Promise<void> {
    return this.request({ type: "seek", positionSeconds }, CONTROL_TIMEOUT_MS)
  }

  stop(): Promise<void> {
    return this.request({ type: "stop" }, CONTROL_TIMEOUT_MS)
  }

  dispose(): Promise<void> {
    this.disposePromise ??= this.runDispose()
    return this.disposePromise
  }

  private async runDispose(): Promise<void> {
    this.disposing = true
    let acknowledged = false
    try {
      if (!this.failed) {
        await this.request({ type: "shutdown" }, SHUTDOWN_TIMEOUT_MS)
        acknowledged = true
      }
    } catch {
    } finally {
      this.child.stdin.end()
      if (!acknowledged || !(await exitsWithin(this.child, SHUTDOWN_TIMEOUT_MS))) {
        this.child.kill(9)
        await exitsWithin(this.child, SHUTDOWN_TIMEOUT_MS)
      }
      this.rejectPending("worker_disposed")
    }
  }

  private request(
    request: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<void> {
    if (this.failed) return Promise.reject(new ApplePlaybackError("worker_unavailable"))
    const requestId = this.nextRequestId++
    const encoded = encodePlaybackMessage({ ...request, requestId })
    if (Buffer.byteLength(encoded, "utf8") > MAX_PLAYBACK_MESSAGE_BYTES) {
      return Promise.reject(new ApplePlaybackError("queue_too_large"))
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new ApplePlaybackError("worker_timeout"))
        this.fail("worker_timeout")
      }, timeoutMs)
      this.pending.set(requestId, { resolve, reject, timer })
      try {
        this.child.stdin.write(encoded)
        this.child.stdin.flush()
      } catch {
        clearTimeout(timer)
        this.pending.delete(requestId)
        reject(new ApplePlaybackError("worker_unavailable"))
        this.fail("worker_unavailable")
      }
    })
  }

  private async readResponses(): Promise<void> {
    const decoder = new TextDecoder("utf-8", { fatal: true })
    let buffer = ""
    try {
      for await (const chunk of this.child.stdout) {
        buffer += decoder.decode(chunk, { stream: true })
        if (Buffer.byteLength(buffer, "utf8") > MAX_PLAYBACK_MESSAGE_BYTES && !buffer.includes("\n")) {
          throw new Error("message_too_large")
        }
        let newline = buffer.indexOf("\n")
        while (newline >= 0) {
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          if (line) this.handleResponse(line)
          newline = buffer.indexOf("\n")
        }
      }
      if (buffer.trim()) throw new Error("incomplete_message")
    } catch {
      this.fail("worker_protocol_error")
    }
  }

  private handleResponse(line: string): void {
    const response = decodePlaybackWorkerResponse(line)
    if (!response) {
      this.fail("worker_protocol_error")
      return
    }
    if (response.type === "snapshot") {
      this.onSnapshot(response)
      return
    }
    if (response.type === "spectrum") {
      this.onSpectrum(response)
      return
    }
    const pending = this.pending.get(response.requestId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(response.requestId)
    if (response.ok) pending.resolve()
    else pending.reject(new ApplePlaybackError(response.errorCode ?? "control_failed"))
  }

  private fail(errorCode: string): void {
    if (this.failed || this.disposing) return
    this.failed = true
    this.child.kill()
    void exitsWithin(this.child, SHUTDOWN_TIMEOUT_MS).then((exited) => {
      if (!exited) this.child.kill(9)
    })
    this.rejectPending(errorCode)
    this.onExit(errorCode)
  }

  private rejectPending(errorCode: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new ApplePlaybackError(errorCode))
    }
    this.pending.clear()
  }
}

interface PlaybackWorkerProcess {
  stdin: {
    write(value: string): number
    flush(): number | Promise<number>
    end(): void
  }
  stdout: ReadableStream<Uint8Array>
  exited: Promise<number>
  kill(signal?: number | string): void
}

function createProcessPlaybackWorkerClient(
  onSnapshot: (snapshot: Extract<PlaybackWorkerResponse, { type: "snapshot" }>) => void,
  onExit: (errorCode: string) => void,
  onSpectrum: (frame: Extract<PlaybackWorkerResponse, { type: "spectrum" }>) => void,
): PlaybackWorkerClient {
  return new ProcessPlaybackWorkerClient(onSnapshot, onExit, onSpectrum)
}

function spawnPlaybackWorker(): PlaybackWorkerProcess {
  return Bun.spawn({
    cmd: [process.execPath, "run", join(import.meta.dir, "apple-playback-worker.ts")],
    env: playbackBrowserEnvironment(process.env),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  }) as unknown as PlaybackWorkerProcess
}

function playableQueue(
  track: AppleCatalogTrack,
  upcomingTracks: readonly AppleCatalogTrack[],
): readonly AppleCatalogTrack[] {
  if (!isPlayableTrack(track)) throw new ApplePlaybackError("invalid_track")
  const seen = new Set([track.apple.playParams.id])
  const queue = [track]
  for (const upcoming of upcomingTracks) {
    if (!isPlayableTrack(upcoming) || seen.has(upcoming.apple.playParams.id)) continue
    seen.add(upcoming.apple.playParams.id)
    queue.push(upcoming)
    if (queue.length === 100) break
  }
  return queue
}

function isPlayableTrack(
  track: AppleCatalogTrack,
): track is AppleCatalogTrack & { apple: { playParams: { id: string; kind: "song" } } } {
  return Boolean(
    track.apple.resourceType === "songs" &&
    track.apple.playParams?.kind === "song" &&
    track.apple.playParams.id === track.apple.resourceId,
  )
}

function playbackErrorCode(error: unknown): string {
  return error instanceof ApplePlaybackError ? error.code : "control_failed"
}

async function exitsWithin(
  child: PlaybackWorkerProcess,
  timeoutMs: number,
): Promise<boolean> {
  return Promise.race([
    child.exited.then(() => true, () => true),
    Bun.sleep(timeoutMs).then(() => false),
  ])
}
