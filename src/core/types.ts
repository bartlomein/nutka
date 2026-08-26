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

export interface AppleCatalogAlbum {
  id: string
  title: string
  artist: string
  tracks: readonly AppleCatalogTrack[]
  apple: {
    resourceId: string
    resourceType: "albums"
    artwork?: AppleArtwork
    details?: AppleAlbumDetails
  }
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

export interface PlaybackSnapshot<TTrack extends Track = Track> {
  readonly status: PlaybackStatus
  readonly currentTrack: TTrack | null
  readonly queue: readonly TTrack[]
  readonly positionSeconds: number
  readonly durationSeconds: number | null
  readonly errorCode: string | null
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
  pause(): Promise<void>
  resume(): Promise<void>
  previous(): Promise<void>
  next(): Promise<void>
  seek(positionSeconds: number): Promise<void>
  stop(): Promise<void>
  disconnect(): Promise<void>
  dispose(): Promise<void>
}
