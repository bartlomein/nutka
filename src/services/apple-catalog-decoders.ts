import type { ApplePersonalRating, SearchPage } from "../core/types"
import { asRecord } from "./apple-catalog-decode-helpers"
import { AppleCatalogError } from "./apple-catalog-error"
import type { AppleCatalogPagination } from "./apple-catalog-pagination"

export function requireCatalogCollection(
  value: unknown,
): Record<string, unknown> & { data: unknown[] } {
  const root = asRecord(value)
  if (!root || !Array.isArray(root.data)) throw new AppleCatalogError("invalid_response")
  return root as Record<string, unknown> & { data: unknown[] }
}

export function decodeCatalogCollection<T>(
  value: unknown,
  decode: (entry: unknown) => T | null,
): T[] {
  const items = requireCatalogCollection(value).data.map(decode)
  if (items.some((item) => item === null)) {
    throw new AppleCatalogError("invalid_response")
  }
  return items as T[]
}

export function decodeCatalogSearchResponse<T>(
  value: unknown,
  resourceType: "songs" | "stations",
  term: string,
  decode: (value: unknown) => T | null,
  pagination: AppleCatalogPagination,
): SearchPage<T> {
  const root = asRecord(value)
  const results = root && asRecord(root.results)
  if (!results) throw new AppleCatalogError("invalid_response")
  if (results[resourceType] === undefined) return { items: [], nextCursor: null }

  const collection = asRecord(results[resourceType])
  if (!collection || !Array.isArray(collection.data)) {
    throw new AppleCatalogError("invalid_response")
  }
  let nextCursor: string | null = null
  if (collection.next !== undefined) {
    if (typeof collection.next !== "string") {
      throw new AppleCatalogError("invalid_response")
    }
    try {
      pagination.validateSearchCursor(collection.next, resourceType, term)
    } catch {
      throw new AppleCatalogError("invalid_response")
    }
    nextCursor = collection.next
  }
  const items = collection.data.map(decode)
  if (items.some((item) => item === null)) {
    throw new AppleCatalogError("invalid_response")
  }
  return { items: items as T[], nextCursor }
}

export function decodePersonalRating(
  value: unknown,
  resourceId: string,
): ApplePersonalRating | null {
  const data = requireCatalogCollection(value).data
  if (data.length === 0) return null
  if (data.length !== 1) throw new AppleCatalogError("invalid_response")
  const rating = asRecord(data[0])
  const attributes = rating && asRecord(rating.attributes)
  const ratingValue = attributes?.value
  if (
    rating?.id !== resourceId || rating.type !== "ratings" ||
    (ratingValue !== -1 && ratingValue !== 1)
  ) throw new AppleCatalogError("invalid_response")
  return ratingValue
}

export function validateCatalogQuery(query: string): string {
  if (typeof query !== "string") throw new AppleCatalogError("invalid_request")
  const term = query.trim()
  if (
    term.length === 0 || term.length > 200 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(term)
  ) throw new AppleCatalogError("invalid_request")
  return term
}
