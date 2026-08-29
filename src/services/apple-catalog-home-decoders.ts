import type {
  AppleCatalogPlaylist,
  AppleCatalogStation,
  AppleHomeSection,
} from "../core/types"
import { asRecord, isDisplayString, isResourceId } from "./apple-catalog-decode-helpers"
import { requireCatalogCollection } from "./apple-catalog-decoders"
import { AppleCatalogError } from "./apple-catalog-error"
import { decodeCatalogPlaylist } from "./apple-catalog-playlist-decoders"
import { decodeStation } from "./apple-catalog-station-decoders"

export function decodeHomeSections(value: unknown): AppleHomeSection[] {
  const root = requireCatalogCollection(value)
  const sections: AppleHomeSection[] = []
  const knownIds = new Set<string>()
  for (const entry of root.data) {
    const recommendation = asRecord(entry)
    const attributes = recommendation && asRecord(recommendation.attributes)
    const title = attributes && asRecord(attributes.title)
    const relationships = recommendation && asRecord(recommendation.relationships)
    const contents = relationships && asRecord(relationships.contents)
    if (
      !recommendation || recommendation.type !== "personal-recommendation" ||
      !isResourceId(recommendation.id) || !title ||
      !isDisplayString(title.stringForDisplay, 200) ||
      !contents || !Array.isArray(contents.data)
    ) throw new AppleCatalogError("invalid_response")
    const items: Array<AppleCatalogPlaylist | AppleCatalogStation> = []
    for (const content of contents.data) {
      const resource = asRecord(content)
      if (resource?.type !== "playlists" && resource?.type !== "stations") continue
      const item = resource.type === "playlists"
        ? decodeCatalogPlaylist(resource)
        : decodeStation(resource)
      if (!item) throw new AppleCatalogError("invalid_response")
      const key = `${item.apple.resourceType}:${item.apple.resourceId}`
      if (!knownIds.has(key)) {
        knownIds.add(key)
        items.push(item)
      }
    }
    if (items.length > 0) {
      sections.push({ id: recommendation.id, title: title.stringForDisplay, items })
    }
  }
  return sections
}
