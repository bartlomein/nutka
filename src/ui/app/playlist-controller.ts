import type {
  AppleCatalogTrack,
  AppleCatalogPlaylist,
  AppleCatalogStation,
  AppleHomeSection,
  AppleLibraryPlaylist,
  ApplePlaylist,
  SearchOptions,
  SearchPage,
} from "../../core/types"
import type { Destination } from "../../core/state"
import {
  appendUniqueHomeSections,
  appendUniquePlaylists,
  appendUniqueTracks,
  filterHomeValues,
  filterPlaylistValues,
  homeItems,
} from "./browse"

type LandingStatus = "idle" | "loading" | "loadingMore" | "ready" | "error"

export interface PlaylistView {
  status: "loading" | "ready" | "loadingMore" | "error"
  playlist: ApplePlaylist
  tracks: readonly AppleCatalogTrack[]
  nextCursor: string | null
  sourceDestination: "home" | "playlists"
  sourceSelectedTrackId: string | null
  sourceFilter: string
}

interface PlaylistControllerServices {
  getHomeSections?: (options?: SearchOptions) => Promise<SearchPage<AppleHomeSection>>
  getLibraryPlaylists?: (options?: SearchOptions) => Promise<SearchPage<AppleLibraryPlaylist>>
  getPlaylistTracks?: (
    playlist: ApplePlaylist,
    options?: SearchOptions,
  ) => Promise<SearchPage<AppleCatalogTrack>>
}

interface PlaylistControllerHost {
  getDestination(): Destination
  getList(destination: "home" | "playlists"): {
    selectedTrackId: string | null
    filter: string
  }
  getFavoriteStations(): readonly AppleCatalogStation[]
  closeModeAndReset(destination: "home" | "playlists", selectedTrackId: string | null): void
  select(trackId: string | null): void
  restoreList(view: PlaylistView): void
  registerTracks(tracks: readonly AppleCatalogTrack[]): void
  unregisterTracks(tracks: readonly AppleCatalogTrack[]): void
  render(): void
}

export class PlaylistController {
  homeSections: readonly AppleHomeSection[] = []
  libraryPlaylists: readonly AppleLibraryPlaylist[] = []
  homeState: { status: LandingStatus; nextCursor: string | null } = {
    status: "idle",
    nextCursor: null,
  }
  libraryState: { status: LandingStatus; nextCursor: string | null } = {
    status: "idle",
    nextCursor: null,
  }
  view: PlaylistView | undefined

  private homeRequest: AbortController | undefined
  private homeGeneration = 0
  private libraryRequest: AbortController | undefined
  private libraryGeneration = 0
  private trackRequest: AbortController | undefined
  private trackGeneration = 0

  constructor(
    private readonly services: PlaylistControllerServices,
    private readonly host: PlaylistControllerHost,
  ) {}

  getPlaylists(destination = this.host.getDestination()): readonly ApplePlaylist[] {
    if (destination === "home") {
      return this.homeSections.flatMap((section) => section.items).filter(
        (item): item is AppleCatalogPlaylist => item.apple.resourceType === "playlists",
      )
    }
    return destination === "playlists" ? this.libraryPlaylists : []
  }

  getVisiblePlaylists(query?: string): readonly ApplePlaylist[] {
    const destination = this.host.getDestination()
    const filter = query ?? this.host.getList(
      destination === "home" ? "home" : "playlists",
    ).filter
    return filterPlaylistValues(this.getPlaylists(destination), filter)
  }

  getHomeItems() {
    return homeItems(this.host.getFavoriteStations(), this.homeSections)
  }

  getVisibleHomeItems(query?: string) {
    return filterHomeValues(this.getHomeItems(), query ?? this.host.getList("home").filter)
  }

  selectedPlaylist(): ApplePlaylist | undefined {
    const destination = this.host.getDestination()
    if ((destination !== "home" && destination !== "playlists") || this.view) return undefined
    const selectedId = this.host.getList(destination).selectedTrackId
    return this.getVisiblePlaylists().find((playlist) => playlist.id === selectedId)
  }

  async loadLanding(destination = this.host.getDestination()): Promise<void> {
    if (destination === "home") {
      if (this.homeState.status === "idle" || this.homeState.status === "error") {
        await this.loadHome()
      }
      return
    }
    if (
      destination === "playlists" &&
      (this.libraryState.status === "idle" || this.libraryState.status === "error")
    ) await this.loadLibrary()
  }

  async loadMoreLanding(): Promise<void> {
    const destination = this.host.getDestination()
    if (destination === "home" && this.homeState.nextCursor) {
      await this.loadHome(this.homeState.nextCursor)
    } else if (destination === "playlists" && this.libraryState.nextCursor) {
      await this.loadLibrary(this.libraryState.nextCursor)
    }
  }

  async openSelected(): Promise<void> {
    const destination = this.host.getDestination()
    if (
      (destination !== "home" && destination !== "playlists") ||
      this.view ||
      !this.services.getPlaylistTracks
    ) return
    const playlist = this.selectedPlaylist()
    if (!playlist) return
    const sourceList = this.host.getList(destination)
    const generation = ++this.trackGeneration
    this.trackRequest?.abort()
    const controller = new AbortController()
    this.trackRequest = controller
    this.view = {
      status: "loading",
      playlist,
      tracks: [],
      nextCursor: null,
      sourceDestination: destination,
      sourceSelectedTrackId: sourceList.selectedTrackId,
      sourceFilter: sourceList.filter,
    }
    this.host.closeModeAndReset(destination, null)
    this.host.render()
    try {
      const page = await this.services.getPlaylistTracks(playlist, {
        signal: controller.signal,
      })
      if (controller.signal.aborted || generation !== this.trackGeneration || !this.view) return
      this.host.registerTracks(page.items)
      this.view = {
        ...this.view,
        status: "ready",
        tracks: page.items,
        nextCursor: page.nextCursor,
      }
      this.host.closeModeAndReset(destination, page.items[0]?.id ?? null)
      this.host.render()
    } catch {
      if (controller.signal.aborted || generation !== this.trackGeneration || !this.view) return
      this.view = { ...this.view, status: "error" }
      this.host.render()
    } finally {
      if (this.trackRequest === controller) this.trackRequest = undefined
    }
  }

