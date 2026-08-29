import type { Track } from "../../core/types"

export type TrackSource =
  | "library"
  | "search"
  | "playlist"
  | "album"
  | "browse"
  | "playback"

export class TrackStore {
  private readonly sources = new Map<TrackSource, Map<string, Track>>()

  constructor(library: readonly Track[]) {
    this.replace("library", library)
  }

  get(id: string): Track | undefined {
    for (const tracks of this.sources.values()) {
      const track = tracks.get(id)
      if (track) return track
    }
    return undefined
  }

  replace(source: TrackSource, tracks: readonly Track[]): void {
    this.sources.set(source, new Map(tracks.map((track) => [track.id, track])))
  }

  add(source: TrackSource, tracks: readonly Track[]): void {
    const values = this.sources.get(source) ?? new Map<string, Track>()
    for (const track of tracks) values.set(track.id, track)
    this.sources.set(source, values)
  }

  clear(source: TrackSource): void {
    this.sources.delete(source)
  }
}
