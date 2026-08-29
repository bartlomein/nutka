import type {
  AppleAlbumDetails,
  AppleArtistDetails,
  AppleArtistSectionName,
  AppleArtistSectionPage,
  AppleAudioTrait,
  AppleCatalogAlbum,
  AppleCatalogAlbumSummary,
  AppleCatalogArtist,
  AppleCatalogTrack,
  AppleTrackDetails,
  AudioQuality,
} from "../core/types"
import {
  MAX_AUDIO_TRAITS,
  asRecord,
  decodeArtwork,
  decodeBoolean,
  decodeContentRating,
  decodeDescription,
  decodeDisplayStrings,
  decodePositiveInteger,
  isNonEmptyString,
  isDisplayString,
  isResourceId,
  optionalDisplayString,
  populated,
} from "./apple-catalog-decode-helpers"
import {
  decodeCatalogCollection,
  requireCatalogCollection,
} from "./apple-catalog-decoders"
import { AppleCatalogError } from "./apple-catalog-error"

const knownAudioTraits = new Set<AppleAudioTrait>([
  "atmos",
  "dolby-atmos",
  "dolby-audio",
  "hi-res-lossless",
  "lossless",
  "lossy-stereo",
  "spatial",
])

export function decodeSong(value: unknown): AppleCatalogTrack | null {
  const resource = asRecord(value)
  const attributes = resource && asRecord(resource.attributes)
  if (
    !resource || resource.type !== "songs" || !isResourceId(resource.id) || !attributes ||
    !isNonEmptyString(attributes.name) || !isNonEmptyString(attributes.artistName) ||
    !isNonEmptyString(attributes.albumName) ||
    typeof attributes.durationInMillis !== "number" ||
    !Number.isFinite(attributes.durationInMillis) || attributes.durationInMillis < 0
  ) return null

  const artwork = decodeArtwork(attributes.artwork)
  const playParams = decodePlayParams(attributes.playParams, resource.id)
  const audioTraits = decodeAudioTraits(attributes.audioTraits)
  const audioQuality = audioTraits && catalogAudioQuality(audioTraits)
  const details = decodeTrackDetails(attributes)
  return {
    id: `apple:song:${resource.id}`,
    title: attributes.name,
    artist: attributes.artistName,
    album: attributes.albumName,
    durationSeconds: attributes.durationInMillis / 1000,
    ...(audioQuality ? { audioQuality } : {}),
    apple: {
      resourceId: resource.id,
      resourceType: "songs",
      ...(playParams ? { playParams } : {}),
      ...(artwork ? { artwork } : {}),
      ...(audioTraits ? { audioTraits } : {}),
      ...(details ? { details } : {}),
    },
  }
}

export function decodeCatalogTracks(value: unknown): AppleCatalogTrack[] {
  const tracks: AppleCatalogTrack[] = []
  for (const entry of requireCatalogCollection(value).data) {
    const resource = asRecord(entry)
    if (resource?.type === "music-videos") continue
    const track = decodeSong(resource)
    if (!track) throw new AppleCatalogError("invalid_response")
    tracks.push(track)
  }
  return tracks
}

export function appendUniqueCatalogTracks(
  current: readonly AppleCatalogTrack[],
  additions: readonly AppleCatalogTrack[],
): readonly AppleCatalogTrack[] {
  const ids = new Set(current.map((track) => track.id))
  return [...current, ...additions.filter((track) => {
    if (ids.has(track.id)) return false
    ids.add(track.id)
    return true
  })]
}

export function decodeSingleResource(
  value: unknown,
  resourceType: "songs" | "albums" | "artists",
): Record<string, unknown> {
  const root = asRecord(value)
  if (!root || !Array.isArray(root.data) || root.data.length !== 1) {
    throw new AppleCatalogError("invalid_response")
  }
  const resource = asRecord(root.data[0])
  if (!resource || resource.type !== resourceType || !isResourceId(resource.id)) {
    throw new AppleCatalogError("invalid_response")
  }
  return resource
}

export function decodeRelationshipId(
  resource: Record<string, unknown>,
  relationshipName: string,
  resourceType: "albums",
): string | null {
  const relationships = asRecord(resource.relationships)
  const relationship = relationships && asRecord(relationships[relationshipName])
  if (!relationship || !Array.isArray(relationship.data) || relationship.data.length < 1) {
    return null
  }
  const related = asRecord(relationship.data[0])
  return related && related.type === resourceType && isResourceId(related.id)
    ? related.id
    : null
}

export function decodeAlbumSummary(value: unknown): AppleCatalogAlbumSummary | null {
  const resource = asRecord(value)
  const attributes = resource && asRecord(resource.attributes)
  if (
    !resource || resource.type !== "albums" || !isResourceId(resource.id) || !attributes ||
    !isDisplayString(attributes.name, 300) || !isDisplayString(attributes.artistName, 500)
  ) return null
  const artwork = decodeArtwork(attributes.artwork)
  const details = decodeAlbumDetails(attributes)
  return {
    id: `apple:album:${resource.id}`,
    title: attributes.name,
    artist: attributes.artistName,
    apple: {
      resourceId: resource.id,
      resourceType: "albums",
      ...(artwork ? { artwork } : {}),
      ...(details ? { details } : {}),
    },
  }
}

export function decodeAlbum(resource: Record<string, unknown>): AppleCatalogAlbum {
  const summary = decodeAlbumSummary(resource)
  const attributes = asRecord(resource.attributes)
  const relationships = asRecord(resource.relationships)
  const tracks = relationships && asRecord(relationships.tracks)
  if (!summary || !attributes || !tracks || !Array.isArray(tracks.data)) {
    throw new AppleCatalogError("invalid_response")
  }
  return { ...summary, tracks: decodeCatalogTracks(tracks) }
}

