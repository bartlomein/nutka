import type {
  AppleCatalogStation,
  AppleCatalogStationGenre,
  SearchPage,
} from "../core/types"
import {
  asRecord,
  decodeArtwork,
  decodeDescription,
  isDisplayString,
  isResourceId,
  optionalDisplayString,
} from "./apple-catalog-decode-helpers"
import {
  decodeCatalogCollection,
  requireCatalogCollection,
} from "./apple-catalog-decoders"
import { AppleCatalogError } from "./apple-catalog-error"

export function decodeStationPage(
  value: unknown,
  nextCursor: string | null,
): SearchPage<AppleCatalogStation> {
  return { items: decodeCatalogCollection(value, decodeStation), nextCursor }
}

export function decodeSingleStation(value: unknown): AppleCatalogStation {
  const data = requireCatalogCollection(value).data
  if (data.length !== 1) throw new AppleCatalogError("invalid_response")
  const station = decodeStation(data[0])
  if (!station) throw new AppleCatalogError("invalid_response")
  return station
}

export function decodeStation(value: unknown): AppleCatalogStation | null {
  const resource = asRecord(value)
  const attributes = resource && asRecord(resource.attributes)
  if (
    !resource || resource.type !== "stations" || !isResourceId(resource.id) || !attributes ||
    !isDisplayString(attributes.name, 300) || typeof attributes.isLive !== "boolean"
  ) return null
  const playParamsValue = attributes.playParams
  const playParams = asRecord(playParamsValue)
  const artwork = decodeArtwork(attributes.artwork)
  if (
    !artwork ||
    (playParamsValue !== undefined && (
      !playParams || playParams.id !== resource.id || playParams.kind !== "radioStation"
    ))
  ) return null
  const subtitle = optionalDisplayString(attributes.stationProviderName, 300)
  const description = decodeDescription(attributes.editorialNotes)
  const externalLiveStream = attributes.isLive &&
    playParams?.format === "stream" && playParams.hasDrm === false &&
    subtitle === undefined && attributes.streamingRadioSubType === undefined
  return {
    id: `apple:station:${resource.id}`,
    title: attributes.name,
    ...(subtitle ? { subtitle } : {}),
    ...(description ? { description } : {}),
    isLive: attributes.isLive,
    apple: {
      resourceId: resource.id,
      resourceType: "stations",
      ...(playParams ? { playParams: { id: resource.id, kind: "radioStation" as const } } : {}),
      ...(externalLiveStream ? { externalLiveStream: true as const } : {}),
      artwork,
    },
  }
}

export function decodeStationGenre(value: unknown): AppleCatalogStationGenre | null {
  const resource = asRecord(value)
  const attributes = resource && asRecord(resource.attributes)
  if (
    !resource || resource.type !== "station-genres" || !isResourceId(resource.id) ||
    !attributes || !isDisplayString(attributes.name, 300)
  ) return null
  return {
    id: `apple:station-genre:${resource.id}`,
    name: attributes.name,
    apple: { resourceId: resource.id, resourceType: "station-genres" },
  }
}
