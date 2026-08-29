import type { Destination } from "../../core/state"
import type {
  AppleCatalogStation,
  AppleCatalogStationGenre,
  SearchOptions,
  SearchPage,
  Station,
} from "../../core/types"
import {
  appleStationResourceId,
  createRadioSectionStates,
  radioDisplayRows,
  type RadioDisplayRow,
  type RadioSectionName,
  type RadioSectionState,
} from "./browse"

export interface RadioOperations {
  getPersonalStation?: (
    options?: Pick<SearchOptions, "signal">,
  ) => Promise<AppleCatalogStation>
  getLiveStations?: (
    options?: Pick<SearchOptions, "signal">,
  ) => Promise<SearchPage<AppleCatalogStation>>
  getRecentStations?: (
    options?: SearchOptions,
  ) => Promise<SearchPage<AppleCatalogStation>>
  searchStations?: (
    query: string,
    options?: SearchOptions,
  ) => Promise<SearchPage<AppleCatalogStation>>
  getStationsByIds?: (
    stationResourceIds: readonly string[],
    options?: Pick<SearchOptions, "signal">,
  ) => Promise<readonly AppleCatalogStation[]>
  getGenres?: (
    options?: Pick<SearchOptions, "signal">,
  ) => Promise<readonly AppleCatalogStationGenre[]>
  getStationsForGenre?: (
    stationGenreResourceId: string,
    options?: SearchOptions,
  ) => Promise<SearchPage<AppleCatalogStation>>
  loadFavoriteIds?: (storefront: string) => readonly string[]
  setFavorite?: (
    storefront: string,
    stationResourceId: string,
    favorite: boolean,
  ) => void
  getLiked?: (
    stationResourceId: string,
    options?: Pick<SearchOptions, "signal">,
  ) => Promise<boolean>
  setLiked?: (
    stationResourceId: string,
    liked: boolean,
    options?: Pick<SearchOptions, "signal">,
  ) => Promise<void>
}

export interface RadioControllerHost {
  getDestination(): Destination
  getSelectedId(): string | null
  select(id: string | null): void
  resetSelection(id: string | null): void
  closeMode(): void
  favoritesChanged(): void
  render(): void
}

export interface RadioSearchState {
  query: string
  status: "idle" | "loading" | "loadingMore" | "ready" | "error"
  nextCursor: string | null
}

export class RadioController {
  private sectionStates = createRadioSectionStates()
  private selectionTouched = false
  private rememberedSelectionId: string | null = null
  private generation = 0
  private readonly requests = new Set<AbortController>()
  private genreValues: readonly AppleCatalogStationGenre[] = []
  private genreLoadStatus: RadioSectionState["status"] = "idle"
  private activeGenre: AppleCatalogStationGenre | undefined
  private nextGenreCursor: string | null = null
  private searchState: RadioSearchState = { query: "", status: "idle", nextCursor: null }
  private searchRequest: AbortController | undefined
  private searchGeneration = 0
  private genreRequest: AbortController | undefined
  private genreGeneration = 0
  private activeResults: "search" | "genre" | null = null
  private favoriteIds = new Set<string>()
  private favoriteValues: readonly AppleCatalogStation[] = []
  private favoriteRequest: AbortController | undefined
  private favoriteGeneration = 0
  private favoriteError = false
  private likeRequest: AbortController | undefined
  private likeError = false

  constructor(
    private readonly operations: RadioOperations,
    private readonly host: RadioControllerHost,
  ) {}

  get sections(): Record<RadioSectionName, RadioSectionState> {
    return this.sectionStates
  }

  get favorites(): readonly AppleCatalogStation[] {
    return this.favoriteValues
  }

  get favoriteResourceIds(): readonly string[] {
    return [...this.favoriteIds]
  }

  get genres(): readonly AppleCatalogStationGenre[] {
    return this.genreValues
  }

