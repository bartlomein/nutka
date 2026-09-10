import type {
  AudioSpectrumFrame,
  AppleCatalogTrack,
  PlaybackController,
  PlaybackSnapshot,
  Station,
} from "../../core/types"

export class FakePlaybackController implements PlaybackController<AppleCatalogTrack> {
  snapshot: PlaybackSnapshot<AppleCatalogTrack> = {
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
  readonly plays: Array<{
    track: AppleCatalogTrack
    upcomingTracks: readonly AppleCatalogTrack[]
  }> = []
  readonly stationPlays: Station[] = []
  pauseCount = 0
  resumeCount = 0
  previousCount = 0
  nextCount = 0
  readonly shuffleModeChanges: Array<"off" | "songs"> = []
  readonly repeatModeChanges: Array<"none" | "all" | "one"> = []
  readonly analysisEnabledChanges: boolean[] = []
  readonly seekPositions: number[] = []
  disconnectCount = 0
  private readonly listeners = new Set<(
    snapshot: PlaybackSnapshot<AppleCatalogTrack>,
  ) => void>()
  private readonly analysisListeners = new Set<(
    frame: AudioSpectrumFrame | null,
  ) => void>()
  readonly audioAnalysis = {
    subscribe: (listener: (frame: AudioSpectrumFrame | null) => void): (() => void) => {
      this.analysisListeners.add(listener)
      listener(null)
      return () => this.analysisListeners.delete(listener)
    },
    setEnabled: async (enabled: boolean): Promise<void> => {
      this.analysisEnabledChanges.push(enabled)
    },
  }

  subscribe(listener: (snapshot: PlaybackSnapshot<AppleCatalogTrack>) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => this.listeners.delete(listener)
  }

  async play(
    track: AppleCatalogTrack,
    upcomingTracks: readonly AppleCatalogTrack[],
  ): Promise<void> {
    this.plays.push({ track, upcomingTracks })
  }

  async playStation(station: Station): Promise<void> {
    this.stationPlays.push(station)
  }

  async pause(): Promise<void> {
    this.pauseCount++
  }

  async resume(): Promise<void> {
    this.resumeCount++
  }

  async previous(): Promise<void> {
    this.previousCount++
  }

  async next(): Promise<void> {
    this.nextCount++
  }

  async setShuffleMode(mode: "off" | "songs"): Promise<void> {
    this.shuffleModeChanges.push(mode)
  }

  async setRepeatMode(mode: "none" | "all" | "one"): Promise<void> {
    this.repeatModeChanges.push(mode)
  }

  async seek(positionSeconds: number): Promise<void> {
    this.seekPositions.push(positionSeconds)
  }
  async stop(): Promise<void> {}

  async disconnect(): Promise<void> {
    this.disconnectCount++
    this.confirm({
      status: "idle",
      currentTrack: null,
      queue: [],
      positionSeconds: 0,
      durationSeconds: null,
      errorCode: null,
    })
  }

  async dispose(): Promise<void> {}

  confirm(snapshot: Omit<
    PlaybackSnapshot<AppleCatalogTrack>,
    | "shuffleMode"
    | "repeatMode"
    | "canSetShuffleMode"
    | "canSetRepeatMode"
  > & Partial<Pick<
    PlaybackSnapshot<AppleCatalogTrack>,
    | "shuffleMode"
    | "repeatMode"
    | "canSetShuffleMode"
    | "canSetRepeatMode"
  >>): void {
    this.snapshot = { ...this.snapshot, ...snapshot }
    for (const listener of this.listeners) listener(this.snapshot)
  }

  confirmAnalysis(frame: AudioSpectrumFrame | null): void {
    for (const listener of this.analysisListeners) listener(frame)
  }
}
