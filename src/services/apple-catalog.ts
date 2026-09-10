import type {
  AppleArtistSectionName,
  AppleArtistSectionPage,
  AppleCatalogAlbum,
  AppleCatalogArtist,
  AppleCatalogPlaylist,
  AppleCatalogStation,
  AppleCatalogStationGenre,
  AppleCatalogTrack,
  AppleHomeSection,
  AppleLibraryPlaylist,
  AppleLibrarySong,
  AppleLibraryAlbum,
  AppleLibraryArtist,
  ApplePlaylist,
  ApplePersonalRating,
  ApplePersonalRatingResourceType,
  ApplePersonalSongRating,
  ApplePersonalStationRating,
  AppleSongContext,
  MusicProvider,
  SearchOptions,
  SearchPage,
} from "../core/types"
import { isResourceId } from "./apple-catalog-decode-helpers"
import { AppleCatalogError, type AppleCatalogErrorCode } from "./apple-catalog-error"
import {
  decodeCatalogCollection as decodeCollection,
  decodePersonalRating,
  decodeCatalogSearchResponse,
  requireCatalogCollection as requireCollection,
  validateCatalogQuery,
} from "./apple-catalog-decoders"
import { decodeHomeSections } from "./apple-catalog-home-decoders"
import {
  decodeAlbum,
  decodeAlbumSummary,
  decodeArtist,
  decodeArtistSectionPage,
  decodeCatalogTracks,
  decodeRelationshipId,
  decodeSingleResource,
  decodeSong,
} from "./apple-catalog-media-decoders"
import {
  APPLE_API_ORIGIN,
  AppleCatalogPagination,
  collectionUrl,
  filteredCollectionUrl,
} from "./apple-catalog-pagination"
import {
  decodeLibraryPlaylist,
  decodePlaylistTracks,
} from "./apple-catalog-playlist-decoders"
import {
  decodeSingleStation,
  decodeStation,
  decodeStationGenre,
  decodeStationPage,
} from "./apple-catalog-station-decoders"
import { AppleCatalogTransport } from "./apple-catalog-transport"
import {
  decodeLibrarySong, decodeLibraryAlbum, decodeLibraryArtist, decodeLibraryAlbumTracks,
} from "./apple-library-decoders"
import type { PlaybackLogger } from "./playback-log"
import type { Fetch } from "./token-service"

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 25

const artistSectionNames = new Set<AppleArtistSectionName>([
  "top-songs",
  "latest-release",
  "full-albums",
  "singles",
  "similar-artists",
])

export { AppleCatalogError }
export type { AppleCatalogErrorCode }

export interface AppleCatalogProviderOptions {
  fetch?: Fetch
  timeoutMs?: number
  limit?: number
  useMusicUserToken?: <T>(
    use: (musicUserToken: string) => T | Promise<T>,
  ) => Promise<T>
  logger?: PlaybackLogger
}

export class AppleCatalogProvider implements MusicProvider<AppleCatalogTrack> {
  readonly id = "apple"
  readonly displayName = "Apple Music"

  private readonly limit: number
  private readonly searchPath: string
  private readonly useMusicUserToken: AppleCatalogProviderOptions["useMusicUserToken"]
  private readonly transport: AppleCatalogTransport
  private readonly pagination: AppleCatalogPagination
  private readonly logger: PlaybackLogger