  get genreStatus(): RadioSectionState["status"] {
    return this.genreLoadStatus
  }

  get genre(): AppleCatalogStationGenre | undefined {
    return this.activeGenre
  }

  get genreNextCursor(): string | null {
    return this.nextGenreCursor
  }

  get search(): RadioSearchState {
    return this.searchState
  }

  get activeResultType(): "search" | "genre" | null {
    return this.activeResults
  }

  get favoriteSaveError(): boolean {
    return this.favoriteError
  }

  get stationLikeError(): boolean {
    return this.likeError
  }

  rows(query = ""): readonly RadioDisplayRow[] {
    return radioDisplayRows(
      this.sectionStates,
      query,
      this.genreValues,
      this.genreLoadStatus,
      this.activeGenre?.name,
    )
  }

  visibleItems(query = ""): readonly (Station | AppleCatalogStationGenre)[] {
    const items: Array<Station | AppleCatalogStationGenre> = []
    for (const row of this.rows(query)) {
      if (row.kind === "station") items.push(row.station)
      else if (row.kind === "genre") items.push(row.genre)
    }
    return items
  }

  visibleStations(query = ""): readonly Station[] {
    return this.visibleItems(query).filter((item): item is Station => "isLive" in item)
  }

  isFavorite(resourceId: string | null): boolean {
    return resourceId !== null && this.favoriteIds.has(resourceId)
  }

  hasMore(): boolean {
    return this.searchState.nextCursor !== null || this.nextGenreCursor !== null
  }

  statusLine(activeFilter: string): string {
    if (this.searchState.status === "loading") {
      return `◌  searching Radio for “${this.searchState.query}”`
    }
    if (this.searchState.status === "loadingMore") {
      return `◌  loading more stations for “${this.searchState.query}”`
    }
    if (this.searchState.status === "error") {
      return `×  Radio search unavailable · press / to retry “${this.searchState.query}”`
    }
    if (this.searchState.query) {
      return `⌕  ${this.searchState.query}${activeFilter ? `  ·  filter ${activeFilter}` : ""}`
    }
    const loading = Object.values(this.sectionStates).some((section) =>
      section.status === "loading"
    )
    return `${loading ? "◌  loading stations" : "Apple Music Radio"}${
      activeFilter ? `  ·  filter ${activeFilter}` : ""
    }`
  }

  touchSelection(): void {
    this.selectionTouched = true
    this.rememberedSelectionId = null
  }

  clear(): void {
    this.generation++
    for (const request of this.requests) request.abort()
    this.requests.clear()
    this.sectionStates = createRadioSectionStates()
    this.sectionStates.favorites = { status: "ready", stations: this.favoriteValues }
    this.genreValues = []
    this.genreLoadStatus = "idle"
    this.activeGenre = undefined
    this.nextGenreCursor = null
    this.searchState = { query: "", status: "idle", nextCursor: null }
    this.searchGeneration++
    this.searchRequest?.abort()
    this.searchRequest = undefined
    this.genreGeneration++
    this.genreRequest?.abort()
    this.genreRequest = undefined
    this.activeResults = null
    this.selectionTouched = false
    this.rememberedSelectionId = null
  }

  clearFavorites(): void {
    this.favoriteGeneration++
    this.favoriteRequest?.abort()
    this.favoriteRequest = undefined
    this.favoriteIds = new Set()
    this.favoriteValues = []
    this.favoriteError = false
    this.likeRequest?.abort()
    this.likeRequest = undefined
    this.likeError = false
    this.sectionStates.favorites = { status: "ready", stations: [] }
  }

