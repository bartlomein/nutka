import { rm } from "node:fs/promises"

import type {
  AudioAnalysisSource,
  AudioSpectrumFrame,
  AppleCatalogTrack,
  AppleCatalogStation,
  PlaybackController,
  PlaybackRepeatMode,
  PlaybackShuffleMode,
  PlaybackSnapshot,
  Station,
} from "../core/types"
import {
  MAX_PLAYBACK_QUEUE_ITEMS,
  type PlaybackWorkerResponse,
  type PlaybackWorkerItem,
} from "./apple-playback-protocol"
import { loopbackPlaybackUrl } from "./apple-playback-origin"
import {
  applePlaybackProfilePath,
  defaultChromiumExecutablePath,
} from "./chromium-process"
import {
  ApplePlaybackError,
  createProcessPlaybackWorkerClient,
  type PlaybackWorkerClient,
} from "./apple-playback-worker-client"
import { requestDeveloperToken, type Fetch } from "./token-service"
import type { PlaybackLogger } from "./playback-log"

export { ApplePlaybackError }
export type { PlaybackWorkerClient }

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
  logger?: PlaybackLogger
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
  source: null,
  dynamicQueue: false,
  canSeek: false,
  canSkipNext: false,
  canSkipPrevious: false,
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
  private readonly stations = new Map<number, AppleCatalogStation>()
  private worker?: PlaybackWorkerClient
  private workerPromise?: Promise<PlaybackWorkerClient>
  private workerSession?: object
  private disconnectPromise?: Promise<void>
  private authorizationClearPromise?: Promise<void>
  private workerGeneration = 0
  private nextLoadId = 1
  private activeLoadId: number | null = null
  private commandRunning = false
  private authorizationEnabled = true
  private analysisEnabled = true
  private analysisAcceptingFrames = true
  private analysisControlVersion = 0
  private disposed = false
  private readonly logger: PlaybackLogger

  constructor(private readonly options: ApplePlaybackControllerOptions) {
    this.logger = options.logger ?? { log() {} }
  }

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
    } catch (error) {
      this.logIgnoredFailure("snapshot_listener_failed", error)
    }
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
      this.analysisAcceptingFrames = false
      this.setAnalysis(null)
      this.queues.set(loadId, tracks)
      this.stations.delete(loadId)
      try {
        await (await this.getWorker()).play(
          loadId,
          tracks.map((item) => ({
            trackId: item.id,
            resourceId: item.apple.playParams!.id,
          })),
        )
        this.assertWorkerGeneration(generation)
        this.analysisAcceptingFrames = this.analysisEnabled
        for (const knownLoadId of this.queues.keys()) {
          if (knownLoadId < loadId) this.queues.delete(knownLoadId)
        }
        for (const knownLoadId of this.stations.keys()) {
          if (knownLoadId < loadId) this.stations.delete(knownLoadId)
        }
      } catch (error) {
        this.logger.log("track_play_failed", { code: playbackErrorCode(error) })
        this.queues.delete(loadId)
        if (generation === this.workerGeneration) {
          this.analysisAcceptingFrames = this.analysisEnabled
          this.setError(playbackErrorCode(error))
        }
        throw error
      }
    })
  }

  async playStation(station: Station): Promise<void> {
    this.assertUsable()
    const resourceId = "apple" in station
      ? (station as AppleCatalogStation).apple.resourceId
      : undefined
    this.logger.log("station_play_requested", resourceId ? { resourceId } : undefined)
    if (!isPlayableStation(station)) {
      this.setError("invalid_station")
      this.logger.log("station_play_failed", { code: "invalid_station" })
      throw new ApplePlaybackError("invalid_station")
    }
    if (station.apple.externalLiveStream) {
      this.setError("external_station_unsupported")
      this.logger.log("station_play_failed", {
        resourceId: station.apple.resourceId,
        code: "external_station_unsupported",
      })
      throw new ApplePlaybackError("external_station_unsupported")
    }
    return this.runCommand(async () => {
      const generation = this.workerGeneration
      const loadId = this.nextLoadId++
      this.activeLoadId = null
      this.analysisAcceptingFrames = false
      this.setAnalysis(null)
      this.stations.set(loadId, station)
      try {
        await (await this.getWorker()).playStation(
          loadId,
          station.apple.resourceId,
          station.title,
          station.isLive,
        )
        this.assertWorkerGeneration(generation)
        this.logger.log("station_play_confirmed", { resourceId: station.apple.resourceId })
        this.analysisAcceptingFrames = this.analysisEnabled
        for (const knownLoadId of this.stations.keys()) {
          if (knownLoadId < loadId) this.stations.delete(knownLoadId)
        }
        for (const knownLoadId of this.queues.keys()) {
          if (knownLoadId < loadId) this.queues.delete(knownLoadId)
        }
      } catch (error) {
        const code = playbackErrorCode(error) === "playback_timeout" &&
            station.apple.externalLiveStream
          ? "external_station_unsupported"
          : playbackErrorCode(error)
        this.logger.log("station_play_failed", {
          resourceId: station.apple.resourceId,
          code,
        })
        this.stations.delete(loadId)
        if (generation === this.workerGeneration) {
          this.analysisAcceptingFrames = this.analysisEnabled
          this.setError(code)
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
      this.activeLoadId === null || this.currentSnapshot.canSkipNext !== true
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
    if (this.currentSnapshot.canSeek !== true) return
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
    this.workerSession = undefined
    const worker = this.worker
    const starting = this.workerPromise
    this.worker = undefined
    this.workerPromise = undefined
    this.queues.clear()
    this.stations.clear()
    this.activeLoadId = null
    this.setAnalysis(null)
    this.setSnapshot(idleSnapshot)
    await worker?.dispose().catch((error) => {
      this.logIgnoredFailure("worker_dispose_failed", error)
    })
    if (starting) {
      await starting.then((pendingWorker) => pendingWorker.dispose()).catch((error) => {
        this.logIgnoredFailure("starting_worker_dispose_failed", error)
      })
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
    const session = {}
    this.workerSession = session
    const starting = this.startWorker(generation, session)
    this.workerPromise = starting
    try {
      const worker = await starting
      if (
        this.disposed ||
        generation !== this.workerGeneration ||
        session !== this.workerSession
      ) {
        await worker.dispose().catch((error) => {
          this.logIgnoredFailure("stale_worker_dispose_failed", error)
        })
        throw new ApplePlaybackError(this.disposed ? "disposed" : "worker_disconnected")
      }
      this.worker = worker
      return worker
    } finally {
      if (this.workerPromise === starting) this.workerPromise = undefined
      if (!this.worker && this.workerSession === session) this.workerSession = undefined
    }
  }

  private async startWorker(generation: number, session: object): Promise<PlaybackWorkerClient> {
    const createWorker = this.options.createWorkerClient ?? createProcessPlaybackWorkerClient
    let worker: PlaybackWorkerClient | undefined
    try {
      const playbackUrl = loopbackPlaybackUrl(this.options.serviceUrl)
      if (!playbackUrl) throw new ApplePlaybackError("untrusted_playback_origin")
      const issued = await requestDeveloperToken(this.options.serviceUrl, this.options.fetch)
      if (issued.mode !== "apple") throw new ApplePlaybackError("token_service_unavailable")
      worker = createWorker(
        (snapshot) => {
          if (generation === this.workerGeneration && session === this.workerSession) {
            this.handleWorkerSnapshot(snapshot)
          }
        },
        (errorCode) => {
          this.handleWorkerExit(session, worker, errorCode)
        },
        (frame) => {
          if (generation === this.workerGeneration && session === this.workerSession) {
            this.handleWorkerSpectrum(frame)
          }
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
      await worker?.dispose().catch((disposeError) => {
        this.logIgnoredFailure("failed_worker_dispose_failed", disposeError)
      })
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
        source: null,
        dynamicQueue: false,
        canSeek: false,
        canSkipNext: false,
        canSkipPrevious: false,
      })
      return
    }

    const tracks = this.queues.get(snapshot.loadId)
    const tracksByResourceId = new Map(
      tracks?.map((track) => [track.apple.playParams!.id, track]) ?? [],
    )
    const metadataByResourceId = new Map(
      snapshot.queueItems.map((item) => [item.resourceId, item]),
    )
    if (snapshot.currentItem) {
      metadataByResourceId.set(snapshot.currentItem.resourceId, snapshot.currentItem)
    }
    const station = this.stations.get(snapshot.loadId)
    const resolveTrack = (resourceId: string): AppleCatalogTrack =>
      tracksByResourceId.get(resourceId) ??
      (station
        ? generatedStationTrack(resourceId, metadataByResourceId.get(resourceId), station)
        : generatedFiniteQueueTrack(resourceId, metadataByResourceId.get(resourceId)))
    const orderedTracks = snapshot.queueResourceIds.flatMap((resourceId) => {
      const track = resolveTrack(resourceId)
      return track ? [track] : []
    })
    const currentIndex = snapshot.queuePosition >= 0 &&
        orderedTracks[snapshot.queuePosition]?.apple.playParams?.id === snapshot.resourceId
      ? snapshot.queuePosition
      : orderedTracks.findIndex(
          (track) => track.apple.playParams?.id === snapshot.resourceId,
        )
    const catalogTrack = orderedTracks[currentIndex] ??
      (snapshot.resourceId ? resolveTrack(snapshot.resourceId) : undefined)
    if (!catalogTrack) return
    this.activeLoadId = snapshot.loadId
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
      source: snapshot.source?.type === "station"
        ? {
            type: "station",
            id: snapshot.source.stationId,
            title: snapshot.source.title,
            isLive: snapshot.source.isLive,
          }
        : { type: "finite" },
      dynamicQueue: snapshot.dynamicQueue,
      canSeek: snapshot.canSeek,
      canSkipNext: snapshot.canSkipNext,
      canSkipPrevious: snapshot.canSkipPrevious,
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
    session: object,
    worker: PlaybackWorkerClient | undefined,
    errorCode: string,
  ): void {
    if (session !== this.workerSession) return
    this.workerGeneration++
    this.workerSession = undefined
    if (this.worker === worker) this.worker = undefined
    if (this.disposed) return
    this.queues.clear()
    this.stations.clear()
    this.activeLoadId = null
    this.setAnalysis(null)
    this.setSnapshot({ ...idleSnapshot, errorCode })
  }

  private hasPreviousTrack(): boolean {
    return this.activeLoadId !== null && this.currentSnapshot.canSkipPrevious === true
  }

  private async runControl(
    control: (worker: PlaybackWorkerClient) => Promise<void>,
  ): Promise<void> {
    const generation = this.workerGeneration
    try {
      await control(await this.getWorker())
      this.assertWorkerGeneration(generation)
    } catch (error) {
      const code = playbackErrorCode(error)
      this.logger.log("playback_control_failed", { code })
      if (generation === this.workerGeneration) this.setError(code)
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
      } catch (error) {
        this.logIgnoredFailure("snapshot_listener_failed", error)
      }
    }
  }

  private subscribeAudioAnalysis(
    listener: (frame: AudioSpectrumFrame | null) => void,
  ): () => void {
    if (this.disposed) return () => {}
    this.analysisListeners.add(listener)
    try {
      listener(this.currentAnalysis)
    } catch (error) {
      this.logIgnoredFailure("analysis_listener_failed", error)
    }
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
      } catch (error) {
        this.logIgnoredFailure("analysis_listener_failed", error)
      }
    }
  }

  private logIgnoredFailure(event: string, error: unknown): void {
    this.logger.log(event, { code: playbackErrorCode(error) })
  }

  private assertUsable(): void {
    if (this.disposed) throw new ApplePlaybackError("disposed")
    if (!this.authorizationEnabled) throw new ApplePlaybackError("authorization_invalid")
  }

  private assertWorkerGeneration(generation: number): void {
    if (generation !== this.workerGeneration) {
      throw new ApplePlaybackError("worker_disconnected")
    }
  }
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
    if (queue.length === MAX_PLAYBACK_QUEUE_ITEMS) break
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

function isPlayableStation(station: Station): station is AppleCatalogStation {
  if (!("apple" in station)) return false
  const apple = (station as AppleCatalogStation).apple
  return apple.resourceType === "stations" &&
    (!apple.playParams || (
      apple.playParams.kind === "radioStation" &&
      apple.playParams.id === apple.resourceId
    ))
}

function generatedStationTrack(
  resourceId: string,
  item: PlaybackWorkerItem | undefined,
  station: AppleCatalogStation,
): AppleCatalogTrack {
  const title = item?.title || station.title || "Apple Music Station"
  return {
    id: `apple:song:${resourceId}`,
    title,
    artist: item?.artist || "Apple Music",
    album: item?.album || station.title || "Apple Music Station",
    durationSeconds: item?.durationSeconds ?? 0,
    apple: {
      resourceId,
      resourceType: "songs",
      playParams: { id: resourceId, kind: "song" },
    },
  }
}

function generatedFiniteQueueTrack(
  resourceId: string,
  item: PlaybackWorkerItem | undefined,
): AppleCatalogTrack {
  return {
    id: `apple:song:${resourceId}`,
    title: item?.title || "Apple Music Track",
    artist: item?.artist || "Apple Music",
    album: item?.album || "Apple Music",
    durationSeconds: item?.durationSeconds ?? 0,
    apple: {
      resourceId,
      resourceType: "songs",
      playParams: { id: resourceId, kind: "song" },
    },
  }
}

function playbackErrorCode(error: unknown): string {
  return error instanceof ApplePlaybackError ? error.code : "control_failed"
}