  constructor(
    serviceUrl: string,
    readonly storefront: string,
    options: AppleCatalogProviderOptions = {},
  ) {
    if (!/^[a-z]{2}$/.test(storefront)) {
      throw new AppleCatalogError("invalid_request")
    }
    if (options.limit !== undefined &&
      (!Number.isInteger(options.limit) || options.limit <= 0)) {
      throw new AppleCatalogError("invalid_request")
    }
    if (options.timeoutMs !== undefined &&
      (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
      throw new AppleCatalogError("invalid_request")
    }

    this.limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
    this.searchPath = `/v1/catalog/${storefront}/search`
    this.useMusicUserToken = options.useMusicUserToken
    this.logger = options.logger ?? { log() {} }
    this.transport = new AppleCatalogTransport(serviceUrl, {
      fetch: options.fetch ?? fetch,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(this.useMusicUserToken === undefined ? {} : {
        useMusicUserToken: this.useMusicUserToken,
      }),
    })
    this.pagination = new AppleCatalogPagination(this.searchPath, this.limit)
  }

  async searchSongs(
    query: string,
    options: SearchOptions = {},
  ): Promise<SearchPage<AppleCatalogTrack>> {
    const term = validateCatalogQuery(query)
    const url = options.cursor
      ? this.validateSearchCursor(options.cursor, "songs", term)
      : this.buildSearchUrl(term, "songs")

    return this.requestCatalog(options, async (developerToken, signal) =>
      this.decodeSearchResponse(
        await this.requestAppleJson(url, developerToken, signal),
        "songs",
        term,
        decodeSong,
      ))
  }

  async searchStations(
    query: string,
    options: SearchOptions = {},
  ): Promise<SearchPage<AppleCatalogStation>> {
    const term = validateCatalogQuery(query)
    const url = options.cursor
      ? this.validateSearchCursor(options.cursor, "stations", term)
      : this.buildSearchUrl(term, "stations")

    return this.requestCatalog(options, async (developerToken, signal) =>
      this.decodeSearchResponse(
        await this.requestAppleJson(url, developerToken, signal),
        "stations",
        term,
        decodeStation,
      ))
  }

  async getAlbumForSong(
    songResourceId: string,
    options: Pick<SearchOptions, "signal"> = {},
  ): Promise<AppleCatalogAlbum> {
    if (!isResourceId(songResourceId)) {
      throw new AppleCatalogError("invalid_request")
    }

    return this.requestCatalog(options, async (developerToken, signal) => {
      const songUrl = new URL(
        `/v1/catalog/${this.storefront}/songs/${songResourceId}`,
        APPLE_API_ORIGIN,
      )
      songUrl.searchParams.set("include", "albums")
      const song = decodeSingleResource(
        await this.requestAppleJson(songUrl, developerToken, signal),
        "songs",
      )
      const albumId = decodeRelationshipId(song, "albums", "albums")
      if (!albumId) throw new AppleCatalogError("invalid_response")
      return this.requestAlbum(albumId, developerToken, signal)
    })
  }

  async getSongContext(
    songResourceId: string,
    options: Pick<SearchOptions, "signal"> = {},
  ): Promise<AppleSongContext> {
    if (!isResourceId(songResourceId)) {
      throw new AppleCatalogError("invalid_request")
    }
    return this.requestCatalog(options, async (developerToken, signal) => {
      const controller = new AbortController()
      const abort = () => controller.abort()
      signal.addEventListener("abort", abort, { once: true })
      if (signal.aborted) controller.abort()
      const basePath = `/v1/catalog/${this.storefront}/songs/${songResourceId}`
      try {
        const [albums, artists] = await Promise.all([
          this.requestRelationship(
            `${basePath}/albums`,
            developerToken,
            controller.signal,
            decodeAlbumSummary,
          ),
          this.requestRelationship(
            `${basePath}/artists`,
            developerToken,
            controller.signal,
            decodeArtist,
          ),
        ])
        if (albums.length === 0 && artists.length === 0) {
          throw new AppleCatalogError("invalid_response")
        }
        return { albums, artists }
      } catch (error) {
        controller.abort()
        throw error
      } finally {
        signal.removeEventListener("abort", abort)
      }
    })
  }

  async getAlbum(
    albumResourceId: string,
    options: Pick<SearchOptions, "signal"> = {},
  ): Promise<AppleCatalogAlbum> {
    if (!isResourceId(albumResourceId)) {
      throw new AppleCatalogError("invalid_request")
    }
    return this.requestCatalog(options, async (developerToken, signal) => {
      return this.requestAlbum(albumResourceId, developerToken, signal)
    })
  }

  async getArtist(
    artistResourceId: string,
    options: Pick<SearchOptions, "signal"> = {},
  ): Promise<AppleCatalogArtist> {
    if (!isResourceId(artistResourceId)) {
      throw new AppleCatalogError("invalid_request")
    }
    return this.requestCatalog(options, async (developerToken, signal) => {
      const url = new URL(
        `/v1/catalog/${this.storefront}/artists/${artistResourceId}`,
        APPLE_API_ORIGIN,
      )
      const artist = decodeArtist(
        decodeSingleResource(
          await this.requestAppleJson(url, developerToken, signal),
          "artists",
        ),
      )
      if (!artist) throw new AppleCatalogError("invalid_response")
      return artist
    })
  }

  async getArtistSection(
    artistResourceId: string,
    section: AppleArtistSectionName,
    options: SearchOptions = {},
  ): Promise<AppleArtistSectionPage> {
    if (
      !isResourceId(artistResourceId) ||
      !artistSectionNames.has(section)
    ) {
      throw new AppleCatalogError("invalid_request")
    }
    const path =
      `/v1/catalog/${this.storefront}/artists/${artistResourceId}/view/${section}`
    const url = options.cursor
      ? this.validateCursor(options.cursor, path)
      : collectionUrl(path, this.limit)
    return this.requestPage(url, path, options, false, (value, nextCursor) =>
      decodeArtistSectionPage(value, section, nextCursor)
    )
  }

  async getLiveRadioStations(
    options: Pick<SearchOptions, "signal"> = {},
  ): Promise<SearchPage<AppleCatalogStation>> {
    const path = `/v1/catalog/${this.storefront}/stations`
    const url = filteredCollectionUrl(
      path,
      "filter[featured]",
      "apple-music-live-radio",
    )
    return this.requestPage(url, path, options, false, decodeStationPage)
  }

  async getStationsByIds(
    stationResourceIds: readonly string[],
    options: Pick<SearchOptions, "signal"> = {},
  ): Promise<readonly AppleCatalogStation[]> {
    if (
      !Array.isArray(stationResourceIds) ||
      stationResourceIds.length < 1 ||
      stationResourceIds.length > MAX_LIMIT ||
      stationResourceIds.some((id) => !isResourceId(id)) ||
      new Set(stationResourceIds).size !== stationResourceIds.length
    ) {
      throw new AppleCatalogError("invalid_request")
    }
    const request = async (
      developerToken: string,
      signal: AbortSignal,
      musicUserToken?: string,
    ) => {
      const url = new URL(`/v1/catalog/${this.storefront}/stations`, APPLE_API_ORIGIN)
      url.searchParams.set("ids", stationResourceIds.join(","))
      const stations = decodeCollection(
        await this.requestAppleJson(url, developerToken, signal, musicUserToken),
        decodeStation,
      )
      const byId = new Map<string, AppleCatalogStation>()
      for (const station of stations) {
        const id = station.apple.resourceId
        if (!stationResourceIds.includes(id) || byId.has(id)) {
          throw new AppleCatalogError("invalid_response")
        }
        byId.set(id, station)
      }
      return stationResourceIds.flatMap((id) => {
        const station = byId.get(id)
        return station ? [station] : []
      })
    }
    return this.useMusicUserToken
      ? this.requestPersonalized(options, (developerToken, musicUserToken, signal) =>
          request(developerToken, signal, musicUserToken)
        )
      : this.requestCatalog(options, (developerToken, signal) =>
          request(developerToken, signal)
        )
  }

  async getStationGenres(
    options: Pick<SearchOptions, "signal"> = {},
  ): Promise<readonly AppleCatalogStationGenre[]> {
    const path = `/v1/catalog/${this.storefront}/station-genres`
    return this.requestCatalog(options, async (developerToken, signal) =>
      decodeCollection(
        await this.requestAppleJson(new URL(path, APPLE_API_ORIGIN), developerToken, signal),
        decodeStationGenre,
      )
    )
  }

  async getStationsForGenre(
    stationGenreResourceId: string,
    options: SearchOptions = {},
  ): Promise<SearchPage<AppleCatalogStation>> {
    if (!isResourceId(stationGenreResourceId)) {
      throw new AppleCatalogError("invalid_request")
    }
    const path =
      `/v1/catalog/${this.storefront}/station-genres/${stationGenreResourceId}/stations`
    const url = options.cursor
      ? this.validateCursor(options.cursor, path)
      : collectionUrl(path, this.limit)
    return this.requestPage(url, path, options, false, decodeStationPage)
  }

  async getPersonalStation(
    options: Pick<SearchOptions, "signal"> = {},
  ): Promise<AppleCatalogStation> {
    const path = `/v1/catalog/${this.storefront}/stations`
    const url = filteredCollectionUrl(path, "filter[identity]", "personal")
    return this.requestPersonalized(options, async (developerToken, musicUserToken, signal) => {
      return decodeSingleStation(
        await this.requestAppleJson(url, developerToken, signal, musicUserToken),
      )
    })
  }

  async getRecentlyPlayedStations(
    options: SearchOptions = {},
  ): Promise<SearchPage<AppleCatalogStation>> {
    const path = "/v1/me/recent/radio-stations"
    const url = options.cursor
      ? this.validateCursor(options.cursor, path)
      : collectionUrl(path, this.limit)
    return this.requestPage(url, path, options, true, decodeStationPage)
  }

  async getStationForResource(
    resourceType: "songs" | "artists",
    resourceId: string,
    options: Pick<SearchOptions, "signal"> = {},
  ): Promise<AppleCatalogStation> {
    if (
      (resourceType !== "songs" && resourceType !== "artists") ||
      !isResourceId(resourceId)
    ) {
      throw new AppleCatalogError("invalid_request")
    }
    return this.requestCatalog(options, async (developerToken, signal) => {
      const url = new URL(
        `/v1/catalog/${this.storefront}/${resourceType}/${resourceId}/station`,
        APPLE_API_ORIGIN,
      )
      return decodeSingleStation(
        await this.requestAppleJson(url, developerToken, signal),
      )
    })
  }

  async getRecommendedPlaylists(
    options: SearchOptions = {},
  ): Promise<SearchPage<AppleCatalogPlaylist>> {
    const page = await this.getHomeSections(options)
    return {
      items: page.items.flatMap((section) =>
        section.items.filter((item): item is AppleCatalogPlaylist =>
          item.apple.resourceType === "playlists"
        )
      ),
      nextCursor: page.nextCursor,
    }
  }

  async getHomeSections(
    options: SearchOptions = {},
  ): Promise<SearchPage<AppleHomeSection>> {
    const path = "/v1/me/recommendations"
    const url = options.cursor
      ? this.validateCursor(options.cursor, path)
      : collectionUrl(path, this.limit)
    return this.requestPage(url, path, options, true, (value, nextCursor) => ({
      items: decodeHomeSections(value),
      nextCursor,
    }))
  }

  getLibrarySongs(options: SearchOptions = {}): Promise<SearchPage<AppleLibrarySong>> {
    return this.getLibraryPage("/v1/me/library/songs", options, decodeLibrarySong)
  }

  getLibraryAlbums(options: SearchOptions = {}): Promise<SearchPage<AppleLibraryAlbum>> {
    return this.getLibraryPage("/v1/me/library/albums", options, decodeLibraryAlbum)
  }

  getLibraryArtists(options: SearchOptions = {}): Promise<SearchPage<AppleLibraryArtist>> {
    return this.getLibraryPage("/v1/me/library/artists", options, decodeLibraryArtist)
  }

  async getLibraryAlbumTracks(
    resourceId: string, options: SearchOptions = {},
  ): Promise<SearchPage<AppleLibrarySong>> {
    if (!isResourceId(resourceId)) throw new AppleCatalogError("invalid_request")
    const path = `/v1/me/library/albums/${resourceId}/tracks`
    const url = options.cursor
      ? this.validateCursor(options.cursor, path)
      : collectionUrl(path, this.limit)
    return this.requestPage(url, path, options, true, (value, nextCursor) => ({
      items: decodeLibraryAlbumTracks(value), nextCursor,
    }))
  }

  async getLibraryArtistAlbums(
    resourceId: string, options: SearchOptions = {},
  ): Promise<SearchPage<AppleLibraryAlbum>> {
    if (!isResourceId(resourceId)) throw new AppleCatalogError("invalid_request")
    return this.getLibraryPage(`/v1/me/library/artists/${resourceId}/albums`, options, decodeLibraryAlbum)
  }

  private async getLibraryPage<T>(
    path: string, options: SearchOptions, decode: (value: unknown) => T | null,
  ): Promise<SearchPage<T>> {
    const url = options.cursor
      ? this.validateCursor(options.cursor, path)
      : collectionUrl(path, this.limit)
    return this.requestPage(url, path, options, true, (value, nextCursor) => ({
      items: decodeCollection(value, decode), nextCursor,
    }))
  }

  async getLibraryPlaylists(
    options: SearchOptions = {},
  ): Promise<SearchPage<AppleLibraryPlaylist>> {
    const path = "/v1/me/library/playlists"
    const url = options.cursor
      ? this.validateCursor(options.cursor, path)
      : collectionUrl(path, this.limit)
    return this.requestPage(url, path, options, true, (value, nextCursor) => {
      const root = requireCollection(value)
      const items = root.data.map(decodeLibraryPlaylist)
      if (items.some((playlist) => playlist === null)) {
        throw new AppleCatalogError("invalid_response")
      }
      return { items: items as AppleLibraryPlaylist[], nextCursor }
    })
  }

  async getPlaylistTracks(
    playlist: ApplePlaylist,
    options: SearchOptions = {},
  ): Promise<SearchPage<AppleCatalogTrack>> {
    if (!playlist?.apple || !isResourceId(playlist.apple.resourceId)) {
      throw new AppleCatalogError("invalid_request")
    }
    const library = playlist.apple.resourceType === "library-playlists"
    if (!library && playlist.apple.resourceType !== "playlists") {
      throw new AppleCatalogError("invalid_request")
    }
    const path = library
      ? `/v1/me/library/playlists/${playlist.apple.resourceId}/tracks`
      : `/v1/catalog/${this.storefront}/playlists/${playlist.apple.resourceId}/tracks`
    const url = options.cursor
      ? this.validateCursor(options.cursor, path)
      : collectionUrl(path, this.limit)
    return this.requestPage(url, path, options, library, (value, nextCursor) => ({
      items: decodePlaylistTracks(value),
      nextCursor,
    }))
  }

  async getPersonalSongRating(
    songResourceId: string,
    options: Pick<SearchOptions, "signal"> = {},
  ): Promise<ApplePersonalSongRating | null> {
    return this.getPersonalRating("songs", songResourceId, options)
  }

  async setPersonalSongRating(
    songResourceId: string,
    rating: ApplePersonalSongRating,
    options: Pick<SearchOptions, "signal"> = {},
  ): Promise<void> {
    return this.setPersonalRating("songs", songResourceId, rating, options)
  }

  async deletePersonalSongRating(
    songResourceId: string,
    options: Pick<SearchOptions, "signal"> = {},
  ): Promise<void> {
    return this.deletePersonalRating("songs", songResourceId, options)
  }

  async getPersonalStationRating(
    stationResourceId: string,
    options: Pick<SearchOptions, "signal"> = {},
  ): Promise<ApplePersonalStationRating | null> {
    return this.getPersonalRating("stations", stationResourceId, options)
  }

  async setPersonalStationRating(
    stationResourceId: string,
    rating: ApplePersonalStationRating,
    options: Pick<SearchOptions, "signal"> = {},
  ): Promise<void> {
    return this.setPersonalRating("stations", stationResourceId, rating, options)
  }

  async deletePersonalStationRating(
    stationResourceId: string,
    options: Pick<SearchOptions, "signal"> = {},
  ): Promise<void> {
    return this.deletePersonalRating("stations", stationResourceId, options)
  }

  private async getPersonalRating(
    resourceType: ApplePersonalRatingResourceType,
    resourceId: string,
    options: Pick<SearchOptions, "signal">,
  ): Promise<ApplePersonalRating | null> {
    if (!isResourceId(resourceId)) throw new AppleCatalogError("invalid_request")
    return this.requestPersonalized(options, async (developerToken, musicUserToken, signal) => {
      const value = await this.transport.requestOptionalJson(
        new URL(`/v1/me/ratings/${resourceType}/${resourceId}`, APPLE_API_ORIGIN),
        developerToken,
        musicUserToken,
        signal,
      )
      return value === null ? null : decodePersonalRating(value, resourceId)
    })
  }

  private async setPersonalRating(
    resourceType: ApplePersonalRatingResourceType,
    resourceId: string,
    rating: ApplePersonalRating,
    options: Pick<SearchOptions, "signal">,
  ): Promise<void> {
    if (!isResourceId(resourceId) || (rating !== -1 && rating !== 1)) {
      throw new AppleCatalogError("invalid_request")
    }
    return this.requestPersonalized(options, async (developerToken, musicUserToken, signal) => {
      await this.transport.requestRatingUpdate(
        new URL(`/v1/me/ratings/${resourceType}/${resourceId}`, APPLE_API_ORIGIN),
        "PUT",
        developerToken,
        musicUserToken,
        signal,
        rating,
      )
    })
  }

  private async deletePersonalRating(
    resourceType: ApplePersonalRatingResourceType,
    resourceId: string,
    options: Pick<SearchOptions, "signal">,
  ): Promise<void> {
    if (!isResourceId(resourceId)) throw new AppleCatalogError("invalid_request")
    return this.requestPersonalized(options, async (developerToken, musicUserToken, signal) => {
      await this.transport.requestRatingUpdate(
        new URL(`/v1/me/ratings/${resourceType}/${resourceId}`, APPLE_API_ORIGIN),
        "DELETE",
        developerToken,
        musicUserToken,
        signal,
      )
    })
  }

  private async requestCatalog<T>(
    options: Pick<SearchOptions, "signal">,
    operation: (developerToken: string, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.transport.requestCatalog(options, operation)
    } catch (error) {
      this.logRequestFailure(error)
      throw error
    }
  }

  private async requestPersonalized<T>(
    options: Pick<SearchOptions, "signal">,
    operation: (
      developerToken: string,
      musicUserToken: string,
      signal: AbortSignal,
    ) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.transport.requestPersonalized(options, operation)
    } catch (error) {
      this.logRequestFailure(error)
      throw error
    }
  }

