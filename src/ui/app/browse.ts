import type { Destination } from "../../core/state"
import type {
  AppleArtistSectionName,
  AppleCatalogAlbum,
  AppleCatalogAlbumSummary,
  AppleCatalogArtist,
  AppleCatalogPlaylist,
  AppleCatalogStation,
  AppleCatalogStationGenre,
  AppleCatalogTrack,
  AppleHomeSection,
  ApplePlaylist,
  Station,
  Track,
} from "../../core/types"

import type { TrackRowContent } from "./renderables"

export const artistSections = [
  { name: "top-songs", title: "TOP SONGS" },
  { name: "latest-release", title: "LATEST RELEASE" },
  { name: "full-albums", title: "ALBUMS" },
  { name: "singles", title: "SINGLES & EPS" },
  { name: "similar-artists", title: "SIMILAR ARTISTS" },
] as const satisfies readonly {
  name: AppleArtistSectionName
  title: string
}[]

export type PlaylistDisplayRow =
  | { kind: "heading"; title: string }
  | { kind: "playlist"; playlist: ApplePlaylist }

export type HomeDisplayRow =
  | { kind: "heading"; title: string }
  | { kind: "playlist"; playlist: AppleCatalogPlaylist }
  | { kind: "station"; station: AppleCatalogStation }

export type RadioSectionName =
  | "favorites"
  | "personal"
  | "live"
  | "recent"
  | "search"
  | "genre"

export interface RadioSectionState {
  status: "idle" | "loading" | "ready" | "error"
  stations: readonly Station[]
}

export type RadioDisplayRow =
  | { kind: "heading"; title: string }
  | { kind: "message"; title: string }
  | { kind: "station"; station: Station }
  | { kind: "genre"; genre: AppleCatalogStationGenre }

const radioSections = [
  { name: "favorites", title: "FAVORITE STATIONS" },
  { name: "personal", title: "MY STATION" },
  { name: "live", title: "LIVE NOW" },
  { name: "recent", title: "RECENTLY PLAYED" },
  { name: "search", title: "SEARCH RESULTS" },
  { name: "genre", title: "GENRE STATIONS" },
] as const satisfies readonly { name: RadioSectionName; title: string }[]

export function createRadioSectionStates(): Record<RadioSectionName, RadioSectionState> {
  return {
    favorites: { status: "ready", stations: [] },
    personal: { status: "idle", stations: [] },
    live: { status: "idle", stations: [] },
    recent: { status: "idle", stations: [] },
    search: { status: "idle", stations: [] },
    genre: { status: "idle", stations: [] },
  }
}

export function radioDisplayRows(
  sections: Record<RadioSectionName, RadioSectionState>,
  query = "",
  genres: readonly AppleCatalogStationGenre[] = [],
  genreStatus: RadioSectionState["status"] = "idle",
  activeGenreName?: string,
): readonly RadioDisplayRow[] {
  const seen = new Set<string>()
  const sectionRows = radioSections.flatMap(({ name, title }): readonly RadioDisplayRow[] => {
    const section = sections[name]
    if ((name === "search" || name === "genre") && section.status === "idle") return []
    const matches = filterStationValues(section.stations, query)
    const stations = matches.filter((station) => {
      if (seen.has(station.id)) return false
      seen.add(station.id)
      return true
    })
    const rows: RadioDisplayRow[] = [
      { kind: "heading", title: name === "genre" && activeGenreName
        ? activeGenreName.toUpperCase()
        : title },
      ...stations.map((station): RadioDisplayRow => ({ kind: "station", station })),
    ]
    if (section.status === "idle") {
      rows.push({
        kind: "message",
        title: name === "favorites" ? "none saved" : "not loaded",
      })
    }
    else if (section.status === "loading") rows.push({ kind: "message", title: "loading..." })
    else if (section.status === "error" && stations.length === 0) {
      rows.push({ kind: "message", title: "unavailable" })
    } else if (stations.length === 0) {
      rows.push({
        kind: "message",
        title: matches.length > 0
          ? "already shown above"
          : query
            ? "no matches"
            : name === "favorites" ? "none saved" : "none available",
      })
    }
    return rows
  })
  const genreMatches = filterGenreValues(genres, query)
  const genreRows: RadioDisplayRow[] = [{ kind: "heading", title: "BROWSE BY GENRE" }]
  if (genreStatus === "loading") genreRows.push({ kind: "message", title: "loading..." })
  else if (genreStatus === "error") genreRows.push({ kind: "message", title: "unavailable" })
  else if (genreMatches.length === 0) {
    genreRows.push({ kind: "message", title: query ? "no matches" : "none available" })
  } else {
    genreRows.push(...genreMatches.map((genre): RadioDisplayRow => ({ kind: "genre", genre })))
  }
  return [...sectionRows, ...genreRows]
}

