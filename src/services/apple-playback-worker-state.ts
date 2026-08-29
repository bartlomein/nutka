import type { PlaybackWorkerSource } from "./apple-playback-protocol"
import type { PlaybackBrowserSnapshot } from "./apple-playback-protocol"

export type ConfirmedPlaybackStatus = "idle" | "playing" | "paused"

export interface PlaybackWorkerStateSnapshot {
  loadId: number | null
  resourceIds: readonly string[]
  source: PlaybackWorkerSource | null
  status: ConfirmedPlaybackStatus
}

export class PlaybackWorkerState {
  private current: PlaybackWorkerStateSnapshot = {
    loadId: null,
    resourceIds: [],
    source: null,
    status: "idle",
  }

  get snapshot(): PlaybackWorkerStateSnapshot {
    return this.current
  }

  beginLoad(
    loadId: number,
    source: PlaybackWorkerSource,
    resourceIds: readonly string[],
  ): PlaybackWorkerStateSnapshot {
    const previous = this.current
    this.current = { loadId, source, resourceIds, status: "idle" }
    return previous
  }

  restore(previous: PlaybackWorkerStateSnapshot, status?: ConfirmedPlaybackStatus): void {
    this.current = status ? { ...previous, status } : previous
  }

  confirm(status: ConfirmedPlaybackStatus): void {
    this.current = { ...this.current, status }
  }

  clear(): void {
    this.current = {
      loadId: null,
      resourceIds: [],
      source: null,
      status: "idle",
    }
  }

  updateFiniteQueue(resourceIds: readonly string[]): void {
    if (this.current.loadId === null || this.current.source?.type !== "finite") return
    this.current = { ...this.current, resourceIds }
  }

  reconcile(
    snapshot: PlaybackBrowserSnapshot,
    commandRunning: boolean,
  ): "reconcile-spectrum" | "stop-spectrum" | null {
    if (commandRunning) return null
    if (snapshot.isPlaying === true) {
      const changed = this.current.status !== "playing"
      this.confirm("playing")
      return changed ? "reconcile-spectrum" : null
    }
    if ([0, 4, 10].includes(snapshot.playbackState ?? -1)) {
      this.clear()
      return "stop-spectrum"
    }
    if (snapshot.playbackState === 3) {
      const changed = this.current.status === "playing"
      this.confirm("paused")
      return changed ? "reconcile-spectrum" : null
    }
    return null
  }
}
