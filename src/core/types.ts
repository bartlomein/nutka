export type AudioFormat =
  | "aac"
  | "stereo"
  | "lossless"
  | "hi-res-lossless"
  | "dolby-audio"
  | "dolby-atmos"
  | "spatial-audio"

export interface AudioQuality {
  format: AudioFormat
  bitrateKbps?: number
  bitDepth?: number
  sampleRateKhz?: number
  source: "catalog" | "playback"
}

export interface Track {
  id: string
  title: string
  artist: string
  album: string
  durationSeconds: number
  audioQuality?: AudioQuality
}

export type AppleAudioTrait =
  | "atmos"
  | "dolby-atmos"
  | "dolby-audio"
  | "hi-res-lossless"
  | "lossless"
  | "lossy-stereo"
  | "spatial"

export interface AppleArtwork {
  url: string
  width: number | null
  height: number | null
}

export type AppleContentRating = "clean" | "explicit"

export interface AppleTrackDetails {
  releaseDate?: string
  genreNames?: readonly string[]
  trackNumber?: number
  discNumber?: number
  composerName?: string
  contentRating?: AppleContentRating
  editorialNotes?: string
  hasLyrics?: boolean
  isAppleDigitalMaster?: boolean
}

export interface AppleAlbumDetails {
  releaseDate?: string
  genreNames?: readonly string[]
  trackCount?: number
  recordLabel?: string
  copyright?: string
  contentRating?: AppleContentRating
  editorialNotes?: string
  isCompilation?: boolean
  isSingle?: boolean
}

export interface AppleArtistDetails {
  genreNames?: readonly string[]
  editorialNotes?: string
}

export interface ApplePlaylistDetails {
  lastModifiedDate?: string
  dateAdded?: string
  playlistType?: string
  isChart?: boolean
  canEdit?: boolean
  isPublic?: boolean
  hasCatalog?: boolean
}

export interface AppleCatalogTrack extends Track {
  apple: {
    resourceId: string
    resourceType: "songs"
    playParams?: { id: string; kind: "song" }
    artwork?: AppleArtwork
    audioTraits?: readonly AppleAudioTrait[]
    details?: AppleTrackDetails
  }
}

export type ApplePersonalRating = -1 | 1
export type ApplePersonalRatingResourceType = "songs" | "stations"
export type ApplePersonalSongRating = ApplePersonalRating
export type ApplePersonalStationRating = ApplePersonalRating

export interface AppleCatalogAlbumSummary {
  id: string
  title: string
  artist: string
  apple: {
    resourceId: string
    resourceType: "albums"
    artwork?: AppleArtwork
    details?: AppleAlbumDetails
  }
}

export interface AppleCatalogAlbum extends AppleCatalogAlbumSummary {
  tracks: readonly AppleCatalogTrack[]
}

export interface AppleCatalogArtist {
  id: string
  name: string
  apple: {
    resourceId: string
    resourceType: "artists"
    artwork?: AppleArtwork
    details?: AppleArtistDetails
  }
}

export interface Station {
  id: string
  title: string
  subtitle?: string
  description?: string
  isLive: boolean
}

export interface AppleCatalogStation extends Station {
  apple: {
    resourceId: string
    resourceType: "stations"
    playParams?: { id: string; kind: "radioStation" }
    externalLiveStream?: true
    artwork: AppleArtwork
  }
}

export interface AppleCatalogStationGenre {
  id: string
  name: string
  apple: {
    resourceId: string
    resourceType: "station-genres"
  }
}

export interface AppleSongContext {
  albums: readonly AppleCatalogAlbumSummary[]
  artists: readonly AppleCatalogArtist[]
}

export type AppleArtistSectionName =
  | "top-songs"
  | "latest-release"
  | "full-albums"
  | "singles"
  | "similar-artists"

export type AppleArtistSectionPage =
  | {
      section: "top-songs"
      items: readonly AppleCatalogTrack[]
      nextCursor: string | null
    }
  | {
      section: "latest-release"
      items: readonly AppleCatalogAlbumSummary[]
      nextCursor: string | null
    }
  | {
      section: "full-albums"
      items: readonly AppleCatalogAlbumSummary[]
      nextCursor: string | null
    }
  | {
      section: "singles"
      items: readonly AppleCatalogAlbumSummary[]
      nextCursor: string | null
    }
  | {
      section: "similar-artists"
      items: readonly AppleCatalogArtist[]
      nextCursor: string | null
    }