  loadFavorites(storefront: string): void {
    const generation = ++this.favoriteGeneration
    this.favoriteRequest?.abort()
    this.favoriteRequest = undefined
    this.favoriteError = false
    try {
      this.favoriteIds = new Set(this.operations.loadFavoriteIds?.(storefront) ?? [])
    } catch {
      this.favoriteIds = new Set()
      this.favoriteValues = []
      this.sectionStates.favorites = { status: "error", stations: [] }
      this.host.render()
      return
    }
    this.favoriteValues = []
    this.sectionStates.favorites = {
      status: this.favoriteIds.size > 0 ? "loading" : "ready",
      stations: [],
    }
    if (this.favoriteIds.size === 0 || !this.operations.getStationsByIds) {
      this.host.render()
      return
    }
    const controller = new AbortController()
    this.favoriteRequest = controller
    void this.operations.getStationsByIds([...this.favoriteIds], { signal: controller.signal })
      .then((stations) => {
        if (controller.signal.aborted || generation !== this.favoriteGeneration) return
        const byId = new Map(
          [...this.favoriteValues, ...stations].map((station) => [station.apple.resourceId, station]),
        )
        this.favoriteValues = [...this.favoriteIds].flatMap((resourceId) => {
          const station = byId.get(resourceId)
          return station ? [station] : []
        })
        this.sectionStates.favorites = { status: "ready", stations: this.favoriteValues }
        this.notifyFavoritesChanged()
      })
      .catch(() => {
        if (controller.signal.aborted || generation !== this.favoriteGeneration) return
        this.sectionStates.favorites = { status: "error", stations: [] }
        this.host.render()
      })
      .finally(() => {
        if (this.favoriteRequest === controller) this.favoriteRequest = undefined
      })
  }

  load(): void {
    const loaders: readonly [
      RadioSectionName,
      ((signal: AbortSignal) => Promise<readonly Station[]>) | undefined,
    ][] = [
      ["personal", this.operations.getPersonalStation
        ? async (signal) => [await this.operations.getPersonalStation!({ signal })]
        : undefined],
      ["live", this.operations.getLiveStations
        ? async (signal) => (await this.operations.getLiveStations!({ signal })).items
        : undefined],
      ["recent", this.operations.getRecentStations
        ? async (signal) => (await this.operations.getRecentStations!({ signal })).items
        : undefined],
    ]
    const generation = ++this.generation
    this.rememberedSelectionId = this.host.getSelectedId()
    this.selectionTouched = this.rememberedSelectionId !== null
    for (const request of this.requests) request.abort()
    this.requests.clear()
    this.searchGeneration++
    this.searchRequest = undefined
    this.genreGeneration++
    this.genreRequest = undefined
    this.searchState = { query: "", status: "idle", nextCursor: null }
    this.activeGenre = undefined
    this.nextGenreCursor = null
    this.activeResults = null
    this.sectionStates.search = { status: "idle", stations: [] }
    this.sectionStates.genre = { status: "idle", stations: [] }
    this.sectionStates.favorites = { status: "ready", stations: this.favoriteValues }
    for (const [name, loader] of loaders) {
      this.sectionStates[name] = { status: loader ? "loading" : "error", stations: [] }
      if (!loader) continue
      const controller = new AbortController()
      this.requests.add(controller)
      void loader(controller.signal).then((stations) => {
        if (controller.signal.aborted || generation !== this.generation) return
        this.sectionStates[name] = { status: "ready", stations }
        this.reconcileSelection()
      }).catch(() => {
        if (controller.signal.aborted || generation !== this.generation) return
        this.sectionStates[name] = { status: "error", stations: [] }
        this.reconcileSelection()
      }).finally(() => this.requests.delete(controller))
    }
    this.genreLoadStatus = this.operations.getGenres ? "loading" : "error"
    this.genreValues = []
    if (this.operations.getGenres) {
      const controller = new AbortController()
      this.requests.add(controller)
      void this.operations.getGenres({ signal: controller.signal }).then((genres) => {
        if (controller.signal.aborted || generation !== this.generation) return
        this.genreValues = genres
        this.genreLoadStatus = "ready"
        this.reconcileSelection()
      }).catch(() => {
        if (controller.signal.aborted || generation !== this.generation) return
        this.genreLoadStatus = "error"
        this.reconcileSelection()
      }).finally(() => this.requests.delete(controller))
    }
    this.host.render()
  }

