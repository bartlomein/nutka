import { AppleCatalogError } from "./apple-catalog-error"

export const APPLE_API_ORIGIN = "https://api.music.apple.com"
const MAX_CURSOR_LENGTH = 8 * 1024
const MAX_RELATIONSHIP_PAGES = 50

interface CollectPagesOptions<T extends { id: string }> {
  initialItems?: readonly T[]
  initialUrl: URL | null
  expectedPath: string
  request: (url: URL) => Promise<unknown>
  decode: (value: unknown) => readonly T[]
}

export class AppleCatalogPagination {
  constructor(
    private readonly searchPath: string,
    private readonly limit: number,
  ) {}

  buildSearchUrl(term: string, resourceType: "songs" | "stations"): URL {
    const url = new URL(this.searchPath, APPLE_API_ORIGIN)
    url.search = new URLSearchParams({
      term,
      types: resourceType,
      limit: String(this.limit),
    }).toString()
    return url
  }

  validateSearchCursor(
    cursor: string,
    resourceType: "songs" | "stations",
    term: string,
  ): URL {
    const url = this.validateCursor(cursor, this.searchPath)
    const types = url.searchParams.getAll("types")
    const terms = url.searchParams.getAll("term")
    if (
      types.length !== 1 ||
      types[0] !== resourceType ||
      terms.length !== 1 ||
      terms[0] !== term
    ) throw new AppleCatalogError("invalid_request")
    return url
  }

  validateCursor(cursor: string, expectedPath: string): URL {
    if (cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH) {
      throw new AppleCatalogError("invalid_request")
    }
    let url: URL
    try {
      url = new URL(cursor, APPLE_API_ORIGIN)
    } catch {
      throw new AppleCatalogError("invalid_request")
    }
    if (
      url.origin !== APPLE_API_ORIGIN ||
      url.pathname !== expectedPath ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== ""
    ) throw new AppleCatalogError("invalid_request")
    return url
  }

  decodeNextCursor(value: unknown, expectedPath: string): string | null {
    const root = requireCollection(value)
    if (root.next === undefined) return null
    if (typeof root.next !== "string") throw new AppleCatalogError("invalid_response")
    try {
      this.validateCursor(root.next, expectedPath)
    } catch {
      throw new AppleCatalogError("invalid_response")
    }
    return root.next
  }

  decodeRelationshipNextCursor(
    resource: Record<string, unknown>,
    relationshipName: string,
    expectedPath: string,
  ): string | null {
    const relationships = asRecord(resource.relationships)
    const relationship = relationships && asRecord(relationships[relationshipName])
    if (!relationship) throw new AppleCatalogError("invalid_response")
    if (relationship.next === undefined) return null
    if (typeof relationship.next !== "string") throw new AppleCatalogError("invalid_response")
    try {
      this.validateCursor(relationship.next, expectedPath)
    } catch {
      throw new AppleCatalogError("invalid_response")
    }
    return relationship.next
  }

  async collectPages<T extends { id: string }>(
    options: CollectPagesOptions<T>,
  ): Promise<readonly T[]> {
    const items = [...(options.initialItems ?? [])]
    const ids = new Set(items.map((item) => item.id))
    const cursors = new Set<string>()
    let url = options.initialUrl
    for (let page = 0; url && page < MAX_RELATIONSHIP_PAGES; page++) {
      const cursor = url.toString()
      if (cursors.has(cursor)) throw new AppleCatalogError("invalid_response")
      cursors.add(cursor)
      const value = await options.request(url)
      for (const item of options.decode(value)) {
        if (ids.has(item.id)) continue
        ids.add(item.id)
        items.push(item)
      }
      const next = this.decodeNextCursor(value, options.expectedPath)
      url = next ? new URL(next, APPLE_API_ORIGIN) : null
    }
    if (url) throw new AppleCatalogError("invalid_response")
    return items
  }
}

export function collectionUrl(path: string, limit: number): URL {
  const url = new URL(path, APPLE_API_ORIGIN)
  url.searchParams.set("limit", String(limit))
  return url
}

export function filteredCollectionUrl(
  path: string,
  filter: "filter[featured]" | "filter[identity]",
  value: string,
  limit?: number,
): URL {
  const url = new URL(path, APPLE_API_ORIGIN)
  url.searchParams.set(filter, value)
  if (limit !== undefined) url.searchParams.set("limit", String(limit))
  return url
}

function requireCollection(value: unknown): Record<string, unknown> & { data: unknown[] } {
  const root = asRecord(value)
  if (!root || !Array.isArray(root.data)) throw new AppleCatalogError("invalid_response")
  return root as Record<string, unknown> & { data: unknown[] }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
