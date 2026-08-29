import type {
  AppleCatalogPlaylist,
  AppleCatalogTrack,
  AppleLibraryPlaylist,
} from "../core/types"
import {
  asRecord,
  decodeArtwork,
  decodeDescription,
  decodePlaylistDetails,
  isDisplayString,
  isResourceId,
} from "./apple-catalog-decode-helpers"
import { requireCatalogCollection } from "./apple-catalog-decoders"
import { AppleCatalogError } from "./apple-catalog-error"
import { decodeSong } from "./apple-catalog-media-decoders"

export function decodeCatalogPlaylist(value: unknown): AppleCatalogPlaylist | null {
  const resource = asRecord(value)
  const attributes = resource && asRecord(resource.attributes)
  if (
    !resource || resource.type !== "playlists" || !isResourceId(resource.id) || !attributes ||
    !isDisplayString(attributes.name, 300)
  ) return null
  const curator = isDisplayString(attributes.curatorName, 300)
    ? attributes.curatorName
    : "Apple Music"
  const description = decodeDescription(attributes.description)
  const artwork = decodeArtwork(attributes.artwork)
  const details = decodePlaylistDetails(attributes, false)
  return {
    id: `apple:playlist:${resource.id}`,
    title: attributes.name,
    curator,
    ...(description ? { description } : {}),
    apple: {
      resourceId: resource.id,
      resourceType: "playlists",
      ...(artwork ? { artwork } : {}),
      ...(details ? { details } : {}),
    },
  }
}

export function decodeLibraryPlaylist(value: unknown): AppleLibraryPlaylist | null {
  const resource = asRecord(value)
  const attributes = resource && asRecord(resource.attributes)
  if (
    !resource || resource.type !== "library-playlists" || !isResourceId(resource.id) ||
    !attributes || !isDisplayString(attributes.name, 300)
  ) return null
  const playParams = asRecord(attributes.playParams)
  const globalId = playParams && isResourceId(playParams.globalId) ? playParams.globalId : undefined
  const description = decodeDescription(attributes.description)
  const artwork = decodeArtwork(attributes.artwork)
  const details = decodePlaylistDetails(attributes, true)
  return {
    id: `apple:library-playlist:${resource.id}`,
    title: attributes.name,
    curator: "Your Library",
    ...(description ? { description } : {}),
    apple: {
      resourceId: resource.id,
      resourceType: "library-playlists",
      ...(globalId ? { globalId } : {}),
      ...(artwork ? { artwork } : {}),
      ...(details ? { details } : {}),
    },
  }
}

export function decodePlaylistTracks(value: unknown): AppleCatalogTrack[] {
  const tracks: AppleCatalogTrack[] = []
  const knownIds = new Set<string>()
  for (const entry of requireCatalogCollection(value).data) {
    const resource = asRecord(entry)
    if (resource?.type === "music-videos" || resource?.type === "library-music-videos") continue
    const track = resource?.type === "library-songs" ? decodeLibrarySong(resource) : decodeSong(resource)
    if (track && !knownIds.has(track.id)) {
      knownIds.add(track.id)
      tracks.push(track)
    } else if (resource?.type !== "library-songs") {
      throw new AppleCatalogError("invalid_response")
    }
  }
  return tracks
}

function decodeLibrarySong(resource: Record<string, unknown>): AppleCatalogTrack | null {
  const attributes = asRecord(resource.attributes)
  const playParams = attributes && asRecord(attributes.playParams)
  if (
    resource.type !== "library-songs" || !isResourceId(resource.id) || !attributes ||
    !playParams || !isResourceId(playParams.catalogId)
  ) return null
  return decodeSong({
    ...resource,
    id: playParams.catalogId,
    type: "songs",
    attributes: {
      ...attributes,
      playParams: { id: playParams.catalogId, kind: "song" },
    },
  })
}
