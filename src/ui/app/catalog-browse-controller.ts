import type {
  AppleArtistSectionName,
  AppleArtistSectionPage,
  AppleCatalogAlbum,
  AppleCatalogAlbumSummary,
  AppleCatalogArtist,
  AppleCatalogStation,
  AppleCatalogTrack,
  AppleSongContext,
  SearchOptions,
} from "../../core/types"
import {
  appleSongResourceId,
  appendUniqueBrowseItems,
  artistRowId,
  artistSections,
  artistSelectableRows,
  browsePageTracks,
  createArtistSectionStates,
  isAppleCatalogTrack,
  isPlayableAppleTrack,
  type AlbumBrowsePage,
  type ArtistBrowsePage,
  type BrowsePage,
} from "./browse"

export type ContextTarget =
  | { kind: "album"; album: AppleCatalogAlbumSummary }
  | { kind: "artist"; artist: AppleCatalogArtist }
  | { kind: "station-song"; resourceId: string }
  | { kind: "station-artist"; artist: AppleCatalogArtist }

export interface ContextPickerState {
  status: "loading" | "ready" | "error"
  pinnedTrack: AppleCatalogTrack
  targets: readonly ContextTarget[]
  selectedIndex: number
}

export interface SearchAlbumView {
  status: "loading" | "ready" | "error"
  title: string
  sourceSelectedTrackId: string | null
  sourceFilter: string
  album?: AppleCatalogAlbum
}

interface CatalogBrowseServices {
  getAlbumForSong?: (
    songResourceId: string,
    options?: Pick<SearchOptions, "signal">,
  ) => Promise<AppleCatalogAlbum>
  getSongContext?: (
    songResourceId: string,
    options?: Pick<SearchOptions, "signal">,
  ) => Promise<AppleSongContext>
  getAlbum?: (
    albumResourceId: string,
    options?: Pick<SearchOptions, "signal">,
  ) => Promise<AppleCatalogAlbum>
  getArtistSection?: (
    artistResourceId: string,
    section: AppleArtistSectionName,
    options?: SearchOptions,
  ) => Promise<AppleArtistSectionPage>
  getStationForResource?: (
    resourceType: "songs" | "artists",
    resourceId: string,
    options?: Pick<SearchOptions, "signal">,
  ) => Promise<AppleCatalogStation>
  playTrack?: (
    track: AppleCatalogTrack,
    upcoming: readonly AppleCatalogTrack[],
  ) => Promise<void>
  playStation?: (station: AppleCatalogStation) => Promise<void>
}

interface CatalogBrowseHost {
  getCurrentTrack(): AppleCatalogTrack | undefined
  getSearchState(): {
    destination: string
    selectedTrackId: string | null
    filter: string
    visibleTracks: readonly AppleCatalogTrack[]
  }
  prepareSearchAlbum(): void
  selectSearchTrack(id: string | null): void
  restoreSearch(selectedTrackId: string | null, filter: string): void
  replaceBrowseTracks(tracks: readonly AppleCatalogTrack[]): void
  replaceAlbumTracks(tracks: readonly AppleCatalogTrack[]): void
  closeMode(): void
  render(): void
}

export class CatalogBrowseController {
  contextPicker: ContextPickerState | undefined
  browsePages: BrowsePage[] = []
  albumView: SearchAlbumView | undefined

  private contextGeneration = 0
  private contextRequest: AbortController | undefined
  private browseContextOrigin: ContextPickerState | undefined
  private readonly browseRequests = new Set<AbortController>()
  private albumGeneration = 0
  private albumRequest: AbortController | undefined

  constructor(
    private readonly services: CatalogBrowseServices,
    private readonly host: CatalogBrowseHost,
  ) {}

  currentPage(): BrowsePage | undefined {
    return this.browsePages.at(-1)
  }

  canBrowseNowPlaying(): boolean {
    const track = this.host.getCurrentTrack()
    return Boolean(
      track &&
      ((this.services.getSongContext &&
        (this.services.getAlbum || this.services.getArtistSection)) ||
        (this.services.getStationForResource && this.services.playStation)) &&
      appleSongResourceId(track) !== null
    )
  }