  toggleFavorite(station: AppleCatalogStation | undefined, storefront?: string): void {
    const resourceId = appleStationResourceId(station)
    if (!station || !resourceId || !storefront || !this.operations.setFavorite) return
    const favorite = !this.favoriteIds.has(resourceId)
    try {
      this.operations.setFavorite(storefront, resourceId, favorite)
    } catch {
      this.favoriteError = true
      this.host.render()
      return
    }
    this.favoriteError = false
    if (favorite) {
      this.favoriteIds.add(resourceId)
      this.favoriteValues = [...this.favoriteValues, station]
    } else {
      this.favoriteIds.delete(resourceId)
      this.favoriteValues = this.favoriteValues.filter(
        (item) => item.apple.resourceId !== resourceId,
      )
    }
    this.sectionStates.favorites = { status: "ready", stations: this.favoriteValues }
    this.notifyFavoritesChanged()
  }

  canToggleLike(station: AppleCatalogStation | undefined, signedIn: boolean): boolean {
    return this.likeRequest === undefined &&
      signedIn &&
      Boolean(
        this.operations.getLiked &&
        this.operations.setLiked &&
        appleStationResourceId(station),
      )
  }

  async toggleLike(station: AppleCatalogStation | undefined): Promise<void> {
    const resourceId = appleStationResourceId(station)
    if (!resourceId || !this.operations.getLiked || !this.operations.setLiked) return
    this.likeRequest?.abort()
    const controller = new AbortController()
    this.likeRequest = controller
    this.likeError = false
    this.host.render()
    try {
      const liked = await this.operations.getLiked(resourceId, { signal: controller.signal })
      if (controller.signal.aborted) return
      await this.operations.setLiked(resourceId, !liked, { signal: controller.signal })
      if (!controller.signal.aborted) this.host.render()
    } catch {
      if (!controller.signal.aborted) {
        this.likeError = true
        this.host.render()
      }
    } finally {
      if (this.likeRequest === controller) this.likeRequest = undefined
      this.host.render()
    }
  }

  async searchStations(query: string, cursor?: string): Promise<void> {
    const normalized = query.trim()
    if (!normalized || !this.operations.searchStations) return
    if (cursor && this.searchState.status === "loadingMore") return
    if (!cursor) {
      this.searchGeneration++
      this.searchRequest?.abort()
      this.genreGeneration++
      this.genreRequest?.abort()
      this.genreRequest = undefined
      this.nextGenreCursor = null
      this.sectionStates.genre = { status: "idle", stations: [] }
      this.activeResults = "search"
      this.rememberedSelectionId = null
    }
    const generation = this.searchGeneration
    const controller = new AbortController()
    this.searchRequest = controller
    this.requests.add(controller)
    this.searchState = {
      query: normalized,
      status: cursor ? "loadingMore" : "loading",
      nextCursor: cursor ?? null,
    }
    if (!cursor) this.sectionStates.search = { status: "loading", stations: [] }
    this.host.closeMode()
    this.host.render()
    try {
      const page = await this.operations.searchStations(normalized, {
        ...(cursor ? { cursor } : {}),
        signal: controller.signal,
      })
      if (
        controller.signal.aborted ||
        generation !== this.searchGeneration ||
        this.activeResults !== "search"
      ) return
      const existing = cursor ? this.sectionStates.search.stations : []
      const ids = new Set(existing.map((station) => station.id))
      const stations = [
        ...existing,
        ...page.items.filter((station) => !ids.has(station.id) && ids.add(station.id)),
      ]
      this.sectionStates.search = { status: "ready", stations }
      this.searchState = { query: normalized, status: "ready", nextCursor: page.nextCursor }
      if (!cursor) {
        this.selectionTouched = true
        this.rememberedSelectionId = null
        this.host.resetSelection(page.items[0]?.id ?? this.host.getSelectedId())
      }
      this.host.render()
    } catch {
      if (
        controller.signal.aborted ||
        generation !== this.searchGeneration ||
        this.activeResults !== "search"
      ) return
      this.sectionStates.search = {
        status: cursor ? "ready" : "error",
        stations: cursor ? this.sectionStates.search.stations : [],
      }
      this.searchState = { query: normalized, status: "error", nextCursor: cursor ?? null }
      this.host.render()
    } finally {
      this.requests.delete(controller)
      if (this.searchRequest === controller) this.searchRequest = undefined
    }
  }

