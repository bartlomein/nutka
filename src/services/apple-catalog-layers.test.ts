import { expect, test } from "bun:test"

import { decodeHomeSections } from "./apple-catalog-home-decoders"
import { decodeSong } from "./apple-catalog-media-decoders"
import {
  APPLE_API_ORIGIN,
  AppleCatalogPagination,
  collectionUrl,
} from "./apple-catalog-pagination"
import { decodeCatalogPlaylist } from "./apple-catalog-playlist-decoders"
import { decodeStation } from "./apple-catalog-station-decoders"
import { AppleCatalogTransport } from "./apple-catalog-transport"

test("catalog transport owns bounded JSON response handling", async () => {
  const responses = [
    new Response("not json", { headers: { "content-type": "text/plain" } }),
    new Response("{}", {
      headers: {
        "content-type": "application/json",
        "content-length": String(512 * 1024 + 1),
      },
    }),
  ]
  const transport = new AppleCatalogTransport("http://127.0.0.1", {
    fetch: async () => responses.shift()!,
  })
  const url = new URL("/v1/catalog/us/songs", APPLE_API_ORIGIN)

  await expect(transport.requestJson(url, "developer", new AbortController().signal))
    .rejects.toMatchObject({ code: "invalid_response" })
  await expect(transport.requestJson(url, "developer", new AbortController().signal))
    .rejects.toMatchObject({ code: "invalid_response" })
})

test("catalog transport owns personalized rating HTTP semantics", async () => {
  const requests: Array<{ method: string; body: string | null }> = []
  const transport = new AppleCatalogTransport("http://127.0.0.1", {
    fetch: async (_input, init) => {
      requests.push({ method: init?.method ?? "GET", body: init?.body?.toString() ?? null })
      return requests.length === 1
        ? new Response(null, { status: 404 })
        : new Response(null, { status: 204 })
    },
  })
  const signal = new AbortController().signal
  const url = new URL("/v1/me/ratings/songs/song-1", APPLE_API_ORIGIN)

  expect(await transport.requestOptionalJson(url, "developer", "user", signal)).toBeNull()
  await transport.requestRatingUpdate(url, "PUT", "developer", "user", signal, 1)
  expect(requests).toEqual([
    { method: "GET", body: null },
    {
      method: "PUT",
      body: JSON.stringify({ type: "rating", attributes: { value: 1 } }),
    },
  ])
})

test("catalog pagination collects unique relationship resources and rejects cursor loops", async () => {
  const path = "/v1/catalog/us/artists/artist-1/view/top-songs"
  const pagination = new AppleCatalogPagination("/v1/catalog/us/search", 25)
  const repeatedCursor = collectionUrl(path, 10).toString()
  let requests = 0

  await expect(pagination.collectPages({
    initialItems: [{ id: "song-1" }],
    initialUrl: new URL(repeatedCursor),
    expectedPath: path,
    request: async () => {
      requests++
      return { data: [{ id: "song-1" }, { id: "song-2" }], next: repeatedCursor }
    },
    decode: (value) => (value as { data: Array<{ id: string }> }).data,
  })).rejects.toMatchObject({ code: "invalid_response" })
  expect(requests).toBe(1)
})

test("catalog media, station, playlist, and home decoders are independently usable", () => {
  const song = decodeSong({
    id: "song-1",
    type: "songs",
    attributes: {
      name: "Song",
      artistName: "Artist",
      albumName: "Album",
      durationInMillis: 1_000,
    },
  })
  const stationResource = {
    id: "station-1",
    type: "stations",
    attributes: {
      name: "Station",
      isLive: true,
      artwork: { url: "https://img/{w}x{h}.jpg", width: 100, height: 100 },
    },
  }
  const station = decodeStation(stationResource)
  const playlistResource = {
    id: "playlist-1",
    type: "playlists",
    attributes: { name: "Playlist", curatorName: "Curator" },
  }
  const playlist = decodeCatalogPlaylist(playlistResource)

  expect(song?.apple.resourceId).toBe("song-1")
  expect(station?.apple.resourceId).toBe("station-1")
  expect(playlist?.apple.resourceId).toBe("playlist-1")
  expect(decodeHomeSections({
    data: [{
      id: "recommendation-1",
      type: "personal-recommendation",
      attributes: { title: { stringForDisplay: "For You" } },
      relationships: { contents: { data: [playlistResource, stationResource] } },
    }],
  })[0]?.items).toHaveLength(2)
})
