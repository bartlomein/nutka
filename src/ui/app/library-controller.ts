import { filterTracks, type ListState } from "../../core/state"
import type {
  AppleCatalogTrack, AppleLibraryAlbum, AppleLibraryArtist, AppleLibraryItem,
  AppleLibrarySection, AppleLibrarySong, SearchOptions, SearchPage, Track,
} from "../../core/types"
import { appendUniqueTracks } from "./browse"

export interface LibraryServices {
  getSongs(options?: SearchOptions): Promise<SearchPage<AppleLibrarySong>>
  getAlbums(options?: SearchOptions): Promise<SearchPage<AppleLibraryAlbum>>
  getArtists(options?: SearchOptions): Promise<SearchPage<AppleLibraryArtist>>
  getAlbumTracks(id: string, options?: SearchOptions): Promise<SearchPage<AppleLibrarySong>>
  getArtistAlbums(id: string, options?: SearchOptions): Promise<SearchPage<AppleLibraryAlbum>>
}

interface LibraryHost {
  active(): boolean
  authenticated(): boolean
  list(): ListState
  query(): string
  restoreList(list: ListState): void
  replaceTracks(tracks: readonly AppleCatalogTrack[]): void
  render(): void
}

export interface LibraryPage {
  section: AppleLibrarySection
  title: string
  parent?: AppleLibraryAlbum | AppleLibraryArtist
  items: readonly AppleLibraryItem[]
  status: "idle" | "loading" | "loadingMore" | "ready" | "error"
  nextCursor: string | null
  error: boolean
  retryCursor: string | null
  list: ListState
  request?: AbortController
}

function createPage(section: AppleLibrarySection, parent?: LibraryPage["parent"]): LibraryPage {
  return {
    section,
    title: parent ? parent.kind === "artist" ? parent.name : parent.title
      : `Library ${section}`,
    ...(parent ? { parent } : {}),
    items: [], status: "idle", nextCursor: null, error: false, retryCursor: null,
    list: { selectedTrackId: null, filter: "" },
  }
}

export class LibraryController {
  private roots = this.createRoots()
  private stack: LibraryPage[] = []
  section: AppleLibrarySection = "songs"

  constructor(private readonly services: LibraryServices, private readonly host: LibraryHost) {}

  get page(): LibraryPage { return this.stack.at(-1) ?? this.roots[this.section] }
  get nested(): boolean { return this.stack.length > 0 }

  rows(): readonly Track[] { return this.page.items.map(libraryItemTrack) }

  visibleItems(query = this.host.list().filter): readonly AppleLibraryItem[] {
    const ids = new Set(filterTracks(this.rows(), query).map((track) => track.id))
    return this.page.items.filter((item) => ids.has(item.id))
  }

  playableTracks(query = this.host.list().filter): readonly AppleCatalogTrack[] {
    return this.visibleItems(query).flatMap((item) =>
      item.kind === "song" && item.playback ? [item.playback] : [])
  }

  enter(): void {
    if (!this.host.authenticated()) return
    this.reconcileSelection()
    if (this.page.status === "idle" || this.page.status === "error") void this.load()
    else this.host.render()
  }

  switchSection(section: AppleLibrarySection): void {
    this.remember()
    this.clearStack()
    this.section = section
    this.host.restoreList(this.page.list)
    this.syncTracks()
    this.host.render()
    this.enter()
  }

  openSelected(query: string): boolean {
    if (!this.host.authenticated()) return false
    const item = this.visibleItems(query).find((item) => item.id === this.host.list().selectedTrackId)
    if (!item || item.kind === "song") return false
    this.remember()
    this.stack.push(createPage(item.kind === "album" ? "songs" : "albums", item))
    this.host.restoreList(this.page.list)
    void this.load()
    return true
  }

  back(): boolean {
    if (!this.nested) return false
    this.cancel(this.stack.pop()!)
    this.host.restoreList(this.page.list)
    this.syncTracks()
    this.host.render()
    this.enter()
    return true
  }

  leave(): void { this.remember() }

  loadMore(): void {
    if (this.page.status === "loading" || this.page.status === "loadingMore") return
    if (this.page.error) void this.load(this.page.retryCursor ?? undefined)
    else if (this.page.nextCursor) void this.load(this.page.nextCursor)
    else if (this.page.status === "idle") void this.load()
  }

  refresh(): void { void this.load() }

  reset(): void {
    Object.values(this.roots).forEach((page) => this.cancel(page))
    this.clearStack()
    this.roots = this.createRoots()
    this.section = "songs"
    this.host.replaceTracks([])
  }

