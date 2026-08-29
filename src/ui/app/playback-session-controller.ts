import type { PlaybackState } from "../../core/state"
import type {
  AppleCatalogStation,
  AppleCatalogTrack,
  ApplePlaylist,
  AudioSpectrumFrame,
  PlaybackController,
  PlaybackSnapshot,
  SearchOptions,
  SearchPage,
  Track,
} from "../../core/types"
import { appleSongResourceId, appendUniqueTracks, isPlayableAppleTrack } from "./browse"

const maxPlaybackQueueTracks = 100
const maxPlaylistShufflePages = 4

export interface PlaybackSessionServices {
  playback?: PlaybackController<AppleCatalogTrack>
  getSongLiked?: (
    songResourceId: string,
    options?: Pick<SearchOptions, "signal">,
  ) => Promise<boolean>
  setSongLiked?: (
    songResourceId: string,
    liked: boolean,
    options?: Pick<SearchOptions, "signal">,
  ) => Promise<void>
  getPlaylistTracks?: (
    playlist: ApplePlaylist,
    options?: SearchOptions,
  ) => Promise<SearchPage<AppleCatalogTrack>>
  random?: () => number
}

export interface PlaybackSessionHost {
  getPlaybackState(): PlaybackState
  getTrack(id: string): Track | undefined
  getRandomTracks(): readonly AppleCatalogTrack[]
  getSelectedPlaylist(): ApplePlaylist | undefined
  replacePlaybackTracks(tracks: readonly AppleCatalogTrack[]): void
  syncPlayback(snapshot: PlaybackSnapshot<AppleCatalogTrack>): void
  renderAudioAnalysis(frame: AudioSpectrumFrame | null): void
  render(): void
}

export interface SongLikeModel {
  liked: boolean
  status: "loading" | "ready" | "saving" | "error" | "unavailable"
  error: boolean
}

interface SongLikeState {
  liked: boolean
  status: "loading" | "ready" | "saving" | "error"
}

export class PlaybackSessionController {
  private pendingSeekSeconds: number | null = null
  private seekAnchorSeconds: number | null = null
  private seekRunning = false
  private readonly songLikeStates = new Map<string, SongLikeState>()
  private readonly songLikeRequests = new Set<AbortController>()
  private randomPlaylistRequest: AbortController | undefined
  private randomPlaylistGeneration = 0
  private authenticated = false
  private unsubscribePlayback: (() => void) | undefined
  private unsubscribeAudioAnalysis: (() => void) | undefined

  constructor(
    private readonly services: PlaybackSessionServices,
    private readonly host: PlaybackSessionHost,
  ) {}

  get connected(): boolean {
    return Boolean(this.services.playback)
  }

  get canPlayStation(): boolean {
    return Boolean(this.services.playback?.playStation)
  }

  start(): void {
    if (this.unsubscribePlayback || this.unsubscribeAudioAnalysis) return
    this.unsubscribePlayback = this.services.playback?.subscribe((snapshot) => {
      this.syncPlayback(snapshot)
    })
    this.unsubscribeAudioAnalysis = this.services.playback?.audioAnalysis?.subscribe((frame) => {
      this.host.renderAudioAnalysis(frame)
    })
  }

  destroy(): void {
    this.cancelRandomPlaylist()
    this.cancelSongLikes()
    this.pendingSeekSeconds = null
    this.seekAnchorSeconds = null
    this.unsubscribePlayback?.()
    this.unsubscribePlayback = undefined
    this.unsubscribeAudioAnalysis?.()
    this.unsubscribeAudioAnalysis = undefined
  }

  authenticationChanged(authenticated: boolean, sessionChanged: boolean): void {
    if (sessionChanged) {
      this.cancelRandomPlaylist()
      void this.services.playback?.disconnect()
    }
    this.authenticated = authenticated
    if (!authenticated) this.cancelSongLikes()
    else {
      const track = this.currentTrack()
      if (track) void this.loadSongLike(track)
    }
  }

  currentSongLike(): SongLikeModel {
    const state = this.host.getPlaybackState()
    const track = state.currentTrackId ? this.host.getTrack(state.currentTrackId) : undefined
    const resourceId = appleSongResourceId(track)
    if (
      !this.authenticated ||
      !this.services.getSongLiked ||
      !this.services.setSongLiked ||
      !resourceId
    ) {
      return { liked: false, status: "unavailable", error: false }
    }
    const like = this.songLikeStates.get(resourceId)
    return {
      liked: like?.liked ?? false,
      status: like?.status ?? "loading",
      error: like?.status === "error",
    }
  }

  canToggleCurrentSongLike(): boolean {
    if (!this.authenticated || !this.services.getSongLiked || !this.services.setSongLiked) {
      return false
    }
    const track = this.currentTrack()
    if (!track) return false
    const like = this.songLikeStates.get(track.apple.resourceId)
    return like?.status === "ready" || like?.status === "error"
  }