  async openNowPlayingContext(): Promise<void> {
    const track = this.host.getCurrentTrack()
    const songResourceId = appleSongResourceId(track)
    if (!this.canBrowseNowPlaying() || !track || !songResourceId) return

    const generation = ++this.contextGeneration
    this.contextRequest?.abort()
    const controller = new AbortController()
    this.contextRequest = controller
    this.host.closeMode()
    const songStationTarget: readonly ContextTarget[] =
      this.services.getStationForResource && this.services.playStation && isPlayableAppleTrack(track)
        ? [{ kind: "station-song", resourceId: songResourceId }]
        : []
    this.contextPicker = {
      status: this.services.getSongContext ? "loading" : "ready",
      pinnedTrack: track,
      targets: songStationTarget,
      selectedIndex: 0,
    }
    this.host.render()
    if (!this.services.getSongContext) return
    try {
      const context = await this.services.getSongContext(songResourceId, {
        signal: controller.signal,
      })
      if (
        controller.signal.aborted || generation !== this.contextGeneration || !this.contextPicker
      ) return
      this.contextPicker = {
        ...this.contextPicker,
        status: "ready",
        targets: [
          ...(this.services.getAlbum
            ? context.albums.map((album): ContextTarget => ({ kind: "album", album }))
            : []),
          ...(this.services.getArtistSection
            ? context.artists.map((artist): ContextTarget => ({ kind: "artist", artist }))
            : []),
          ...songStationTarget,
          ...(this.services.getStationForResource && this.services.playStation
            ? context.artists.map(
                (artist): ContextTarget => ({ kind: "station-artist", artist }),
              )
            : []),
        ],
        selectedIndex: 0,
      }
      this.host.render()
    } catch {
      if (
        controller.signal.aborted || generation !== this.contextGeneration || !this.contextPicker
      ) return
      this.contextPicker = songStationTarget.length > 0
        ? { ...this.contextPicker, status: "ready", targets: songStationTarget }
        : { ...this.contextPicker, status: "error", targets: [] }
      this.host.render()
    } finally {
      if (this.contextRequest === controller) this.contextRequest = undefined
    }
  }

  closeContextPicker(): void {
    if (!this.contextPicker) return
    this.cancelContextRequest()
    this.contextPicker = undefined
    this.host.render()
  }

  moveContextSelection(delta: number): void {
    const picker = this.contextPicker
    if (!picker || picker.targets.length === 0) return
    picker.selectedIndex = Math.max(
      0,
      Math.min(picker.targets.length - 1, picker.selectedIndex + delta),
    )
    this.host.render()
  }

  async chooseContextTarget(): Promise<void> {
    const picker = this.contextPicker
    const target = picker?.targets[picker.selectedIndex]
    if (!picker || picker.status !== "ready" || !target) return
    if (target.kind === "station-song" || target.kind === "station-artist") {
      if (!this.services.getStationForResource || !this.services.playStation) return
      const generation = ++this.contextGeneration
      this.contextRequest?.abort()
      const controller = new AbortController()
      this.contextRequest = controller
      this.contextPicker = { ...picker, status: "loading" }
      this.host.render()
      try {
        const station = await this.services.getStationForResource(
          target.kind === "station-song" ? "songs" : "artists",
          target.kind === "station-song" ? target.resourceId : target.artist.apple.resourceId,
          { signal: controller.signal },
        )
        if (controller.signal.aborted || generation !== this.contextGeneration) return
        await this.services.playStation(station)
        if (controller.signal.aborted || generation !== this.contextGeneration) return
        this.contextPicker = undefined
        this.host.render()
      } catch {
        if (
          controller.signal.aborted || generation !== this.contextGeneration || !this.contextPicker
        ) return
        this.contextPicker = { ...this.contextPicker, status: "ready" }
        this.host.render()
      } finally {
        if (this.contextRequest === controller) this.contextRequest = undefined
      }
      return
    }
    this.contextPicker = undefined
    this.closeBrowseSession(false)
    this.browseContextOrigin = picker
    if (target.kind === "album") {
      void this.openBrowseAlbum(target.album, picker.pinnedTrack.apple.resourceId)
    } else {
      this.openBrowseArtist(target.artist)
    }
  }

  canStartSongStation(): boolean {
    return Boolean(
      this.services.getStationForResource &&
      this.services.playStation &&
      isPlayableAppleTrack(this.host.getCurrentTrack()),
    )
  }

  async startCurrentSongStation(): Promise<void> {
    const track = this.host.getCurrentTrack()
    if (
      !this.canStartSongStation() || !track ||
      !this.services.getStationForResource || !this.services.playStation
    ) return
    const generation = ++this.contextGeneration
    this.contextRequest?.abort()
    const controller = new AbortController()
    this.contextRequest = controller
    try {
      const station = await this.services.getStationForResource(
        "songs",
        track.apple.resourceId,
        { signal: controller.signal },
      )
      if (controller.signal.aborted || generation !== this.contextGeneration) return
      await this.services.playStation(station)
    } catch {
      // Keep confirmed playback unchanged when station creation fails.
    } finally {
      if (this.contextRequest === controller) this.contextRequest = undefined
    }
  }

