import type { SearchOptions, SearchPage, Track } from "../../core/types"
import { appendUniqueTracks } from "./browse"

export interface CatalogSearchState {
  query: string
  status: "idle" | "loading" | "loadingMore" | "ready" | "error"
  nextCursor: string | null
}

export interface CatalogSearchHost {
  replaceTracks(previous: readonly Track[], next: readonly Track[]): void
  prepareSearch(): void
  select(id: string | null): void
  closeMode(): void
  render(): void
}

export class CatalogSearchController {
  private values: readonly Track[] = []
  private searchState: CatalogSearchState = { query: "", status: "idle", nextCursor: null }
  private request: AbortController | undefined
  private generation = 0

  constructor(
    private readonly searchSongs: ((
      query: string,
      options?: SearchOptions,
    ) => Promise<SearchPage<Track>>) | undefined,
    private readonly host: CatalogSearchHost,
  ) {}

  get tracks(): readonly Track[] {
    return this.values
  }

  get state(): CatalogSearchState {
    return this.searchState
  }

  clear(): void {
    this.generation++
    this.request?.abort()
    this.request = undefined
    const previous = this.values
    this.values = []
    this.searchState = { query: "", status: "idle", nextCursor: null }
    this.host.replaceTracks(previous, this.values)
  }

  statusLine(activeFilter: string): string {
    if (this.searchState.status === "loading") {
      return `◌  searching Apple Music for “${this.searchState.query}”`
    }
    if (this.searchState.status === "loadingMore") {
      return `◌  loading more songs for “${this.searchState.query}”`
    }
    if (this.searchState.status === "error") {
      return `×  search unavailable · press s to retry “${this.searchState.query}”`
    }
    if (this.searchState.query) {
      return `⌕  ${this.searchState.query}${activeFilter ? `  ·  / ${activeFilter}` : ""}`
    }
    return activeFilter
      ? `/  ${activeFilter}  ·  press / to edit`
      : "›  type an Apple Music search and press Enter"
  }

  async submit(query: string): Promise<void> {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return
    if (!this.searchSongs) {
      this.searchState = { query: normalizedQuery, status: "error", nextCursor: null }
      this.host.closeMode()
      return
    }

    const generation = ++this.generation
    this.request?.abort()
    const controller = new AbortController()
    this.request = controller
    this.searchState = { query: normalizedQuery, status: "loading", nextCursor: null }
    const previous = this.values
    this.values = []
    this.host.replaceTracks(previous, this.values)
    this.host.prepareSearch()

    try {
      const page = await this.searchSongs(normalizedQuery, { signal: controller.signal })
      if (controller.signal.aborted || generation !== this.generation) return
      const previousTracks = this.values
      this.values = [...page.items]
      this.host.replaceTracks(previousTracks, this.values)
      this.searchState = {
        query: normalizedQuery,
        status: "ready",
        nextCursor: page.nextCursor,
      }
      this.host.select(this.values[0]?.id ?? null)
    } catch {
      if (controller.signal.aborted || generation !== this.generation) return
      this.searchState = { query: normalizedQuery, status: "error", nextCursor: null }
      this.host.render()
    } finally {
      if (this.request === controller) this.request = undefined
    }
  }

  async loadMore(): Promise<void> {
    const cursor = this.searchState.nextCursor
    if (!cursor || !this.searchSongs || this.searchState.status === "loadingMore") return

    const generation = ++this.generation
    this.request?.abort()
    const controller = new AbortController()
    this.request = controller
    this.searchState = { ...this.searchState, status: "loadingMore" }
    this.host.render()
    try {
      const page = await this.searchSongs(this.searchState.query, {
        cursor,
        signal: controller.signal,
      })
      if (controller.signal.aborted || generation !== this.generation) return
      const previous = this.values
      this.values = appendUniqueTracks(this.values, page.items)
      this.host.replaceTracks(previous, this.values)
      this.searchState = {
        ...this.searchState,
        status: "ready",
        nextCursor: page.nextCursor,
      }
      this.host.render()
    } catch {
      if (controller.signal.aborted || generation !== this.generation) return
      this.searchState = { ...this.searchState, status: "error", nextCursor: cursor }
      this.host.render()
    } finally {
      if (this.request === controller) this.request = undefined
    }
  }
}
