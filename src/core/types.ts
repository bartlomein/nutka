export interface Track {
  id: string
  title: string
  artist: string
  album: string
  durationSeconds: number
}

export interface MusicProvider {
  readonly id: string
  readonly displayName: string
  search(query: string): Promise<readonly Track[]>
}

export type PlaybackStatus = "idle" | "playing" | "paused"

export interface PlaybackController {
  readonly status: PlaybackStatus
  readonly currentTrack: Track | null
  play(track: Track): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  seek(positionSeconds: number): Promise<void>
  stop(): Promise<void>
}