  closeBrowseSession(render = true): void {
    for (const request of this.browseRequests) request.abort()
    this.browseRequests.clear()
    this.browsePages = []
    this.browseContextOrigin = undefined
    this.syncBrowseTracks()
    if (render) this.host.render()
  }

  popBrowsePage(): boolean {
    const page = this.browsePages.pop()
    if (!page) return false
    for (const request of page.requests) {
      request.abort()
      this.browseRequests.delete(request)
    }
    page.requests.clear()
    this.syncBrowseTracks()
    if (this.browsePages.length === 0 && this.browseContextOrigin) {
      this.contextPicker = this.browseContextOrigin
      this.browseContextOrigin = undefined
    }
    this.host.render()
    return true
  }

  moveBrowseSelection(delta: number): void {
    const page = this.currentPage()
    if (!page) return
    const ids = page.kind === "artist"
      ? artistSelectableRows(page).map(artistRowId)
      : (page.album?.tracks.map((track) => track.id) ?? [])
    if (ids.length === 0) return
    const selectedIndex = ids.indexOf(page.selectedId ?? "")
    const nextIndex = selectedIndex < 0
      ? delta < 0 ? ids.length - 1 : 0
      : Math.min(ids.length - 1, Math.max(0, selectedIndex + delta))
    page.selectedId = ids[nextIndex] ?? null
    if (page.kind === "artist") page.selectionTouched = true
    this.host.render()
  }

  openSelectedBrowseItem(): void {
    const page = this.currentPage()
    if (!page) return
    if (page.kind === "artist") page.selectionTouched = true
    if (page.kind === "album") {
      const tracks = page.album?.tracks ?? []
      const selectedIndex = tracks.findIndex((track) => track.id === page.selectedId)
      const track = tracks[selectedIndex]
      if (this.services.playTrack && isPlayableAppleTrack(track)) {
        void this.services.playTrack(
          track,
          tracks.slice(selectedIndex + 1).filter(isPlayableAppleTrack),
        ).catch(() => {})
      }
      return
    }
    const row = artistSelectableRows(page).find((item) => artistRowId(item) === page.selectedId)
    if (!row) return
    if (row.kind === "album") {
      void this.openBrowseAlbum(row.album)
      return
    }
    if (row.kind === "artist") {
      this.openBrowseArtist(row.artist)
      return
    }
    const topSongs = page.sections["top-songs"].items.filter(isAppleCatalogTrack)
    const selectedIndex = topSongs.findIndex((track) => track.id === row.track.id)
    if (this.services.playTrack && isPlayableAppleTrack(row.track)) {
      void this.services.playTrack(
        row.track,
        topSongs.slice(selectedIndex + 1).filter(isPlayableAppleTrack),
      ).catch(() => {})
    }
  }

  loadMoreSelectedArtistSection(): void {
    const page = this.currentPage()
    if (page?.kind !== "artist") return
    const row = artistSelectableRows(page).find((item) => artistRowId(item) === page.selectedId)
    if (!row) return
    page.selectionTouched = true
    const section = page.sections[row.section]
    if (section.status === "loading" || section.status === "loadingMore") return
    if (section.nextCursor) void this.loadArtistSection(page, row.section, section.nextCursor)
  }

  canOpenSelectedAlbum(): boolean {
    const search = this.host.getSearchState()
    return !this.currentPage() && search.destination === "search" && !this.albumView &&
      Boolean(this.services.getAlbumForSong) &&
      appleSongResourceId(
        search.visibleTracks.find((track) => track.id === search.selectedTrackId),
      ) !== null
  }

  leaveAlbumView(): void {
    if (!this.albumView) return
    this.albumGeneration++
    this.albumRequest?.abort()
    this.albumRequest = undefined
    const { sourceFilter, sourceSelectedTrackId } = this.albumView
    this.host.replaceAlbumTracks([])
    this.albumView = undefined
    this.host.restoreSearch(sourceSelectedTrackId, sourceFilter)
  }