  async openSelectedGenre(cursor?: string): Promise<void> {
    const genre = cursor
      ? this.activeGenre
      : this.genreValues.find((item) => item.id === this.host.getSelectedId())
    if (!genre || !this.operations.getStationsForGenre) return
    if (cursor && this.sectionStates.genre.status === "loading") return
    if (!cursor) {
      this.genreGeneration++
      this.genreRequest?.abort()
      this.searchGeneration++
      this.searchRequest?.abort()
      this.searchRequest = undefined
      this.searchState = { query: "", status: "idle", nextCursor: null }
      this.sectionStates.search = { status: "idle", stations: [] }
      this.nextGenreCursor = null
      this.activeResults = "genre"
      this.rememberedSelectionId = null
    }
    const generation = this.genreGeneration
    const controller = new AbortController()
    this.genreRequest = controller
    this.requests.add(controller)
    this.activeGenre = genre
    this.sectionStates.genre = {
      status: "loading",
      stations: cursor ? this.sectionStates.genre.stations : [],
    }
    this.host.render()
    try {
      const page = await this.operations.getStationsForGenre(genre.apple.resourceId, {
        ...(cursor ? { cursor } : {}),
        signal: controller.signal,
      })
      if (
        controller.signal.aborted ||
        generation !== this.genreGeneration ||
        this.activeResults !== "genre"
      ) return
      const existing = cursor ? this.sectionStates.genre.stations : []
      const ids = new Set(existing.map((station) => station.id))
      const stations = [
        ...existing,
        ...page.items.filter((station) => !ids.has(station.id) && ids.add(station.id)),
      ]
      this.sectionStates.genre = { status: "ready", stations }
      this.nextGenreCursor = page.nextCursor
      if (!cursor) {
        this.selectionTouched = true
        this.rememberedSelectionId = null
        this.host.resetSelection(page.items[0]?.id ?? genre.id)
      }
      this.host.render()
    } catch {
      if (
        controller.signal.aborted ||
        generation !== this.genreGeneration ||
        this.activeResults !== "genre"
      ) return
      this.sectionStates.genre = {
        status: cursor ? "ready" : "error",
        stations: cursor ? this.sectionStates.genre.stations : [],
      }
      this.host.render()
    } finally {
      this.requests.delete(controller)
      if (this.genreRequest === controller) this.genreRequest = undefined
    }
  }

  private reconcileSelection(): void {
    if (this.host.getDestination() !== "radio") {
      this.host.render()
      return
    }
    const items = this.visibleItems()
    const selectedId = this.host.getSelectedId()
    const remembered = this.rememberedSelectionId
    const nextSelectedId = !this.selectionTouched
      ? items[0]?.id ?? null
      : remembered && items.some((item) => item.id === remembered)
        ? remembered
        : items.some((item) => item.id === selectedId)
          ? selectedId
          : items[0]?.id ?? null
    if (!this.selectionTouched || nextSelectedId !== selectedId) {
      this.host.select(nextSelectedId)
    }
    this.host.render()
  }

  private notifyFavoritesChanged(): void {
    if (this.host.getDestination() === "radio") this.reconcileSelection()
    else this.host.favoritesChanged()
  }
}