  statusLine(query: string): string {
    if (!this.host.authenticated()) return "Sign in to Apple Music to browse your library"
    const page = this.page
    if (page.error) return "Library request failed · m retry · R refresh"
    if (page.status === "loading") return `Loading saved ${page.section}...`
    if (page.status === "loadingMore") return `Loading saved ${page.section}... · ${page.items.length} loaded`
    const unavailable = page.items.filter((item) => item.kind === "song" && !item.playback).length
    return `Saved ${page.section}${query ? ` · / ${query}` : ""}${
      unavailable ? ` · ${unavailable} unavailable for playback` : ""
    }`
  }

  emptyMessage(query: string): string {
    if (!this.host.authenticated()) return "Sign in to Apple Music to load your library"
    if (this.page.status === "loading") return `Loading saved ${this.page.section}...`
    if (this.page.error) return "Could not load your library · m retry"
    if (query) return this.page.status === "loadingMore"
      ? "No matches yet · still loading your library..."
      : "No matches · / change filter"
    if (this.page.status === "loadingMore") return `Loading saved ${this.page.section}...`
    return `No saved ${this.page.section}`
  }

  private async load(cursor?: string): Promise<void> {
    if (!this.host.authenticated()) return
    const page = this.page
    page.request?.abort()
    const request = new AbortController()
    page.request = request
    page.status = cursor ? "loadingMore" : "loading"
    page.error = false
    this.host.render()
    try {
      const seenCursors = new Set<string>()
      while (true) {
        if (cursor) seenCursors.add(cursor)
        const options = { signal: request.signal, ...(cursor ? { cursor } : {}) }
        const response = await this.requestPage(page, options)
        if (request.signal.aborted || page.request !== request) return
        if (response.nextCursor && seenCursors.has(response.nextCursor)) {
          throw new Error("Repeated library cursor")
        }
        page.items = appendUniqueTracks(cursor ? page.items : [], response.items)
        page.nextCursor = response.nextCursor
        page.retryCursor = null
        page.status = response.nextCursor ? "loadingMore" : "ready"
        this.syncTracks()
        if (this.page === page) this.reconcileSelection()
        this.host.render()
        if (!response.nextCursor) break
        cursor = response.nextCursor
      }
    } catch {
      if (request.signal.aborted || page.request !== request) return
      page.status = page.items.length ? "ready" : "error"
      page.error = true
      page.retryCursor = cursor ?? null
    } finally {
      if (page.request === request) {
        page.request = undefined
        this.host.render()
      }
    }
  }

  private requestPage(page: LibraryPage, options: SearchOptions): Promise<SearchPage<AppleLibraryItem>> {
    if (page.parent?.kind === "album") return this.services.getAlbumTracks(page.parent.resourceId, options)
    if (page.parent?.kind === "artist") return this.services.getArtistAlbums(page.parent.resourceId, options)
    if (page.section === "songs") return this.services.getSongs(options)
    if (page.section === "albums") return this.services.getAlbums(options)
    return this.services.getArtists(options)
  }

  private remember(): void {
    if (this.host.active()) this.page.list = { ...this.host.list() }
  }

  private reconcileSelection(): void {
    if (!this.host.active()) return
    const list = this.host.list()
    const visible = this.visibleItems(this.host.query())
    if (!visible.some((item) => item.id === list.selectedTrackId)) {
      this.host.restoreList({ ...list, selectedTrackId: visible[0]?.id ?? null })
    }
  }

  private syncTracks(): void {
    this.host.replaceTracks([...Object.values(this.roots), ...this.stack].flatMap((page) =>
      page.items.flatMap((item) => item.kind === "song" && item.playback ? [item.playback] : [])))
  }

  private cancel(page: LibraryPage): void {
    page.request?.abort()
    page.request = undefined
  }

  private clearStack(): void {
    this.stack.forEach((page) => this.cancel(page))
    this.stack = []
  }

  private createRoots(): Record<AppleLibrarySection, LibraryPage> {
    return { songs: createPage("songs"), albums: createPage("albums"), artists: createPage("artists") }
  }
}

export function libraryItemTrack(item: AppleLibraryItem): Track {
  if (item.kind === "song") return item
  return {
    id: item.id,
    title: item.kind === "artist" ? item.name : item.title,
    artist: item.kind === "artist" ? "" : item.artist,
    album: item.kind,
    durationSeconds: 0,
  }
}