export function decodeArtist(value: unknown): AppleCatalogArtist | null {
  const resource = asRecord(value)
  const attributes = resource && asRecord(resource.attributes)
  if (
    !resource || resource.type !== "artists" || !isResourceId(resource.id) || !attributes ||
    !isDisplayString(attributes.name, 500)
  ) return null
  const artwork = decodeArtwork(attributes.artwork)
  const details = decodeArtistDetails(attributes)
  return {
    id: `apple:artist:${resource.id}`,
    name: attributes.name,
    apple: {
      resourceId: resource.id,
      resourceType: "artists",
      ...(artwork ? { artwork } : {}),
      ...(details ? { details } : {}),
    },
  }
}

export function decodeArtistSectionPage(
  value: unknown,
  section: AppleArtistSectionName,
  nextCursor: string | null,
): AppleArtistSectionPage {
  switch (section) {
    case "top-songs":
      return { section, items: decodeCatalogCollection(value, decodeSong), nextCursor }
    case "latest-release":
    case "full-albums":
    case "singles":
      return { section, items: decodeCatalogCollection(value, decodeAlbumSummary), nextCursor }
    case "similar-artists":
      return { section, items: decodeCatalogCollection(value, decodeArtist), nextCursor }
  }
}

function decodeTrackDetails(attributes: Record<string, unknown>): AppleTrackDetails | undefined {
  const releaseDate = optionalDisplayString(attributes.releaseDate, 64)
  const genreNames = decodeDisplayStrings(attributes.genreNames)
  const trackNumber = decodePositiveInteger(attributes.trackNumber)
  const discNumber = decodePositiveInteger(attributes.discNumber)
  const composerName = optionalDisplayString(attributes.composerName, 500)
  const contentRating = decodeContentRating(attributes.contentRating)
  const editorialNotes = decodeDescription(attributes.editorialNotes)
  const hasLyrics = decodeBoolean(attributes.hasLyrics)
  const isAppleDigitalMaster = decodeBoolean(attributes.isAppleDigitalMaster)
  return populated({
    ...(releaseDate ? { releaseDate } : {}),
    ...(genreNames ? { genreNames } : {}),
    ...(trackNumber ? { trackNumber } : {}),
    ...(discNumber ? { discNumber } : {}),
    ...(composerName ? { composerName } : {}),
    ...(contentRating ? { contentRating } : {}),
    ...(editorialNotes ? { editorialNotes } : {}),
    ...(hasLyrics !== undefined ? { hasLyrics } : {}),
    ...(isAppleDigitalMaster !== undefined ? { isAppleDigitalMaster } : {}),
  })
}

function decodeAlbumDetails(attributes: Record<string, unknown>): AppleAlbumDetails | undefined {
  const releaseDate = optionalDisplayString(attributes.releaseDate, 64)
  const genreNames = decodeDisplayStrings(attributes.genreNames)
  const trackCount = decodePositiveInteger(attributes.trackCount)
  const recordLabel = optionalDisplayString(attributes.recordLabel, 500)
  const copyright = optionalDisplayString(attributes.copyright, 1_000)
  const contentRating = decodeContentRating(attributes.contentRating)
  const editorialNotes = decodeDescription(attributes.editorialNotes)
  const isCompilation = decodeBoolean(attributes.isCompilation)
  const isSingle = decodeBoolean(attributes.isSingle)
  return populated({
    ...(releaseDate ? { releaseDate } : {}),
    ...(genreNames ? { genreNames } : {}),
    ...(trackCount ? { trackCount } : {}),
    ...(recordLabel ? { recordLabel } : {}),
    ...(copyright ? { copyright } : {}),
    ...(contentRating ? { contentRating } : {}),
    ...(editorialNotes ? { editorialNotes } : {}),
    ...(isCompilation !== undefined ? { isCompilation } : {}),
    ...(isSingle !== undefined ? { isSingle } : {}),
  })
}

function decodeArtistDetails(attributes: Record<string, unknown>): AppleArtistDetails | undefined {
  const genreNames = decodeDisplayStrings(attributes.genreNames)
  const editorialNotes = decodeDescription(attributes.editorialNotes)
  return populated({
    ...(genreNames ? { genreNames } : {}),
    ...(editorialNotes ? { editorialNotes } : {}),
  })
}

function decodePlayParams(
  value: unknown,
  resourceId: string,
): AppleCatalogTrack["apple"]["playParams"] {
  const playParams = asRecord(value)
  return playParams && playParams.id === resourceId && playParams.kind === "song"
    ? { id: playParams.id, kind: playParams.kind }
    : undefined
}

function decodeAudioTraits(value: unknown): readonly AppleAudioTrait[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > MAX_AUDIO_TRAITS) return undefined
  if (value.some((trait) => typeof trait !== "string" || trait.length > 64)) return undefined
  const traits = [...new Set(value.filter((trait): trait is AppleAudioTrait =>
    knownAudioTraits.has(trait as AppleAudioTrait)
  ))]
  return traits.length > 0 ? traits : undefined
}

function catalogAudioQuality(traits: readonly AppleAudioTrait[]): AudioQuality | undefined {
  if (traits.includes("atmos") || traits.includes("dolby-atmos")) {
    return { format: "dolby-atmos", source: "catalog" }
  }
  if (traits.includes("hi-res-lossless")) return { format: "hi-res-lossless", source: "catalog" }
  if (traits.includes("lossless")) return { format: "lossless", source: "catalog" }
  if (traits.includes("dolby-audio")) return { format: "dolby-audio", source: "catalog" }
  if (traits.includes("spatial")) return { format: "spatial-audio", source: "catalog" }
  if (traits.includes("lossy-stereo")) return { format: "stereo", source: "catalog" }
  return undefined
}
