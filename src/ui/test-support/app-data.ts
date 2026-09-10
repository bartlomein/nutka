import type {
  AppleArtistSectionName,
  AppleArtistSectionPage,
  AppleCatalogAlbum,
  AppleCatalogAlbumSummary,
  AppleCatalogArtist,
  AppleCatalogStation,
  AppleCatalogPlaylist,
  AppleCatalogTrack,
  AppleHomeSection,
  AppleLibraryPlaylist,
  AppleSongContext,
  Track,
} from "../../core/types"

export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}
export const testTracks = [
  {
    id: "track-a",
    title: "First Track",
    artist: "Artist One",
    album: "First Album",
    durationSeconds: 180,
  },
  {
    id: "track-b",
    title: "Second Track",
    artist: "Artist Two",
    album: "Second Album",
    durationSeconds: 240,
  },
  {
    id: "track-c",
    title: "Third Track",
    artist: "Artist Three",
    album: "Third Album",
    durationSeconds: 300,
  },
  {
    id: "track-d",
    title: "Fourth Track",
    artist: "Artist Four",
    album: "Fourth Album",
    durationSeconds: 360,
  },
] as const satisfies readonly Track[]

export const catalogTracks = testTracks.slice(0, 2).map((track, index) => ({
  ...track,
  id: `apple:song:${index + 1}`,
  audioQuality: { format: "lossless" as const, source: "catalog" as const },
  apple: {
    resourceId: String(index + 1),
    resourceType: "songs" as const,
    playParams: { id: String(index + 1), kind: "song" as const },
    audioTraits: ["lossless" as const],
    ...(index === 0
      ? { details: {
          releaseDate: "2026-02-13",
          genreNames: ["Alternative", "Electronic"],
          trackNumber: 3,
          discNumber: 1,
          composerName: "A Composer",
          contentRating: "explicit" as const,
          hasLyrics: true,
          isAppleDigitalMaster: true,
          editorialNotes: "A focused track note.",
        } }
      : {}),
  },
})) satisfies readonly AppleCatalogTrack[]

export const testAlbum: AppleCatalogAlbum = {
  id: "apple:album:album-1",
  title: "The Album",
  artist: "The Artist",
  tracks: catalogTracks,
  apple: {
    resourceId: "album-1",
    resourceType: "albums",
    details: {
      releaseDate: "2026-02-13",
      genreNames: ["Alternative"],
      trackCount: 2,
      recordLabel: "Example Records",
      copyright: "2026 Example Records",
      contentRating: "clean",
      editorialNotes: "A focused album note.",
      isCompilation: false,
      isSingle: false,
    },
  },
}

export const browseAlbum: AppleCatalogAlbumSummary = {
  id: testAlbum.id,
  title: testAlbum.title,
  artist: testAlbum.artist,
  apple: testAlbum.apple,
}

export const testArtists = [
  {
    id: "apple:artist:artist-1",
    name: "The Artist",
    apple: {
      resourceId: "artist-1",
      resourceType: "artists" as const,
      details: { genreNames: ["Alternative"] },
    },
  },
  {
    id: "apple:artist:artist-2",
    name: "Guest Artist",
    apple: {
      resourceId: "artist-2",
      resourceType: "artists" as const,
      details: { genreNames: ["Electronic"] },
    },
  },
] satisfies readonly AppleCatalogArtist[]

export const testSongContext: AppleSongContext = {
  albums: [browseAlbum],
  artists: testArtists,
}

export function station(id: string, title: string, isLive = false): AppleCatalogStation {
  return {
    id: `apple:station:${id}`,
    title,
    isLive,
    apple: {
      resourceId: id,
      resourceType: "stations",
      playParams: { id, kind: "radioStation" },
      artwork: { url: "https://example.test/artwork", width: 100, height: 100 },
    },
  }
}

export function artistSectionPage(
  section: AppleArtistSectionName,
  nextCursor: string | null = null,
): AppleArtistSectionPage {
  switch (section) {
    case "top-songs":
      return { section, items: catalogTracks, nextCursor }
    case "latest-release":
    case "full-albums":
      return { section, items: [browseAlbum], nextCursor }
    case "singles":
      return { section, items: [], nextCursor }
    case "similar-artists":
      return { section, items: [testArtists[1]!], nextCursor }
  }
}

export const recommendedPlaylists = [
  {
    id: "apple:playlist:pl.mix-1",
    title: "Favorites Mix",
    curator: "Apple Music for Me",
    description: "Songs selected for you.",
    apple: {
      resourceId: "pl.mix-1",
      resourceType: "playlists" as const,
      details: {
        lastModifiedDate: "2026-08-25T12:00:00Z",
        playlistType: "personal-mix",
        isChart: false,
      },
    },
  },
  {
    id: "apple:playlist:pl.chill-1",
    title: "Chill Mix",
    curator: "Apple Music for Me",
    apple: { resourceId: "pl.chill-1", resourceType: "playlists" as const },
  },
] satisfies readonly AppleCatalogPlaylist[]

export const homeSections = [
  {
    id: "recommendation:made-for-you",
    title: "Made for You",
    items: [recommendedPlaylists[0]!],
  },
  {
    id: "recommendation:more-like-chill",
    title: "More Like Chill",
    items: [recommendedPlaylists[1]!],
  },
] satisfies readonly AppleHomeSection[]

export const savedPlaylists = [
  {
    id: "apple:library-playlist:p.favorites",
    title: "Favorites Mix",
    curator: "Your Library",
    apple: {
      resourceId: "p.favorites",
      resourceType: "library-playlists" as const,
      globalId: "pl.mix-1",
      details: {
        dateAdded: "2026-08-20T09:30:00Z",
        canEdit: true,
        isPublic: false,
        hasCatalog: true,
      },
    },
  },
  {
    id: "apple:library-playlist:p.coding",
    title: "Coding",
    curator: "Your Library",
    apple: {
      resourceId: "p.coding",
      resourceType: "library-playlists" as const,
    },
  },
] satisfies readonly AppleLibraryPlaylist[]