export function radioStations(
  sections: Record<RadioSectionName, RadioSectionState>,
  query = "",
): readonly Station[] {
  return radioDisplayRows(sections, query).flatMap((row) =>
    row.kind === "station" ? [row.station] : []
  )
}

export function filterStationValues(stations: readonly Station[], query: string): readonly Station[] {
  const normalized = normalizeFilter(query)
  if (!normalized) return stations
  const terms = normalized.split(/\s+/)
  return stations.filter((station) => {
    const text = normalizeFilter(
      `${station.title} ${station.subtitle ?? ""} ${station.description ?? ""}`,
    )
    return terms.every((term) => text.includes(term))
  })
}

export function filterGenreValues(
  genres: readonly AppleCatalogStationGenre[],
  query: string,
): readonly AppleCatalogStationGenre[] {
  const normalized = normalizeFilter(query)
  if (!normalized) return genres
  const terms = normalized.split(/\s+/)
  return genres.filter((genre) => {
    const name = normalizeFilter(genre.name)
    return terms.every((term) => name.includes(term))
  })
}

export function appleStationResourceId(station: Station | undefined): string | null {
  const apple = (station as Partial<AppleCatalogStation> | undefined)?.apple
  return apple?.resourceType === "stations" &&
      typeof apple.resourceId === "string" &&
      /^[A-Za-z0-9._-]{1,128}$/.test(apple.resourceId) &&
      (!apple.playParams || (
        apple.playParams.kind === "radioStation" &&
        apple.playParams.id === apple.resourceId
      ))
    ? apple.resourceId
    : null
}

export type ArtistBrowseItem =
  | AppleCatalogTrack
  | AppleCatalogAlbumSummary
  | AppleCatalogArtist

export interface ArtistSectionState {
  status: "loading" | "loadingMore" | "ready" | "error"
  items: readonly ArtistBrowseItem[]
  nextCursor: string | null
}

export interface ArtistBrowsePage {
  kind: "artist"
  artist: AppleCatalogArtist
  sections: Record<AppleArtistSectionName, ArtistSectionState>
  selectedId: string | null
  selectionTouched: boolean
  requests: Set<AbortController>
}

export interface AlbumBrowsePage {
  kind: "album"
  summary: AppleCatalogAlbumSummary
  status: "loading" | "ready" | "error"
  album?: AppleCatalogAlbum
  selectedId: string | null
  preferredSongResourceId?: string
  requests: Set<AbortController>
}

export type BrowsePage = ArtistBrowsePage | AlbumBrowsePage

export type ArtistDisplayRow =
  | { kind: "heading"; title: string }
  | { kind: "message"; title: string; section: AppleArtistSectionName }
  | { kind: "track"; track: AppleCatalogTrack; section: "top-songs" }
  | {
      kind: "album"
      album: AppleCatalogAlbumSummary
      section: "latest-release" | "full-albums" | "singles"
    }
  | { kind: "artist"; artist: AppleCatalogArtist; section: "similar-artists" }

type SelectableArtistRow = Exclude<ArtistDisplayRow, { kind: "heading" | "message" }>

export function createArtistSectionStates(): Record<AppleArtistSectionName, ArtistSectionState> {
  const loading = (): ArtistSectionState => ({
    status: "loading",
    items: [],
    nextCursor: null,
  })
  return {
    "top-songs": loading(),
    "latest-release": loading(),
    "full-albums": loading(),
    singles: loading(),
    "similar-artists": loading(),
  }
}