  async toggleCurrentSongLike(): Promise<void> {
    if (!this.authenticated || !this.services.getSongLiked || !this.services.setSongLiked) return
    const track = this.currentTrack()
    if (!track) return

    const resourceId = track.apple.resourceId
    const current = this.songLikeStates.get(resourceId)
    if (!current) {
      void this.loadSongLike(track)
      this.host.render()
      return
    }
    if (current.status === "loading" || current.status === "saving") return

    const pending: SongLikeState = { liked: !current.liked, status: "saving" }
    const controller = new AbortController()
    this.songLikeRequests.add(controller)
    this.songLikeStates.set(resourceId, pending)
    this.host.render()
    try {
      await this.services.setSongLiked(resourceId, pending.liked, { signal: controller.signal })
      if (controller.signal.aborted || this.songLikeStates.get(resourceId) !== pending) return
      this.songLikeStates.set(resourceId, { liked: pending.liked, status: "ready" })
      this.host.render()
    } catch {
      if (controller.signal.aborted || this.songLikeStates.get(resourceId) !== pending) return
      this.songLikeStates.set(resourceId, { liked: current.liked, status: "error" })
      this.host.render()
    } finally {
      this.songLikeRequests.delete(controller)
    }
  }

  play(track: AppleCatalogTrack, upcoming: readonly AppleCatalogTrack[]): Promise<void> {
    return this.services.playback?.play(track, upcoming) ?? Promise.resolve()
  }

  playStation(station: AppleCatalogStation): Promise<void> {
    return this.services.playback?.playStation?.(station) ?? Promise.resolve()
  }

  togglePlayback(): void {
    const playback = this.services.playback
    if (!playback) return
    const status = this.host.getPlaybackState().status
    if (status === "playing") void playback.pause().catch(() => {})
    else if (status === "paused") void playback.resume().catch(() => {})
  }

  playPrevious(): void {
    if (!this.host.getPlaybackState().canSkipPrevious) return
    void this.services.playback?.previous().catch(() => {})
  }

  playNext(): void {
    if (!this.host.getPlaybackState().canSkipNext) return
    void this.services.playback?.next().catch(() => {})
  }

  requestSeek(positionSeconds: number): void {
    const playback = this.services.playback
    const state = this.host.getPlaybackState()
    if (!playback || !state.currentTrackId || !state.canSeek) return
    const duration = this.seekDuration(state)
    if (duration === null || !Number.isFinite(positionSeconds)) return
    const target = Math.max(0, Math.min(positionSeconds, duration))
    this.seekAnchorSeconds = target
    this.pendingSeekSeconds = target
    if (!this.seekRunning) void this.drainSeekRequests(playback)
  }

  seekBy(deltaSeconds: number): void {
    const state = this.host.getPlaybackState()
    this.requestSeek((this.seekAnchorSeconds ?? state.positionSeconds) + deltaSeconds)
  }

  playRandom(): void {
    const state = this.host.getPlaybackState()
    if (!this.services.playback) return
    const playlist = this.host.getSelectedPlaylist()
    if (playlist) {
      void this.playPlaylistRandom(playlist)
      return
    }
    if (state.currentTrackId && state.canSetShuffleMode) {
      this.toggleShuffleMode()
      return
    }
    this.playTracksRandom(this.host.getRandomTracks())
  }

  toggleShuffleMode(): void {
    const playback = this.services.playback
    const state = this.host.getPlaybackState()
    if (!playback || !state.canSetShuffleMode) return
    const mode = state.shuffleMode === "songs" ? "off" : "songs"
    void playback.setShuffleMode(mode).catch(() => {})
  }

  cycleRepeatMode(): void {
    const playback = this.services.playback
    const state = this.host.getPlaybackState()
    if (!playback || !state.canSetRepeatMode) return
    const mode = state.repeatMode === "none"
      ? "all"
      : state.repeatMode === "all"
        ? "one"
        : "none"
    void playback.setRepeatMode(mode).catch(() => {})
  }

  setAudioAnalysisEnabled(enabled: boolean): void {
    void this.services.playback?.audioAnalysis?.setEnabled(enabled).catch(() => {})
  }

  private syncPlayback(snapshot: PlaybackSnapshot<AppleCatalogTrack>): void {
    const previousTrackId = this.host.getPlaybackState().currentTrackId
    this.host.replacePlaybackTracks([
      ...(snapshot.currentTrack ? [snapshot.currentTrack] : []),
      ...snapshot.queue,
    ])
    if (!snapshot.currentTrack || snapshot.currentTrack.id !== previousTrackId) {
      this.pendingSeekSeconds = null
      this.seekAnchorSeconds = null
      if (snapshot.currentTrack) void this.loadSongLike(snapshot.currentTrack)
    } else if (
      this.pendingSeekSeconds === null &&
      this.seekAnchorSeconds !== null &&
      Math.abs(snapshot.positionSeconds - this.seekAnchorSeconds) <= 2
    ) {
      this.seekAnchorSeconds = null
    }
    this.host.syncPlayback(snapshot)
  }

