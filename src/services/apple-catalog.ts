import type {
  AppleAlbumDetails,
  AppleCatalogAlbum,
  AppleCatalogPlaylist,
  AppleCatalogTrack,
  AppleAudioTrait,
  AppleContentRating,
  AppleLibraryPlaylist,
  ApplePlaylist,
  ApplePlaylistDetails,
  AppleTrackDetails,
  AudioQuality,
  MusicProvider,
  SearchOptions,
  SearchPage,
} from "../core/types"
import {
  requestDeveloperToken,
  runWithAbortTimeout,
  type Fetch,
} from "./token-service"

const APPLE_API_ORIGIN = "https://api.music.apple.com"
const DEFAULT_LIMIT = 25
const MAX_LIMIT = 25
const MAX_QUERY_LENGTH = 200
const MAX_CURSOR_LENGTH = 8 * 1024
const MAX_RESPONSE_BYTES = 512 * 1024
const MAX_AUDIO_TRAITS = 16
const MAX_GENRES = 24

const knownAudioTraits = new Set<AppleAudioTrait>([
  "atmos",
  "dolby-atmos",
  "dolby-audio",
  "hi-res-lossless",
  "lossless",
  "lossy-stereo",
  "spatial",
])

export type AppleCatalogErrorCode =
  | "invalid_request"
  | "unavailable"
  | "invalid_response"
  | "aborted"
  | "timeout"

export class AppleCatalogError extends Error {
  constructor(readonly code: AppleCatalogErrorCode) {
    const messages: Record<AppleCatalogErrorCode, string> = {
      invalid_request: "Apple catalog request is invalid",
      unavailable: "Apple catalog is unavailable",
      invalid_response: "Apple catalog returned an invalid response",
      aborted: "Apple catalog search was aborted",
      timeout: "Apple catalog search timed out",
    }
    super(messages[code])
    this.name = "AppleCatalogError"
  }
}

export interface AppleCatalogProviderOptions {
  fetch?: Fetch
  timeoutMs?: number
  limit?: number
  useMusicUserToken?: <T>(
    use: (musicUserToken: string) => T | Promise<T>,
  ) => Promise<T>
}

export class AppleCatalogProvider implements MusicProvider<AppleCatalogTrack> {
  readonly id = "apple"
  readonly displayName = "Apple Music"

  private readonly fetchImpl: Fetch
  private readonly timeoutMs: number | undefined
  private readonly limit: number
  private readonly searchPath: string
  private readonly useMusicUserToken: AppleCatalogProviderOptions["useMusicUserToken"]

  constructor(
    private readonly serviceUrl: string,
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

    this.fetchImpl = options.fetch ?? fetch
    this.timeoutMs = options.timeoutMs
    this.limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
    this.searchPath = `/v1/catalog/${storefront}/search`
    this.useMusicUserToken = options.useMusicUserToken
  }

  async searchSongs(
    query: string,
    options: SearchOptions = {},
  ): Promise<SearchPage<AppleCatalogTrack>> {
    const term = validateQuery(query)
    const url = options.cursor
      ? this.validateCursor(options.cursor, this.searchPath)
      : this.buildSearchUrl(term)

    try {
      return await runWithAbortTimeout(
        async (signal) => {
          const developer = await requestDeveloperToken(
            this.serviceUrl,
            this.fetchImpl,
            { signal, timeoutMs: this.timeoutMs },
          )
          if (developer.mode !== "apple") {
            throw new AppleCatalogError("unavailable")
          }

          const response = await this.fetchImpl(url, {
            method: "GET",
            headers: {
              accept: "application/json",
              authorization: `Bearer ${developer.token}`,
            },
            redirect: "manual",
            signal,
          })
          if (!response.ok) throw new AppleCatalogError("unavailable")
          return this.decodeResponse(await readBoundedJson(response))
        },
        { signal: options.signal, timeoutMs: this.timeoutMs },
      )
    } catch (error) {
      if (error instanceof AppleCatalogError) throw error
      if (error instanceof Error && error.message === "Operation aborted") {
        throw new AppleCatalogError("aborted")
      }
      if (error instanceof Error && error.message === "Operation timed out") {
        throw new AppleCatalogError("timeout")
      }
      throw new AppleCatalogError("unavailable")
    }
  }