export function artistDisplayRows(page: ArtistBrowsePage): readonly ArtistDisplayRow[] {
  return artistSections.flatMap(({ name, title }): readonly ArtistDisplayRow[] => {
    const state = page.sections[name]
    const rows: ArtistDisplayRow[] = [{ kind: "heading", title }]
    for (const item of state.items) {
      if (name === "top-songs" && isAppleCatalogTrack(item)) {
        rows.push({ kind: "track", track: item, section: name })
      } else if (
        (name === "latest-release" || name === "full-albums" || name === "singles") &&
        isAppleCatalogAlbumSummary(item)
      ) {
        rows.push({ kind: "album", album: item, section: name })
      } else if (name === "similar-artists" && isAppleCatalogArtist(item)) {
        rows.push({ kind: "artist", artist: item, section: name })
      }
    }
    if (state.status === "loading") {
      rows.push({ kind: "message", title: "loading...", section: name })
    } else if (state.status === "loadingMore") {
      rows.push({ kind: "message", title: "loading more...", section: name })
    } else if (state.status === "error" && state.items.length === 0) {
      rows.push({ kind: "message", title: "unavailable", section: name })
    } else if (state.items.length === 0) {
      rows.push({ kind: "message", title: "none available", section: name })
    }
    return rows
  })
}

export function artistSelectableRows(page: ArtistBrowsePage): readonly SelectableArtistRow[] {
  return artistDisplayRows(page).filter(isSelectableArtistRow)
}

export function isSelectableArtistRow(row: ArtistDisplayRow): row is SelectableArtistRow {
  return row.kind === "track" || row.kind === "album" || row.kind === "artist"
}

export function artistRowId(row: SelectableArtistRow): string {
  if (row.kind === "track") return `${row.section}:${row.track.id}`
  if (row.kind === "album") return `${row.section}:${row.album.id}`
  return `${row.section}:${row.artist.id}`
}

export function artistRowContent(
  row: SelectableArtistRow,
  selected: boolean,
  width: number,
): TrackRowContent {
  const marker = selected ? "›" : " "
  if (row.kind === "track") {
    const year = formatReleaseYear(row.track.apple.details?.releaseDate)
    return {
      title: width < 64
        ? `${marker} ${row.track.title} — ${row.track.artist}`
        : `${marker} ${row.track.title}`,
      artist: row.track.artist,
      album: "song",
      year: year ?? "",
      time: formatDuration(row.track.durationSeconds),
    }
  }
  if (row.kind === "album") {
    const year = formatReleaseYear(row.album.apple.details?.releaseDate)
    const type = row.album.apple.details?.isSingle ? "single / EP" : "album"
    return {
      title: width < 64
        ? `${marker} ${row.album.title} — ${row.album.artist}`
        : `${marker} ${row.album.title}`,
      artist: row.album.artist,
      album: type,
      year: year ?? "",
      time: "",
    }
  }
  const genres = row.artist.apple.details?.genreNames?.join(", ") ?? "artist"
  return {
    title: `${marker} ${row.artist.name}`,
    artist: genres,
    album: "artist",
    year: "",
    time: "",
  }
}

export function appendUniqueBrowseItems(
  current: readonly ArtistBrowseItem[],
  additions: readonly ArtistBrowseItem[],
): readonly ArtistBrowseItem[] {
  const ids = new Set(current.map((item) => item.id))
  return [
    ...current,
    ...additions.filter((item) => {
      if (ids.has(item.id)) return false
      ids.add(item.id)
      return true
    }),
  ]
}

export function browsePageTracks(page: BrowsePage): readonly AppleCatalogTrack[] {
  return page.kind === "album"
    ? page.album?.tracks ?? []
    : page.sections["top-songs"].items.filter(isAppleCatalogTrack)
}

export function isAppleCatalogTrack(item: ArtistBrowseItem | Track): item is AppleCatalogTrack {
  return (item as Partial<AppleCatalogTrack>).apple?.resourceType === "songs"
}

export function isAppleCatalogAlbumSummary(
  item: ArtistBrowseItem,
): item is AppleCatalogAlbumSummary {
  return (item as Partial<AppleCatalogAlbumSummary>).apple?.resourceType === "albums"
}

export function isAppleCatalogArtist(item: ArtistBrowseItem): item is AppleCatalogArtist {
  return (item as Partial<AppleCatalogArtist>).apple?.resourceType === "artists"
}

export function browsePageHasError(page: BrowsePage): boolean {
  return page.kind === "album"
    ? page.status === "error"
    : artistSections.some(({ name }) => page.sections[name].status === "error")
}

