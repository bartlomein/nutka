import type { Fetch } from "../token-service"

export const serviceUrl = "http://127.0.0.1:8787"
export const tokenResponse = {
  token: "developer-secret",
  expiresAt: "2030-01-01T00:00:00.000Z",
  mode: "apple",
} as const

export function catalogResponse(next?: string): Response {
  return Response.json({
    results: {
      songs: {
        data: [
          {
            id: "12345",
            type: "songs",
            href: "/v1/catalog/us/songs/12345",
            attributes: {
              name: "A Song",
              artistName: "An Artist",
              albumName: "An Album",
              durationInMillis: 123456,
              releaseDate: "2026-02-13",
              genreNames: ["Alternative", "Music"],
              trackNumber: 3,
              discNumber: 1,
              composerName: "A Composer",
              contentRating: "explicit",
              hasLyrics: true,
              isAppleDigitalMaster: false,
              editorialNotes: { short: "A concise editorial note." },
              audioTraits: ["lossy-stereo", "lossless", "spatial", "future-trait"],
              artwork: { url: "https://img/{w}x{h}.jpg", width: 3000, height: 3000 },
              playParams: { id: "12345", kind: "song", ignored: true },
              ignored: true,
            },
          },
        ],
        ...(next === undefined ? {} : { next }),
      },
    },
  })
}

export function songWithAlbumResponse(): Response {
  return Response.json({
    data: [{
      id: "12345",
      type: "songs",
      relationships: {
        albums: { data: [{ id: "album-1", type: "albums" }] },
      },
    }],
  })
}

export function albumResponse(trackNext?: string, includeMusicVideo = false): Response {
  return Response.json({
    data: [{
      id: "album-1",
      type: "albums",
      attributes: {
        name: "An Album",
        artistName: "An Artist",
        releaseDate: "2026-02-13",
        genreNames: ["Alternative"],
        trackCount: 1,
        recordLabel: "Example Records",
        copyright: "2026 Example Records",
        contentRating: "clean",
        editorialNotes: { standard: "An album editorial note." },
        isCompilation: false,
        isSingle: true,
        artwork: { url: "https://album/{w}x{h}.jpg", width: 1200, height: 1200 },
      },
      relationships: {
        tracks: {
          data: [
            ...(includeMusicVideo
              ? [{ id: "video-1", type: "music-videos", attributes: { name: "A Video" } }]
              : []),
            {
              id: "12345",
              type: "songs",
              attributes: {
                name: "A Song",
                artistName: "An Artist",
                albumName: "An Album",
                durationInMillis: 123456,
                audioTraits: ["lossless", "hi-res-lossless"],
                playParams: { id: "12345", kind: "song" },
              },
            },
          ],
          ...(trackNext ? { next: trackNext } : {}),
        },
      },
    }],
  })
}

export function albumSummaryResource(id = "album-1", name = "An Album") {
  return {
    id,
    type: "albums",
    attributes: {
      name,
      artistName: "An Artist",
      releaseDate: "2026-02-13",
      genreNames: ["Alternative"],
      trackCount: 10,
      isSingle: false,
    },
  }
}

export function artistResource(id: string, name: string) {
  return {
    id,
    type: "artists",
    attributes: {
      name,
      genreNames: ["Jazz"],
      editorialNotes: { short: `${name} editorial note.` },
      artwork: { url: `https://artist/${id}/{w}x{h}.jpg`, width: 1000, height: 1000 },
    },
  }
}

export function songResource(id = "12345", name = "A Song") {
  return {
    id,
    type: "songs",
    attributes: {
      name,
      artistName: "An Artist",
      albumName: "An Album",
      durationInMillis: 123456,
      playParams: { id, kind: "song" },
    },
  }
}

export function recommendationsResponse(next?: string): Response {
  return Response.json({
    data: [{
      id: "recommendation-1",
      type: "personal-recommendation",
      attributes: { title: { stringForDisplay: "Made for You" } },
      relationships: {
        contents: {
          data: [{
            id: "pl.mix-1",
            type: "playlists",
            attributes: {
              name: "Favorites Mix",
              curatorName: "Apple Music for Me",
              description: { standard: "Songs selected for you." },
              lastModifiedDate: "2026-08-25T12:00:00Z",
              playlistType: "personal-mix",
              isChart: false,
            },
          }],
        },
      },
    }],
    ...(next ? { next } : {}),
  })
}

export function playlistResource(id: string, name: string) {
  return {
    id,
    type: "playlists",
    attributes: { name, curatorName: "Apple Music" },
  }
}

export function recommendationResource(id: string, title: string, contents: unknown[]) {
  return {
    id,
    type: "personal-recommendation",
    attributes: { title: { stringForDisplay: title } },
    relationships: { contents: { data: contents } },
  }
}

export function libraryPlaylistsResponse(next?: string): Response {
  return Response.json({
    data: [{
      id: "p.saved-1",
      type: "library-playlists",
      attributes: {
        name: "Favorites Mix",
        description: { standard: "Saved personalized mix." },
        dateAdded: "2026-08-20T09:30:00Z",
        canEdit: true,
        isPublic: false,
        hasCatalog: true,
        playParams: {
          id: "p.saved-1",
          kind: "playlist",
          isLibrary: true,
          globalId: "pl.mix-1",
        },
      },
    }],
    ...(next ? { next } : {}),
  })
}

export function catalogPlaylistTracksResponse(): Response {
  return Response.json({
    data: [{
      id: "12345",
      type: "songs",
      attributes: {
        name: "A Song",
        artistName: "An Artist",
        albumName: "An Album",
        durationInMillis: 123456,
        playParams: { id: "12345", kind: "song" },
      },
    }],
  })
}

export function libraryPlaylistTracksResponse(): Response {
  return Response.json({
    data: [{
      id: "i.library-1",
      type: "library-songs",
      attributes: {
        name: "A Saved Song",
        artistName: "An Artist",
        albumName: "A Saved Album",
        durationInMillis: 180000,
        playParams: {
          id: "i.library-1",
          kind: "song",
          isLibrary: true,
          catalogId: "67890",
        },
      },
    }],
  })
}

export function stationResource(id = "ra.1", name = "Apple Music 1", isLive = true) {
  return {
    id,
    type: "stations",
    attributes: {
      name,
      isLive,
      stationProviderName: "Apple Music",
      editorialNotes: { short: "The global music station." },
      artwork: { url: "https://radio/{w}x{h}.jpg", width: 1200, height: 1200 },
      playParams: { id, kind: "radioStation" },
    },
  }
}

export function stationGenreResource(id = "alternative", name = "Alternative") {
  return { id, type: "station-genres", attributes: { name } }
}

export function withCatalog(response: Response, requests: Array<{ url: string; init?: RequestInit }> = []): Fetch {
  return async (input, init) => {
    const url = String(input)
    requests.push({ url, init })
    return url.endsWith("/v1/apple/developer-token")
      ? Response.json(tokenResponse)
      : response
  }
}