  async getAlbumForSong(
    songResourceId: string,
    options: Pick<SearchOptions, "signal"> = {},
  ): Promise<AppleCatalogAlbum> {
    if (!isResourceId(songResourceId)) {
      throw new AppleCatalogError("invalid_request")
    }

    try {
      return await runWithAbortTimeout(
        async (signal) => {
          const developer = await requestDeveloperToken(
            this.serviceUrl,
            this.fetchImpl,
            { signal, timeoutMs: this.timeoutMs },
          )
          if (developer.mode !== "apple") {
            throw new AppleCatalogError("unavailable")
          }

          const songUrl = new URL(
            `/v1/catalog/${this.storefront}/songs/${songResourceId}`,
            APPLE_API_ORIGIN,
          )
          songUrl.searchParams.set("include", "albums")
          const song = decodeSingleResource(
            await this.requestAppleJson(songUrl, developer.token, signal),
            "songs",
          )
          const albumId = decodeRelationshipId(song, "albums", "albums")
          if (!albumId) throw new AppleCatalogError("invalid_response")

          const albumUrl = new URL(
            `/v1/catalog/${this.storefront}/albums/${albumId}`,
            APPLE_API_ORIGIN,
          )
          albumUrl.searchParams.set("include", "tracks")
          return decodeAlbum(
            decodeSingleResource(
              await this.requestAppleJson(albumUrl, developer.token, signal),
              "albums",
            ),
          )
        },
        { signal: options.signal, timeoutMs: this.timeoutMs },
      )
    } catch (error) {
      if (error instanceof AppleCatalogError) throw error
      if (error instanceof Error && error.message === "Operation aborted") {
        throw new AppleCatalogError("aborted")
      }
      if (error instanceof Error && error.message === "Operation timed out") {
        throw new AppleCatalogError("timeout")
      }
      throw new AppleCatalogError("unavailable")
    }
  }