export function artistPageStatusLine(page: ArtistBrowsePage): string {
  if (artistSections.some(({ name }) => page.sections[name].status === "loading")) {
    return "◌  loading artist sections"
  }
  if (artistSections.some(({ name }) => page.sections[name].status === "loadingMore")) {
    return "◌  loading more artist content"
  }
  if (browsePageHasError(page)) return "×  some artist sections are unavailable"
  return page.artist.apple.details?.genreNames?.join(" · ") ?? "Apple Music artist"
}

export function browseAlbumEmptyMessage(status: "loading" | "ready" | "error"): string {
  if (status === "loading") return "Loading album..."
  if (status === "error") return "Apple Music album is unavailable · esc back"
  return "This album has no tracks"
}

export function browseFooterHelp(page: BrowsePage, width: number): string {
  const hasMore = page.kind === "artist" && artistSections.some(
    ({ name }) => page.sections[name].nextCursor !== null,
  )
  if (width < 64) return hasMore
    ? "enter open  m more  esc back"
    : "enter open  esc back"
  return hasMore
    ? "enter open or play   m load selected section   esc / ctrl+o back"
    : "enter open or play   esc / ctrl+o back"
}

export function playlistDisplayRows(
  destination: Destination,
  playlists: readonly ApplePlaylist[],
  homeSections: readonly AppleHomeSection[],
): readonly PlaylistDisplayRow[] {
  if (destination === "playlists") {
    return playlists.length > 0
      ? [
          { kind: "heading", title: "YOUR LIBRARY" },
          ...playlists.map(
            (playlist): PlaylistDisplayRow => ({ kind: "playlist", playlist }),
          ),
        ]
      : []
  }

  const visibleIds = new Set(playlists.map((playlist) => playlist.id))
  return homeSections.flatMap((section): readonly PlaylistDisplayRow[] => {
    const items = section.items.filter(
      (item): item is AppleCatalogPlaylist =>
        item.apple.resourceType === "playlists" && visibleIds.has(item.id),
    )
    return items.length > 0
      ? [
          { kind: "heading", title: section.title },
          ...items.map(
            (playlist): PlaylistDisplayRow => ({ kind: "playlist", playlist }),
          ),
        ]
      : []
  })
}

export function homeItems(
  favorites: readonly AppleCatalogStation[],
  sections: readonly AppleHomeSection[],
): readonly (AppleCatalogPlaylist | AppleCatalogStation)[] {
  const ids = new Set<string>()
  return [...favorites, ...sections.flatMap((section) => section.items)].filter((item) => {
    if (ids.has(item.id)) return false
    ids.add(item.id)
    return true
  })
}

export function filterHomeValues(
  items: readonly (AppleCatalogPlaylist | AppleCatalogStation)[],
  query: string,
): readonly (AppleCatalogPlaylist | AppleCatalogStation)[] {
  const normalized = normalizeFilter(query)
  if (!normalized) return items
  const terms = normalized.split(/\s+/)
  return items.filter((item) => {
    const text = isAppleCatalogStation(item)
      ? normalizeFilter(`${item.title} ${item.subtitle ?? ""} ${item.description ?? ""}`)
      : normalizeFilter(`${item.title} ${item.curator} ${item.description ?? ""}`)
    return terms.every((term) => text.includes(term))
  })
}

export function homeDisplayRows(
  favorites: readonly AppleCatalogStation[],
  sections: readonly AppleHomeSection[],
  visibleItems: readonly (AppleCatalogPlaylist | AppleCatalogStation)[],
): readonly HomeDisplayRow[] {
  const visibleIds = new Set(visibleItems.map((item) => item.id))
  const seen = new Set<string>()
  const rows: HomeDisplayRow[] = []
  const visibleFavorites = favorites.filter((station) => visibleIds.has(station.id))
  if (visibleFavorites.length > 0) {
    rows.push({ kind: "heading", title: "FAVORITE STATIONS" })
    for (const station of visibleFavorites) {
      if (seen.has(station.id)) continue
      seen.add(station.id)
      rows.push({ kind: "station", station })
    }
  }
  for (const section of sections) {
    const items = section.items.filter((item) => visibleIds.has(item.id) && !seen.has(item.id))
    if (items.length === 0) continue
    rows.push({ kind: "heading", title: section.title })
    for (const item of items) {
      seen.add(item.id)
      rows.push(isAppleCatalogStation(item)
        ? { kind: "station", station: item }
        : { kind: "playlist", playlist: item })
    }
  }
  return rows
}

