import type { MusicProvider, Track } from "../core/types"
import { filterTracks } from "../core/state"

export const fakeTracks = [
  { id: "soft-static", title: "Soft Static", artist: "Mira Vale", album: "Echoes in Bloom", durationSeconds: 248 },
  { id: "glass-horizon", title: "Glass Horizon", artist: "Tycho Drift", album: "Wide Quiet", durationSeconds: 316 },
  { id: "moonlit-forms", title: "Moonlit Forms", artist: "Helios North", album: "Liminal Paths", durationSeconds: 382 },
  { id: "still-air", title: "Still Air", artist: "Alder Shade", album: "Still Air", durationSeconds: 227 },
  { id: "faint-signals", title: "Faint Signals", artist: "Mira Vale", album: "Echoes in Bloom", durationSeconds: 303 },
  { id: "open-field", title: "Open Field", artist: "Biosphere Run", album: "Long Green", durationSeconds: 299 },
  { id: "weightless", title: "Weightless", artist: "Helios North", album: "Liminal Paths", durationSeconds: 368 },
  { id: "distant-light", title: "Distant Light", artist: "Tycho Drift", album: "Wide Quiet", durationSeconds: 282 },
  { id: "falling-through", title: "Falling Through", artist: "Alder Shade", album: "River Without End", durationSeconds: 328 },
  { id: "hollow-shore", title: "Hollow Shore", artist: "Mira Vale", album: "Echoes in Bloom", durationSeconds: 276 },
  { id: "slow-turning", title: "Slow Turning", artist: "Biosphere Run", album: "Long Green", durationSeconds: 311 },
  { id: "after-the-rain", title: "After the Rain", artist: "Tycho Drift", album: "Wide Quiet", durationSeconds: 260 },
  { id: "zero-wind", title: "Zero Wind", artist: "Helios North", album: "Liminal Paths", durationSeconds: 361 },
] as const satisfies readonly Track[]

export class FakeMusicProvider implements MusicProvider {
  readonly id = "fake"
  readonly displayName = "Demo catalog"

  async search(query: string): Promise<readonly Track[]> {
    return filterTracks(fakeTracks, query)
  }
}