  async getRecommendedPlaylists(
    options: SearchOptions = {},
  ): Promise<SearchPage<AppleCatalogPlaylist>> {
    const path = "/v1/me/recommendations"
    const url = options.cursor
      ? this.validateCursor(options.cursor, path)
      : collectionUrl(path, this.limit)
    return this.requestPage(url, path, options, true, (value, nextCursor) => ({
      items: decodeRecommendedPlaylists(value),
      nextCursor,
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

  private async requestAppleJson(
    url: URL,
    developerToken: string,
    signal: AbortSignal,
    musicUserToken?: string,
  ): Promise<unknown> {
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${developerToken}`,
        ...(musicUserToken ? { "music-user-token": musicUserToken } : {}),
      },
      redirect: "manual",
      signal,
    })
    if (!response.ok) throw new AppleCatalogError("unavailable")
    return readBoundedJson(response)
  }

  private async requestPage<T>(
    url: URL,
    expectedPath: string,
    options: SearchOptions,
    personalized: boolean,
    decode: (value: unknown, nextCursor: string | null) => SearchPage<T>,
  ): Promise<SearchPage<T>> {
    try {
      return await runWithAbortTimeout(
        async (signal) => {
          const developer = await requestDeveloperToken(
            this.serviceUrl,
            this.fetchImpl,
            { signal, timeoutMs: this.timeoutMs },
          )
          if (developer.mode !== "apple") throw new AppleCatalogError("unavailable")
          const request = async (musicUserToken?: string) => {
            const value = await this.requestAppleJson(
              url,
              developer.token,
              signal,
              musicUserToken,
            )
            const nextCursor = this.decodeNextCursor(value, expectedPath)
            return decode(value, nextCursor)
          }
          if (!personalized) return request()
          if (!this.useMusicUserToken) throw new AppleCatalogError("unavailable")
          return this.useMusicUserToken((musicUserToken) => request(musicUserToken))
        },
        { signal: options.signal, timeoutMs: this.timeoutMs },
      )
    } catch (error) {
      if (error instanceof AppleCatalogError) throw error
      if (error instanceof Error && error.message === "Operation aborted") {
        throw new AppleCatalogError("aborted")
      }
      if (error instanceof Error && error.message === "Operation timed out") {
        throw new AppleCatalogError("timeout")
      }
      throw new AppleCatalogError("unavailable")
    }
  }

  private buildSearchUrl(term: string): URL {
    const url = new URL(this.searchPath, APPLE_API_ORIGIN)
    url.search = new URLSearchParams({
      term,
      types: "songs",
      limit: String(this.limit),
    }).toString()
    return url
  }

  private validateCursor(cursor: string, expectedPath: string): URL {
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
    ) {
      throw new AppleCatalogError("invalid_request")
    }
    return url
  }

  private decodeNextCursor(value: unknown, expectedPath: string): string | null {
    const root = requireCollection(value)
    if (root.next === undefined) return null
    if (typeof root.next !== "string") {
      throw new AppleCatalogError("invalid_response")
    }
    try {
      this.validateCursor(root.next, expectedPath)
    } catch {
      throw new AppleCatalogError("invalid_response")
    }
    return root.next
  }

  private decodeResponse(value: unknown): SearchPage<AppleCatalogTrack> {
    const root = asRecord(value)
    const results = root && asRecord(root.results)
    if (!results) throw new AppleCatalogError("invalid_response")

    if (results.songs === undefined) return { items: [], nextCursor: null }
    const songs = asRecord(results.songs)
    if (!songs || !Array.isArray(songs.data)) {
      throw new AppleCatalogError("invalid_response")
    }

    let nextCursor: string | null = null
    if (songs.next !== undefined) {
      if (typeof songs.next !== "string") {
        throw new AppleCatalogError("invalid_response")
      }
      try {
        this.validateCursor(songs.next, this.searchPath)
      } catch {
        throw new AppleCatalogError("invalid_response")
      }
      nextCursor = songs.next
    }

    const items = songs.data.map(decodeSong)
    if (items.some((track) => track === null)) {
      throw new AppleCatalogError("invalid_response")
    }
    return {
      items: items as AppleCatalogTrack[],
      nextCursor,
    }
  }
}

function collectionUrl(path: string, limit: number): URL {
  const url = new URL(path, APPLE_API_ORIGIN)
  url.searchParams.set("limit", String(limit))
  return url
}

function requireCollection(
  value: unknown,
): Record<string, unknown> & { data: unknown[] } {
  const root = asRecord(value)
  if (!root || !Array.isArray(root.data)) {
    throw new AppleCatalogError("invalid_response")
  }
  return root as Record<string, unknown> & { data: unknown[] }
}

function decodeRecommendedPlaylists(value: unknown): AppleCatalogPlaylist[] {
  const root = requireCollection(value)
  const playlists: AppleCatalogPlaylist[] = []
  const knownIds = new Set<string>()
  for (const entry of root.data) {
    const recommendation = asRecord(entry)
    const attributes = recommendation && asRecord(recommendation.attributes)
    const title = attributes && asRecord(attributes.title)
    const relationships = recommendation && asRecord(recommendation.relationships)
    const contents = relationships && asRecord(relationships.contents)
    if (
      !recommendation ||
      recommendation.type !== "personal-recommendation" ||
      !isResourceId(recommendation.id) ||
      !title ||
      !isDisplayString(title.stringForDisplay, 200) ||
      !contents ||
      !Array.isArray(contents.data)
    ) {
      throw new AppleCatalogError("invalid_response")
    }
    for (const content of contents.data) {
      const resource = asRecord(content)
      if (resource?.type !== "playlists") continue
      const playlist = decodeCatalogPlaylist(resource)
      if (!playlist) throw new AppleCatalogError("invalid_response")
      if (!knownIds.has(playlist.apple.resourceId)) {
        knownIds.add(playlist.apple.resourceId)
        playlists.push(playlist)
      }
    }
  }
  return playlists
}

function decodeCatalogPlaylist(value: unknown): AppleCatalogPlaylist | null {
  const resource = asRecord(value)
  const attributes = resource && asRecord(resource.attributes)
  if (
    !resource ||
    resource.type !== "playlists" ||
    !isResourceId(resource.id) ||
    !attributes ||
    !isDisplayString(attributes.name, 300)
  ) {
    return null
  }
  const curator = isDisplayString(attributes.curatorName, 300)
    ? attributes.curatorName
    : "Apple Music"
  const description = decodeDescription(attributes.description)
  const artwork = decodeArtwork(attributes.artwork)
  const details = decodePlaylistDetails(attributes, false)
  return {
    id: `apple:playlist:${resource.id}`,
    title: attributes.name,
    curator,
    ...(description ? { description } : {}),
    apple: {
      resourceId: resource.id,
      resourceType: "playlists",
      ...(artwork ? { artwork } : {}),
      ...(details ? { details } : {}),
    },
  }
}

function decodeLibraryPlaylist(value: unknown): AppleLibraryPlaylist | null {
  const resource = asRecord(value)
  const attributes = resource && asRecord(resource.attributes)
  if (
    !resource ||
    resource.type !== "library-playlists" ||
    !isResourceId(resource.id) ||
    !attributes ||
    !isDisplayString(attributes.name, 300)
  ) {
    return null
  }
  const playParams = asRecord(attributes.playParams)
  const globalId = playParams && isResourceId(playParams.globalId)
    ? playParams.globalId
    : undefined
  const description = decodeDescription(attributes.description)
  const artwork = decodeArtwork(attributes.artwork)
  const details = decodePlaylistDetails(attributes, true)
  return {
    id: `apple:library-playlist:${resource.id}`,
    title: attributes.name,
    curator: "Your Library",
    ...(description ? { description } : {}),
    apple: {
      resourceId: resource.id,
      resourceType: "library-playlists",
      ...(globalId ? { globalId } : {}),
      ...(artwork ? { artwork } : {}),
      ...(details ? { details } : {}),
    },
  }
}

function decodePlaylistTracks(value: unknown): AppleCatalogTrack[] {
  const root = requireCollection(value)
  const tracks: AppleCatalogTrack[] = []
  const knownIds = new Set<string>()
  for (const entry of root.data) {
    const resource = asRecord(entry)
    if (resource?.type === "music-videos" || resource?.type === "library-music-videos") {
      continue
    }
    const track = resource?.type === "library-songs"
      ? decodeLibrarySong(resource)
      : decodeSong(resource)
    if (track && !knownIds.has(track.id)) {
      knownIds.add(track.id)
      tracks.push(track)
    } else if (resource?.type !== "library-songs") {
      throw new AppleCatalogError("invalid_response")
    }
  }
  return tracks
}

function decodeLibrarySong(resource: Record<string, unknown>): AppleCatalogTrack | null {
  const attributes = asRecord(resource.attributes)
  const playParams = attributes && asRecord(attributes.playParams)
  if (
    resource.type !== "library-songs" ||
    !isResourceId(resource.id) ||
    !attributes ||
    !playParams ||
    !isResourceId(playParams.catalogId)
  ) {
    return null
  }
  return decodeSong({
    ...resource,
    id: playParams.catalogId,
    type: "songs",
    attributes: {
      ...attributes,
      playParams: { id: playParams.catalogId, kind: "song" },
    },
  })
}

function decodeDescription(value: unknown): string | undefined {
  const description = asRecord(value)
  if (!description) return undefined
  if (isDisplayString(description.standard, 2_000)) return description.standard
  return isDisplayString(description.short, 500) ? description.short : undefined
}

function decodeTrackDetails(
  attributes: Record<string, unknown>,
): AppleTrackDetails | undefined {
  const releaseDate = optionalDisplayString(attributes.releaseDate, 64)
  const genreNames = decodeDisplayStrings(attributes.genreNames)
  const trackNumber = decodePositiveInteger(attributes.trackNumber)
  const discNumber = decodePositiveInteger(attributes.discNumber)
  const composerName = optionalDisplayString(attributes.composerName, 500)
  const contentRating = decodeContentRating(attributes.contentRating)
  const editorialNotes = decodeDescription(attributes.editorialNotes)
  const hasLyrics = decodeBoolean(attributes.hasLyrics)
  const isAppleDigitalMaster = decodeBoolean(attributes.isAppleDigitalMaster)
  return populated({
    ...(releaseDate ? { releaseDate } : {}),
    ...(genreNames ? { genreNames } : {}),
    ...(trackNumber ? { trackNumber } : {}),
    ...(discNumber ? { discNumber } : {}),
    ...(composerName ? { composerName } : {}),
    ...(contentRating ? { contentRating } : {}),
    ...(editorialNotes ? { editorialNotes } : {}),
    ...(hasLyrics !== undefined ? { hasLyrics } : {}),
    ...(isAppleDigitalMaster !== undefined ? { isAppleDigitalMaster } : {}),
  })
}

function decodeAlbumDetails(
  attributes: Record<string, unknown>,
): AppleAlbumDetails | undefined {
  const releaseDate = optionalDisplayString(attributes.releaseDate, 64)
  const genreNames = decodeDisplayStrings(attributes.genreNames)
  const trackCount = decodePositiveInteger(attributes.trackCount)
  const recordLabel = optionalDisplayString(attributes.recordLabel, 500)
  const copyright = optionalDisplayString(attributes.copyright, 1_000)
  const contentRating = decodeContentRating(attributes.contentRating)
  const editorialNotes = decodeDescription(attributes.editorialNotes)
  const isCompilation = decodeBoolean(attributes.isCompilation)
  const isSingle = decodeBoolean(attributes.isSingle)
  return populated({
    ...(releaseDate ? { releaseDate } : {}),
    ...(genreNames ? { genreNames } : {}),
    ...(trackCount ? { trackCount } : {}),
    ...(recordLabel ? { recordLabel } : {}),
    ...(copyright ? { copyright } : {}),
    ...(contentRating ? { contentRating } : {}),
    ...(editorialNotes ? { editorialNotes } : {}),
    ...(isCompilation !== undefined ? { isCompilation } : {}),
    ...(isSingle !== undefined ? { isSingle } : {}),
  })
}

function decodePlaylistDetails(
  attributes: Record<string, unknown>,
  library: boolean,
): ApplePlaylistDetails | undefined {
  const lastModifiedDate = optionalDisplayString(attributes.lastModifiedDate, 64)
  const dateAdded = optionalDisplayString(attributes.dateAdded, 64)
  const playlistType = optionalDisplayString(attributes.playlistType, 64)
  const isChart = decodeBoolean(attributes.isChart)
  const canEdit = decodeBoolean(attributes.canEdit)
  const isPublic = decodeBoolean(attributes.isPublic)
  const hasCatalog = decodeBoolean(attributes.hasCatalog)
  return populated({
    ...(!library && lastModifiedDate ? { lastModifiedDate } : {}),
    ...(library && dateAdded ? { dateAdded } : {}),
    ...(!library && playlistType ? { playlistType } : {}),
    ...(!library && isChart !== undefined ? { isChart } : {}),
    ...(library && canEdit !== undefined ? { canEdit } : {}),
    ...(library && isPublic !== undefined ? { isPublic } : {}),
    ...(library && hasCatalog !== undefined ? { hasCatalog } : {}),
  })
}

function optionalDisplayString(value: unknown, maxLength: number): string | undefined {
  return isDisplayString(value, maxLength) ? value : undefined
}

function decodeDisplayStrings(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_GENRES) {
    return undefined
  }
  if (value.some((item) => !isDisplayString(item, 100))) return undefined
  return value as string[]
}

function decodePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined
}

function decodeBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function decodeContentRating(value: unknown): AppleContentRating | undefined {
  return value === "clean" || value === "explicit" ? value : undefined
}

function populated<T extends object>(value: T): T | undefined {
  return Object.keys(value).length > 0 ? value : undefined
}

function validateQuery(query: string): string {
  if (typeof query !== "string") throw new AppleCatalogError("invalid_request")
  const term = query.trim()
  if (
    term.length === 0 ||
    term.length > MAX_QUERY_LENGTH ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(term)
  ) {
    throw new AppleCatalogError("invalid_request")
  }
  return term
}

function decodeSong(value: unknown): AppleCatalogTrack | null {
  const resource = asRecord(value)
  const attributes = resource && asRecord(resource.attributes)
  if (
    !resource ||
    resource.type !== "songs" ||
    !isResourceId(resource.id) ||
    !attributes ||
    !isNonEmptyString(attributes.name) ||
    !isNonEmptyString(attributes.artistName) ||
    !isNonEmptyString(attributes.albumName) ||
    typeof attributes.durationInMillis !== "number" ||
    !Number.isFinite(attributes.durationInMillis) ||
    attributes.durationInMillis < 0
  ) {
    return null
  }

  const artwork = decodeArtwork(attributes.artwork)
  const playParams = decodePlayParams(attributes.playParams, resource.id)
  const audioTraits = decodeAudioTraits(attributes.audioTraits)
  const audioQuality = audioTraits && catalogAudioQuality(audioTraits)
  const details = decodeTrackDetails(attributes)
  return {
    id: `apple:song:${resource.id}`,
    title: attributes.name,
    artist: attributes.artistName,
    album: attributes.albumName,
    durationSeconds: attributes.durationInMillis / 1000,
    ...(audioQuality ? { audioQuality } : {}),
    apple: {
      resourceId: resource.id,
      resourceType: "songs",
      ...(playParams ? { playParams } : {}),
      ...(artwork ? { artwork } : {}),
      ...(audioTraits ? { audioTraits } : {}),
      ...(details ? { details } : {}),
    },
  }
}

function decodeAudioTraits(value: unknown): readonly AppleAudioTrait[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > MAX_AUDIO_TRAITS) return undefined
  if (value.some((trait) => typeof trait !== "string" || trait.length > 64)) {
    return undefined
  }
  const traits = [...new Set(
    value.filter((trait): trait is AppleAudioTrait =>
      knownAudioTraits.has(trait as AppleAudioTrait)
    ),
  )]
  return traits.length > 0 ? traits : undefined
}

function catalogAudioQuality(traits: readonly AppleAudioTrait[]): AudioQuality | undefined {
  if (traits.includes("atmos") || traits.includes("dolby-atmos")) {
    return { format: "dolby-atmos", source: "catalog" }
  }
  if (traits.includes("hi-res-lossless")) {
    return { format: "hi-res-lossless", source: "catalog" }
  }
  if (traits.includes("lossless")) {
    return { format: "lossless", source: "catalog" }
  }
  if (traits.includes("dolby-audio")) {
    return { format: "dolby-audio", source: "catalog" }
  }
  if (traits.includes("spatial")) {
    return { format: "spatial-audio", source: "catalog" }
  }
  if (traits.includes("lossy-stereo")) {
    return { format: "stereo", source: "catalog" }
  }
  return undefined
}

function decodeSingleResource(
  value: unknown,
  resourceType: "songs" | "albums",
): Record<string, unknown> {
  const root = asRecord(value)
  if (!root || !Array.isArray(root.data) || root.data.length !== 1) {
    throw new AppleCatalogError("invalid_response")
  }
  const resource = asRecord(root.data[0])
  if (
    !resource ||
    resource.type !== resourceType ||
    !isResourceId(resource.id)
  ) {
    throw new AppleCatalogError("invalid_response")
  }
  return resource
}

function decodeRelationshipId(
  resource: Record<string, unknown>,
  relationshipName: string,
  resourceType: "albums",
): string | null {
  const relationships = asRecord(resource.relationships)
  const relationship = relationships && asRecord(relationships[relationshipName])
  if (!relationship || !Array.isArray(relationship.data) || relationship.data.length < 1) {
    return null
  }
  const related = asRecord(relationship.data[0])
  return related && related.type === resourceType && isResourceId(related.id)
    ? related.id
    : null
}

function decodeAlbum(resource: Record<string, unknown>): AppleCatalogAlbum {
  const attributes = asRecord(resource.attributes)
  const relationships = asRecord(resource.relationships)
  const tracks = relationships && asRecord(relationships.tracks)
  if (
    !isResourceId(resource.id) ||
    !attributes ||
    !isNonEmptyString(attributes.name) ||
    !isNonEmptyString(attributes.artistName) ||
    !tracks ||
    !Array.isArray(tracks.data)
  ) {
    throw new AppleCatalogError("invalid_response")
  }
  const decodedTracks = tracks.data.map(decodeSong)
  if (decodedTracks.some((track) => track === null)) {
    throw new AppleCatalogError("invalid_response")
  }
  const artwork = decodeArtwork(attributes.artwork)
  const details = decodeAlbumDetails(attributes)
  return {
    id: `apple:album:${resource.id}`,
    title: attributes.name,
    artist: attributes.artistName,
    tracks: decodedTracks as AppleCatalogTrack[],
    apple: {
      resourceId: resource.id,
      resourceType: "albums",
      ...(artwork ? { artwork } : {}),
      ...(details ? { details } : {}),
    },
  }
}

function decodeArtwork(value: unknown): AppleCatalogTrack["apple"]["artwork"] {
  const artwork = asRecord(value)
  if (!artwork || !isNonEmptyString(artwork.url)) return undefined
  const width = decodeDimension(artwork.width)
  const height = decodeDimension(artwork.height)
  if (width === undefined || height === undefined) return undefined
  return { url: artwork.url, width, height }
}

function decodeDimension(value: unknown): number | null | undefined {
  if (value === null) return null
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined
}

function decodePlayParams(
  value: unknown,
  resourceId: string,
): AppleCatalogTrack["apple"]["playParams"] {
  const playParams = asRecord(value)
  return playParams &&
    playParams.id === resourceId &&
    playParams.kind === "song"
    ? { id: playParams.id, kind: playParams.kind }
    : undefined
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
    throw new AppleCatalogError("invalid_response")
  }
  const contentLength = response.headers.get("content-length")
  if (contentLength !== null) {
    const declaredLength = Number(contentLength)
    if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > MAX_RESPONSE_BYTES) {
      throw new AppleCatalogError("invalid_response")
    }
  }

  const reader = response.body?.getReader()
  if (!reader) throw new AppleCatalogError("invalid_response")
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new AppleCatalogError("invalid_response")
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new AppleCatalogError("invalid_response")
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isDisplayString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
}

function isResourceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(value)
}