export function isAppleCatalogStation(
  item: AppleCatalogPlaylist | AppleCatalogStation,
): item is AppleCatalogStation {
  return item.apple.resourceType === "stations"
}

export function appendUniqueHomeSections(
  current: readonly AppleHomeSection[],
  additions: readonly AppleHomeSection[],
): readonly AppleHomeSection[] {
  const sections = current.map((section) => ({ ...section }))
  const indexes = new Map(sections.map((section, index) => [section.id, index]))
  const playlistIds = new Set(
    sections.flatMap((section) => section.items.map((playlist) => playlist.id)),
  )
  for (const addition of additions) {
    const items = addition.items.filter((playlist) => {
      if (playlistIds.has(playlist.id)) return false
      playlistIds.add(playlist.id)
      return true
    })
    if (items.length === 0) continue
    const index = indexes.get(addition.id)
    if (index === undefined) {
      indexes.set(addition.id, sections.length)
      sections.push({ ...addition, items })
      continue
    }
    const section = sections[index]!
    sections[index] = { ...section, items: [...section.items, ...items] }
  }
  return sections
}

export function appendUniquePlaylists<T extends ApplePlaylist>(
  current: readonly T[],
  additions: readonly T[],
): readonly T[] {
  const ids = new Set(current.map((playlist) => playlist.id))
  const playlists = [...current]
  for (const playlist of additions) {
    if (ids.has(playlist.id)) continue
    ids.add(playlist.id)
    playlists.push(playlist)
  }
  return playlists
}

export function appendUniqueTracks<T extends { id: string }>(
  current: readonly T[],
  additions: readonly T[],
): readonly T[] {
  const ids = new Set(current.map((track) => track.id))
  return [
    ...current,
    ...additions.filter((track) => {
      if (ids.has(track.id)) return false
      ids.add(track.id)
      return true
    }),
  ]
}

export function filterPlaylistValues(
  playlists: readonly ApplePlaylist[],
  query: string,
): readonly ApplePlaylist[] {
  const normalized = normalizeFilter(query)
  if (!normalized) return playlists
  const terms = normalized.split(/\s+/)
  return playlists.filter((playlist) => {
    const text = normalizeFilter(
      `${playlist.title} ${playlist.curator} ${playlist.description ?? ""}`,
    )
    return terms.every((term) => text.includes(term))
  })
}

export function playlistLoading(state: { status: string }): boolean {
  return state.status === "loading"
}

export function playlistLoadingMore(state: { status: string }): boolean {
  return state.status === "loadingMore"
}

export function playlistLandingUnavailable(
  state: { status: string },
  itemCount: number,
): boolean {
  return itemCount === 0 && state.status === "error"
}

export function getRowStart(
  selectedIndex: number,
  itemCount: number,
  rowCount: number,
): number {
  if (itemCount <= rowCount) return 0
  return Math.min(
    Math.max(0, selectedIndex - Math.floor(rowCount / 2)),
    itemCount - rowCount,
  )
}

export function isPlaylistLanding(
  destination: Destination,
): destination is "home" | "playlists" {
  return destination === "home" || destination === "playlists"
}

export function appleSongResourceId(track: Track | undefined): string | null {
  const apple = (track as Partial<AppleCatalogTrack> | undefined)?.apple
  return apple?.resourceType === "songs" && typeof apple.resourceId === "string"
    ? apple.resourceId
    : null
}

export function isPlayableAppleTrack(track: Track | undefined): track is AppleCatalogTrack {
  const apple = (track as Partial<AppleCatalogTrack> | undefined)?.apple
  return Boolean(
    apple?.resourceType === "songs" &&
    typeof apple.resourceId === "string" &&
    apple.playParams?.kind === "song" &&
    apple.playParams.id === apple.resourceId,
  )
}

export function formatDuration(durationSeconds: number): string {
  const minutes = Math.floor(durationSeconds / 60)
  const seconds = Math.floor(durationSeconds % 60)
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

function formatReleaseYear(value: string | undefined): string | undefined {
  return value?.match(/^(\d{4})(?:-\d{2}-\d{2})?$/u)?.[1]
}

function normalizeFilter(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .trim()
    .toLowerCase()
}