  async openSelectedAlbum(): Promise<void> {
    if (this.albumView || !this.services.getAlbumForSong) return
    const search = this.host.getSearchState()
    const selectedTrack = search.visibleTracks.find((track) => track.id === search.selectedTrackId)
    const songResourceId = appleSongResourceId(selectedTrack)
    if (!selectedTrack || !songResourceId) return

    const generation = ++this.albumGeneration
    this.albumRequest?.abort()
    const controller = new AbortController()
    this.albumRequest = controller
    this.albumView = {
      status: "loading",
      title: selectedTrack.album,
      sourceSelectedTrackId: search.selectedTrackId,
      sourceFilter: search.filter,
    }
    this.host.prepareSearchAlbum()
    this.host.render()
    try {
      const album = await this.services.getAlbumForSong(songResourceId, {
        signal: controller.signal,
      })
      if (controller.signal.aborted || generation !== this.albumGeneration || !this.albumView) {
        return
      }
      this.host.replaceAlbumTracks(album.tracks)
      this.albumView = { ...this.albumView, status: "ready", title: album.title, album }
      this.host.selectSearchTrack(album.tracks[0]?.id ?? null)
      this.host.render()
    } catch {
      if (controller.signal.aborted || generation !== this.albumGeneration || !this.albumView) return
      this.albumView = { ...this.albumView, status: "error" }
      this.host.render()
    } finally {
      if (this.albumRequest === controller) this.albumRequest = undefined
    }
  }

  reset(): void {
    this.cancelContextRequest()
    this.contextPicker = undefined
    this.closeBrowseSession(false)
    this.leaveAlbumView()
  }

  destroy(): void {
    this.reset()
  }

  private openBrowseArtist(artist: AppleCatalogArtist): void {
    const page: ArtistBrowsePage = {
      kind: "artist",
      artist,
      sections: createArtistSectionStates(),
      selectedId: null,
      selectionTouched: false,
      requests: new Set(),
    }
    this.browsePages.push(page)
    this.host.render()
    for (const section of artistSections) void this.loadArtistSection(page, section.name)
  }

  private async loadArtistSection(
    page: ArtistBrowsePage,
    section: AppleArtistSectionName,
    cursor?: string,
  ): Promise<void> {
    if (!this.services.getArtistSection || !this.browsePages.includes(page)) return
    const controller = new AbortController()
    this.browseRequests.add(controller)
    page.requests.add(controller)
    page.sections[section] = {
      ...page.sections[section],
      status: cursor ? "loadingMore" : "loading",
    }
    this.host.render()
    try {
      const result = await this.services.getArtistSection(
        page.artist.apple.resourceId,
        section,
        { ...(cursor ? { cursor } : {}), signal: controller.signal },
      )
      if (controller.signal.aborted || !this.browsePages.includes(page)) return
      if (result.section !== section) throw new Error("Artist section mismatch")
      page.sections[section] = {
        status: "ready",
        items: appendUniqueBrowseItems(cursor ? page.sections[section].items : [], result.items),
        nextCursor: result.nextCursor,
      }
      this.syncBrowseTracks()
      this.reconcileBrowseSelection(page)
      this.host.render()
    } catch {
      if (controller.signal.aborted || !this.browsePages.includes(page)) return
      page.sections[section] = {
        ...page.sections[section],
        status: cursor ? "ready" : "error",
        nextCursor: cursor ?? null,
      }
      this.reconcileBrowseSelection(page)
      this.host.render()
    } finally {
      this.browseRequests.delete(controller)
      page.requests.delete(controller)
    }
  }

  private async openBrowseAlbum(
    summary: AppleCatalogAlbumSummary,
    preferredSongResourceId?: string,
  ): Promise<void> {
    if (!this.services.getAlbum) return
    const page: AlbumBrowsePage = {
      kind: "album",
      summary,
      status: "loading",
      selectedId: null,
      requests: new Set(),
      ...(preferredSongResourceId ? { preferredSongResourceId } : {}),
    }
    this.browsePages.push(page)
    this.host.render()
    const controller = new AbortController()
    this.browseRequests.add(controller)
    page.requests.add(controller)
    try {
      const album = await this.services.getAlbum(summary.apple.resourceId, {
        signal: controller.signal,
      })
      if (controller.signal.aborted || !this.browsePages.includes(page)) return
      page.status = "ready"
      page.album = album
      page.selectedId = album.tracks.find(
        (track) => track.apple.resourceId === preferredSongResourceId,
      )?.id ?? album.tracks[0]?.id ?? null
      this.syncBrowseTracks()
      this.host.render()
    } catch {
      if (controller.signal.aborted || !this.browsePages.includes(page)) return
      page.status = "error"
      this.host.render()
    } finally {
      this.browseRequests.delete(controller)
      page.requests.delete(controller)
    }
  }

  private reconcileBrowseSelection(page: ArtistBrowsePage): void {
    const ids = artistSelectableRows(page).map(artistRowId)
    if (!page.selectionTouched || !ids.includes(page.selectedId ?? "")) {
      page.selectedId = ids[0] ?? null
    }
  }

  private syncBrowseTracks(): void {
    this.host.replaceBrowseTracks(this.browsePages.flatMap(browsePageTracks))
  }

  private cancelContextRequest(): void {
    this.contextGeneration++
    this.contextRequest?.abort()
    this.contextRequest = undefined
  }
}
