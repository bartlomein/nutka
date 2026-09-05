import type { AppleLibraryAlbum, AppleLibraryArtist, AppleLibrarySong } from "../core/types"
import { asRecord, isDisplayString, isResourceId } from "./apple-catalog-decode-helpers"
import { decodeSong } from "./apple-catalog-media-decoders"
import { decodeCatalogCollection, requireCatalogCollection } from "./apple-catalog-decoders"

export function decodeLibraryAlbumTracks(value: unknown): AppleLibrarySong[] {
  const collection = requireCatalogCollection(value)
  return decodeCatalogCollection({
    data: collection.data.filter((item) => asRecord(item)?.type !== "library-music-videos"),
  }, decodeLibrarySong)
}

export function decodeLibrarySong(value: unknown): AppleLibrarySong | null {
  const resource = asRecord(value)
  const attributes = resource && asRecord(resource.attributes)
  if (!resource || resource.type !== "library-songs" || !isResourceId(resource.id) ||
    !attributes || !isDisplayString(attributes.name, 300) ||
    !isDisplayString(attributes.artistName, 500) || !isDisplayString(attributes.albumName, 500) ||
    typeof attributes.durationInMillis !== "number" ||
    !Number.isFinite(attributes.durationInMillis) || attributes.durationInMillis < 0) return null
  const params = asRecord(attributes.playParams)
  const catalogId = params && isResourceId(params.catalogId) ? params.catalogId : null
  const playback = catalogId && params?.kind === "song"
    ? decodeSong({
        id: catalogId,
        type: "songs",
        attributes: { ...attributes, playParams: { id: catalogId, kind: "song" } },
      })
    : null
  return {
    kind: "song",
    id: `apple:library-song:${resource.id}`,
    resourceId: resource.id,
    title: attributes.name,
    artist: attributes.artistName,
    album: attributes.albumName,
    durationSeconds: attributes.durationInMillis / 1000,
    ...(playback ? { playback } : {}),
  }
}

export function decodeLibraryAlbum(value: unknown): AppleLibraryAlbum | null {
  const resource = asRecord(value)
  const attributes = resource && asRecord(resource.attributes)
  if (!resource || resource.type !== "library-albums" || !isResourceId(resource.id) ||
    !attributes || !isDisplayString(attributes.name, 300) ||
    !isDisplayString(attributes.artistName, 500)) return null
  return {
    kind: "album", id: `apple:library-album:${resource.id}`, resourceId: resource.id,
    title: attributes.name, artist: attributes.artistName,
  }
}

export function decodeLibraryArtist(value: unknown): AppleLibraryArtist | null {
  const resource = asRecord(value)
  const attributes = resource && asRecord(resource.attributes)
  if (!resource || resource.type !== "library-artists" || !isResourceId(resource.id) ||
    !attributes || !isDisplayString(attributes.name, 500)) return null
  return {
    kind: "artist", id: `apple:library-artist:${resource.id}`, resourceId: resource.id,
    name: attributes.name,
  }
}