  private async requestAlbum(
    albumResourceId: string,
    developerToken: string,
    signal: AbortSignal,
  ): Promise<AppleCatalogAlbum> {
    const albumPath = `/v1/catalog/${this.storefront}/albums/${albumResourceId}`
    const tracksPath = `${albumPath}/tracks`
    const url = new URL(albumPath, APPLE_API_ORIGIN)
    url.searchParams.set("include", "tracks")
    const resource = decodeSingleResource(
      await this.requestAppleJson(url, developerToken, signal),
      "albums",
    )
    const album = decodeAlbum(resource)
    const next = this.decodeRelationshipNextCursor(resource, "tracks", tracksPath)
    const tracks = await this.pagination.collectPages({
      initialItems: album.tracks,
      initialUrl: next ? new URL(next, APPLE_API_ORIGIN) : null,
      expectedPath: tracksPath,
      request: (pageUrl) => this.requestAppleJson(pageUrl, developerToken, signal),
      decode: decodeCatalogTracks,
    })
    return { ...album, tracks }
  }

  private async requestRelationship<T extends { id: string }>(
    path: string,
    developerToken: string,
    signal: AbortSignal,
    decode: (value: unknown) => T | null,
  ): Promise<readonly T[]> {
    return this.pagination.collectPages({
      initialUrl: collectionUrl(path, Math.min(this.limit, 10)),
      expectedPath: path,
      request: (url) => this.requestAppleJson(url, developerToken, signal),
      decode: (value) => decodeCollection(value, decode),
    })
  }