  async loadMoreTracks(): Promise<void> {
    const view = this.view
    if (!view?.nextCursor || !this.services.getPlaylistTracks || view.status === "loadingMore") {
      return
    }
    const generation = ++this.trackGeneration
    this.trackRequest?.abort()
    const controller = new AbortController()
    this.trackRequest = controller
    this.view = { ...view, status: "loadingMore" }
    this.host.render()
    try {
      const page = await this.services.getPlaylistTracks(view.playlist, {
        cursor: view.nextCursor,
        signal: controller.signal,
      })
      if (controller.signal.aborted || generation !== this.trackGeneration || !this.view) return
      const tracks = appendUniqueTracks(this.view.tracks, page.items)
      this.host.registerTracks(page.items)
      this.view = { ...this.view, status: "ready", tracks, nextCursor: page.nextCursor }
      this.host.render()
    } catch {
      if (controller.signal.aborted || generation !== this.trackGeneration || !this.view) return
      this.view = { ...this.view, status: "ready" }
      this.host.render()
    } finally {
      if (this.trackRequest === controller) this.trackRequest = undefined
    }
  }

  leaveView(): void {
    if (!this.view) return
    this.trackGeneration++
    this.trackRequest?.abort()
    this.trackRequest = undefined
    const view = this.view
    this.host.unregisterTracks(view.tracks)
    this.view = undefined
    this.host.restoreList(view)
  }

  reset(): void {
    this.homeGeneration++
    this.homeRequest?.abort()
    this.homeRequest = undefined
    this.libraryGeneration++
    this.libraryRequest?.abort()
    this.libraryRequest = undefined
    this.trackGeneration++
    this.trackRequest?.abort()
    this.trackRequest = undefined
    if (this.view) this.host.unregisterTracks(this.view.tracks)
    this.view = undefined
    this.homeSections = []
    this.libraryPlaylists = []
    this.homeState = { status: "idle", nextCursor: null }
    this.libraryState = { status: "idle", nextCursor: null }
  }

  destroy(): void {
    this.reset()
  }

  private async loadHome(cursor?: string): Promise<void> {
    if (!this.services.getHomeSections) {
      this.homeState = { status: "error", nextCursor: null }
      this.host.render()
      return
    }
    const generation = ++this.homeGeneration
    this.homeRequest?.abort()
    const controller = new AbortController()
    this.homeRequest = controller
    this.homeState = { ...this.homeState, status: cursor ? "loadingMore" : "loading" }
    if (!cursor) this.homeSections = []
    this.host.render()
    try {
      const page = await this.services.getHomeSections({
        ...(cursor ? { cursor } : {}),
        signal: controller.signal,
      })
      if (controller.signal.aborted || generation !== this.homeGeneration) return
      this.homeSections = appendUniqueHomeSections(this.homeSections, page.items)
      this.homeState = { status: "ready", nextCursor: page.nextCursor }
      this.reconcileSelection()
    } catch {
      if (controller.signal.aborted || generation !== this.homeGeneration) return
      this.homeState = { status: cursor ? "ready" : "error", nextCursor: cursor ?? null }
      this.host.render()
    } finally {
      if (this.homeRequest === controller) this.homeRequest = undefined
    }
  }

  private async loadLibrary(cursor?: string): Promise<void> {
    if (!this.services.getLibraryPlaylists) {
      this.libraryState = { status: "error", nextCursor: null }
      this.host.render()
      return
    }
    const generation = ++this.libraryGeneration
    this.libraryRequest?.abort()
    const controller = new AbortController()
    this.libraryRequest = controller
    this.libraryState = { ...this.libraryState, status: cursor ? "loadingMore" : "loading" }
    if (!cursor) this.libraryPlaylists = []
    this.host.render()
    try {
      const page = await this.services.getLibraryPlaylists({
        ...(cursor ? { cursor } : {}),
        signal: controller.signal,
      })
      if (controller.signal.aborted || generation !== this.libraryGeneration) return
      this.libraryPlaylists = appendUniquePlaylists(this.libraryPlaylists, page.items)
      this.libraryState = { status: "ready", nextCursor: page.nextCursor }
      this.reconcileSelection()
    } catch {
      if (controller.signal.aborted || generation !== this.libraryGeneration) return
      this.libraryState = { status: cursor ? "ready" : "error", nextCursor: cursor ?? null }
      this.host.render()
    } finally {
      if (this.libraryRequest === controller) this.libraryRequest = undefined
    }
  }

  reconcileSelection(): void {
    const destination = this.host.getDestination()
    if ((destination !== "home" && destination !== "playlists") || this.view) {
      this.host.render()
      return
    }
    const visible = destination === "home" ? this.getVisibleHomeItems() : this.getVisiblePlaylists()
    const selectedId = this.host.getList(destination).selectedTrackId
    if (!visible.some((item) => item.id === selectedId)) {
      this.host.select(visible[0]?.id ?? null)
    }
    this.host.render()
  }
}