  private async loadSongLike(track: AppleCatalogTrack): Promise<void> {
    const resourceId = track.apple.resourceId
    if (!this.authenticated || !this.services.getSongLiked || this.songLikeStates.has(resourceId)) {
      return
    }

    const controller = new AbortController()
    const loading: SongLikeState = { liked: false, status: "loading" }
    this.songLikeRequests.add(controller)
    this.songLikeStates.set(resourceId, loading)
    try {
      const liked = await this.services.getSongLiked(resourceId, { signal: controller.signal })
      if (controller.signal.aborted || this.songLikeStates.get(resourceId) !== loading) return
      this.songLikeStates.set(resourceId, { liked, status: "ready" })
      this.host.render()
    } catch {
      if (controller.signal.aborted || this.songLikeStates.get(resourceId) !== loading) return
      this.songLikeStates.set(resourceId, { liked: false, status: "error" })
      this.host.render()
    } finally {
      this.songLikeRequests.delete(controller)
    }
  }

  private currentTrack(): AppleCatalogTrack | undefined {
    const id = this.host.getPlaybackState().currentTrackId
    const track = id ? this.host.getTrack(id) : undefined
    return isPlayableAppleTrack(track) ? track : undefined
  }

  private seekDuration(state: PlaybackState): number | null {
    const track = state.currentTrackId ? this.host.getTrack(state.currentTrackId) : undefined
    const duration = state.durationSeconds ?? track?.durationSeconds ?? null
    return duration !== null && Number.isFinite(duration) && duration > 0 ? duration : null
  }

  private playTracksRandom(tracks: readonly AppleCatalogTrack[]): void {
    const playback = this.services.playback
    if (!playback || tracks.length === 0) return
    const random = this.services.random ?? Math.random
    const shuffled = [...tracks]
    for (let index = shuffled.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(random() * (index + 1))
      const swapTrack = shuffled[index]!
      shuffled[index] = shuffled[swapIndex]!
      shuffled[swapIndex] = swapTrack
    }
    const currentTrackId = this.host.getPlaybackState().currentTrackId
    if (shuffled.length > 1 && shuffled[0]?.id === currentTrackId) {
      const alternativeIndex = shuffled.findIndex((track) => track.id !== currentTrackId)
      if (alternativeIndex > 0) {
        const currentTrack = shuffled[0]!
        shuffled[0] = shuffled[alternativeIndex]!
        shuffled[alternativeIndex] = currentTrack
      }
    }
    const selected = shuffled[0]
    if (!selected) return
    void playback.play(selected, shuffled.slice(1))
      .then(() => playback.setShuffleMode("songs"))
      .catch(() => {})
  }

  private async playPlaylistRandom(playlist: ApplePlaylist): Promise<void> {
    if (!this.services.playback || !this.services.getPlaylistTracks) return
    const generation = ++this.randomPlaylistGeneration
    this.randomPlaylistRequest?.abort()
    const controller = new AbortController()
    this.randomPlaylistRequest = controller
    let tracks: readonly AppleCatalogTrack[] = []
    let cursor: string | undefined
    try {
      for (let pageNumber = 0; pageNumber < maxPlaylistShufflePages; pageNumber++) {
        const page = await this.services.getPlaylistTracks(playlist, {
          ...(cursor ? { cursor } : {}),
          signal: controller.signal,
        })
        if (controller.signal.aborted || generation !== this.randomPlaylistGeneration) return
        tracks = appendUniqueTracks(tracks, page.items).slice(0, maxPlaybackQueueTracks)
        cursor = page.nextCursor ?? undefined
        if (!cursor || tracks.length === maxPlaybackQueueTracks) break
      }
      this.playTracksRandom(tracks.filter(isPlayableAppleTrack))
    } catch {
      // Keep the current playback unchanged if playlist loading fails.
    } finally {
      if (this.randomPlaylistRequest === controller) this.randomPlaylistRequest = undefined
    }
  }

  private async drainSeekRequests(playback: PlaybackController<AppleCatalogTrack>): Promise<void> {
    if (this.seekRunning) return
    this.seekRunning = true
    try {
      while (this.pendingSeekSeconds !== null) {
        const target = this.pendingSeekSeconds
        this.pendingSeekSeconds = null
        try {
          await playback.seek(target)
        } catch {
          if (this.pendingSeekSeconds === null) this.seekAnchorSeconds = null
        }
      }
    } finally {
      this.seekRunning = false
    }
  }

  private cancelRandomPlaylist(): void {
    this.randomPlaylistGeneration++
    this.randomPlaylistRequest?.abort()
    this.randomPlaylistRequest = undefined
  }

  private cancelSongLikes(): void {
    for (const request of this.songLikeRequests) request.abort()
    this.songLikeRequests.clear()
    this.songLikeStates.clear()
  }
}