interface ApplePlaylistBase {
  id: string
  title: string
  curator: string
  description?: string
}

export interface AppleCatalogPlaylist extends ApplePlaylistBase {
  apple: {
    resourceId: string
    resourceType: "playlists"
    artwork?: AppleArtwork
    details?: ApplePlaylistDetails
  }
}

export interface AppleHomeSection {
  id: string
  title: string
  items: readonly (AppleCatalogPlaylist | AppleCatalogStation)[]
}

export interface AppleLibraryPlaylist extends ApplePlaylistBase {
  apple: {
    resourceId: string
    resourceType: "library-playlists"
    globalId?: string
    artwork?: AppleArtwork
    details?: ApplePlaylistDetails
  }
}

export type ApplePlaylist = AppleCatalogPlaylist | AppleLibraryPlaylist

export interface SearchPage<T> {
  items: readonly T[]
  nextCursor: string | null
}

export type AppleLibrarySection = "songs" | "albums" | "artists"

// Library IDs stay distinct from catalog IDs, including for uploaded songs.
export interface AppleLibrarySong extends Track {
  kind: "song"
  resourceId: string
  playback?: AppleCatalogTrack
}

export interface AppleLibraryAlbum {
  kind: "album"
  id: string
  resourceId: string
  title: string
  artist: string
}

export interface AppleLibraryArtist {
  kind: "artist"
  id: string
  resourceId: string
  name: string
}

export type AppleLibraryItem = AppleLibrarySong | AppleLibraryAlbum | AppleLibraryArtist

export interface SearchOptions {
  signal?: AbortSignal
  cursor?: string
}

export interface MusicProvider<TTrack extends Track = Track> {
  readonly id: string
  readonly displayName: string
  searchSongs(query: string, options?: SearchOptions): Promise<SearchPage<TTrack>>
}

export type PlaybackStatus = "idle" | "playing" | "paused"
export type PlaybackShuffleMode = "off" | "songs"
export type PlaybackRepeatMode = "none" | "all" | "one"

export type PlaybackSource =
  | { readonly type: "finite" }
  | {
      readonly type: "station"
      readonly id: string
      readonly title: string
      readonly isLive: boolean
    }

export interface PlaybackSnapshot<TTrack extends Track = Track> {
  readonly status: PlaybackStatus
  readonly currentTrack: TTrack | null
  readonly queue: readonly TTrack[]
  readonly positionSeconds: number
  readonly durationSeconds: number | null
  readonly errorCode: string | null
  readonly shuffleMode: PlaybackShuffleMode
  readonly repeatMode: PlaybackRepeatMode
  readonly canSetShuffleMode: boolean
  readonly canSetRepeatMode: boolean
  readonly source?: PlaybackSource | null
  readonly dynamicQueue?: boolean
  readonly canSeek?: boolean
  readonly canSkipNext?: boolean
  readonly canSkipPrevious?: boolean
}

export interface AudioSpectrumFrame {
  readonly sequence: number
  readonly bands: readonly number[]
  readonly rms: number
  readonly peak: number
}

export interface AudioAnalysisSource {
  subscribe(listener: (frame: AudioSpectrumFrame | null) => void): () => void
  setEnabled(enabled: boolean): Promise<void>
}

export interface PlaybackController<TTrack extends Track = Track> {
  readonly snapshot: PlaybackSnapshot<TTrack>
  readonly audioAnalysis?: AudioAnalysisSource
  subscribe(listener: (snapshot: PlaybackSnapshot<TTrack>) => void): () => void
  play(track: TTrack, upcomingTracks: readonly TTrack[]): Promise<void>
  playStation?(station: Station): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  previous(): Promise<void>
  next(): Promise<void>
  setShuffleMode(mode: PlaybackShuffleMode): Promise<void>
  setRepeatMode(mode: PlaybackRepeatMode): Promise<void>
  seek(positionSeconds: number): Promise<void>
  stop(): Promise<void>
  disconnect(): Promise<void>
  dispose(): Promise<void>
}
