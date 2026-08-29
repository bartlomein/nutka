import type {
  AppleArtwork,
  AppleContentRating,
  ApplePlaylistDetails,
} from "../core/types"

export const MAX_AUDIO_TRAITS = 16
export const MAX_GENRES = 24

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

export function isDisplayString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
}

export function isResourceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(value)
}

export function decodeDescription(value: unknown): string | undefined {
  const description = asRecord(value)
  if (!description) return undefined
  if (isDisplayString(description.standard, 2_000)) return description.standard
  return isDisplayString(description.short, 500) ? description.short : undefined
}

export function decodeArtwork(value: unknown): AppleArtwork | undefined {
  const artwork = asRecord(value)
  if (!artwork || !isNonEmptyString(artwork.url)) return undefined
  const width = decodeDimension(artwork.width)
  const height = decodeDimension(artwork.height)
  if (width === undefined || height === undefined) return undefined
  return { url: artwork.url, width, height }
}

export function optionalDisplayString(
  value: unknown,
  maxLength: number,
): string | undefined {
  return isDisplayString(value, maxLength) ? value : undefined
}

export function decodeDisplayStrings(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_GENRES) return undefined
  if (value.some((item) => !isDisplayString(item, 100))) return undefined
  return value as string[]
}

export function decodePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined
}

export function decodeBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

export function decodeContentRating(value: unknown): AppleContentRating | undefined {
  return value === "clean" || value === "explicit" ? value : undefined
}

export function populated<T extends object>(value: T): T | undefined {
  return Object.keys(value).length > 0 ? value : undefined
}

export function decodePlaylistDetails(
  attributes: Record<string, unknown>,
  library: boolean,
): ApplePlaylistDetails | undefined {
  const lastModifiedDate = optionalDisplayString(attributes.lastModifiedDate, 64)
  const dateAdded = optionalDisplayString(attributes.dateAdded, 64)
  const playlistType = optionalDisplayString(attributes.playlistType, 64)
  const isChart = decodeBoolean(attributes.isChart)
  const canEdit = decodeBoolean(attributes.canEdit)
  const isPublic = decodeBoolean(attributes.isPublic)
  const hasCatalog = decodeBoolean(attributes.hasCatalog)
  return populated({
    ...(!library && lastModifiedDate ? { lastModifiedDate } : {}),
    ...(library && dateAdded ? { dateAdded } : {}),
    ...(!library && playlistType ? { playlistType } : {}),
    ...(!library && isChart !== undefined ? { isChart } : {}),
    ...(library && canEdit !== undefined ? { canEdit } : {}),
    ...(library && isPublic !== undefined ? { isPublic } : {}),
    ...(library && hasCatalog !== undefined ? { hasCatalog } : {}),
  })
}

function decodeDimension(value: unknown): number | null | undefined {
  if (value === null) return null
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined
}