  private async requestAppleJson(
    url: URL,
    developerToken: string,
    signal: AbortSignal,
    musicUserToken?: string,
  ): Promise<unknown> {
    return this.transport.requestJson(url, developerToken, signal, musicUserToken)
  }

  private async requestPage<T>(
    url: URL,
    expectedPath: string,
    options: SearchOptions,
    personalized: boolean,
    decode: (value: unknown, nextCursor: string | null) => T,
  ): Promise<T> {
    const request = async (
      developerToken: string,
      signal: AbortSignal,
      musicUserToken?: string,
    ) => {
      const value = await this.requestAppleJson(url, developerToken, signal, musicUserToken)
      return decode(value, this.pagination.decodeNextCursor(value, expectedPath))
    }
    return personalized
      ? this.requestPersonalized(
          options,
          (developerToken, musicUserToken, signal) =>
            request(developerToken, signal, musicUserToken),
        )
      : this.requestCatalog(
          options,
          (developerToken, signal) => request(developerToken, signal),
        )
  }

  private buildSearchUrl(
    term: string,
    resourceType: "songs" | "stations",
  ): URL {
    return this.pagination.buildSearchUrl(term, resourceType)
  }

  private validateSearchCursor(
    cursor: string,
    resourceType: "songs" | "stations",
    term: string,
  ): URL {
    return this.pagination.validateSearchCursor(cursor, resourceType, term)
  }

  private validateCursor(cursor: string, expectedPath: string): URL {
    return this.pagination.validateCursor(cursor, expectedPath)
  }

  private decodeRelationshipNextCursor(
    resource: Record<string, unknown>,
    relationshipName: string,
    expectedPath: string,
  ): string | null {
    return this.pagination.decodeRelationshipNextCursor(
      resource,
      relationshipName,
      expectedPath,
    )
  }

  private decodeSearchResponse<T>(
    value: unknown,
    resourceType: "songs" | "stations",
    term: string,
    decode: (value: unknown) => T | null,
  ): SearchPage<T> {
    return decodeCatalogSearchResponse(value, resourceType, term, decode, this.pagination)
  }

  private logRequestFailure(error: unknown): void {
    this.logger.log("catalog_request_failed", {
      code: error instanceof AppleCatalogError ? error.code : "unavailable",
    })
  }
}
