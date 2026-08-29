import type { AppState, Destination } from "../../core/state"
import type {
  AppleCatalogAlbum,
  AppleCatalogTrack,
  ApplePlaylist,
  Track,
} from "../../core/types"
import type { AppleAuthStatus } from "../../services/apple-auth"
import { formatAudioQuality } from "../audio-quality"
import {
  formatDuration,
  playlistLandingUnavailable,
  playlistLoading,
} from "./browse"

export type InfoTarget =
  | {
      kind: "track"
      track: Track
      album?: AppleCatalogAlbum
      playlist?: ApplePlaylist
    }
  | { kind: "album"; album: AppleCatalogAlbum }
  | { kind: "playlist"; playlist: ApplePlaylist }

export function formatInfoTarget(target: InfoTarget): string {
  if (target.kind === "playlist") return formatPlaylistInfo(target.playlist)
  if (target.kind === "album") return formatAlbumInfo(target.album)

  const lines = formatTrackInfo(target.track)
  if (target.album) lines.push("", "ALBUM", ...formatAlbumInfo(target.album).split("\n"))
  if (target.playlist) {
    lines.push("", "PLAYLIST", ...formatPlaylistInfo(target.playlist).split("\n"))
  }
  return lines.join("\n")
}

export function appleAuthStatusLabel(status: AppleAuthStatus): string {
  switch (status.state) {
    case "signedOut":
      return "apple music  ○ signed out"
    case "restoring":
      return "apple music  ◌ restoring"
    case "connecting":
      return "apple music  ◌ connecting"
    case "authorizing":
      return "apple music  ◌ waiting"
    case "validating":
      return "apple music  ◌ validating"
    case "saving":
      return "apple music  ◌ saving login"
    case "signedIn":
      return `apple music  ● ${status.storefront}`
    case "signingOut":
      return "apple music  ◌ signing out"
    case "error":
      if (status.code === "credential_delete_failed") return "apple music  × sign out failed"
      if (status.code === "credential_load_failed") return "apple music  × keyring"
      if (status.code === "credential_save_failed") return "apple music  × save failed"
      return "apple music  × unavailable"
  }
}

export function compactAppleAuthStatusLabel(status: AppleAuthStatus): string {
  switch (status.state) {
    case "signedIn":
      return `apple ● ${status.storefront}`
    case "authorizing":
    case "connecting":
    case "validating":
    case "saving":
    case "restoring":
    case "signingOut":
      return "apple ◌ busy"
    case "signedOut":
      return "apple ○ out"
    case "error":
      if (status.code === "credential_delete_failed") return "apple × sign-out"
      if (status.code === "credential_load_failed") return "apple × keyring"
      if (status.code === "credential_save_failed") return "apple × save"
      return "apple × error"
  }
}

export function isAppleAuthProgress(status: AppleAuthStatus): boolean {
  return status.state === "connecting" ||
    status.state === "authorizing" ||
    status.state === "validating" ||
    status.state === "saving"
}

export function appleAuthProgressCopy(status: AppleAuthStatus): readonly string[] {
  switch (status.state) {
    case "connecting":
      return ["Starting a secure browser session...", "", "", "", "", "Please wait."]
    case "authorizing":
      return [
        "Continue in the browser window.",
        "Approve access with Apple Music.",
        "No pairing code is required.",
        "",
        "Return here after approval.",
        "Waiting for Apple Music...",
      ]
    case "validating":
      return ["Authorization received.", "Checking it with Apple Music...", "", "", "", "Please wait."]
    case "saving":
      return ["Authorization verified.", "Saving it to the system keyring...", "", "", "", "Please wait."]
    default:
      return []
  }
}

export function appleAuthSuccessCopy(status: AppleAuthStatus): readonly string[] {
  return status.state === "signedIn"
    ? [
        "Apple Music authorization succeeded.",
        `Storefront: ${status.storefront.toUpperCase()}`,
        "Your login is stored in the system keyring.",
        "",
        "The browser tab can now be closed.",
        "Press Enter to continue.",
      ]
    : []
}

export function destinationLabel(destination: Destination): string {
  return destination[0]!.toUpperCase() + destination.slice(1)
}

export function emptyMessage(
  destination: Destination,
  baseTrackCount: number,
  dynamicQueue = false,
): string {
  if (destination === "queue" && baseTrackCount === 0) {
    return dynamicQueue ? "radio continues as songs are chosen" : "queue is empty"
  }
  if (baseTrackCount === 0) {
    return destination === "search"
      ? "Apple Music search is not connected"
      : destination === "home"
        ? "Apple Music Home is not loaded yet"
        : destination === "playlists"
          ? "Apple Music playlists are not loaded yet"
          : "Apple Music library is not loaded yet"
  }
  return "no tracks match this filter"
}

export function searchEmptyMessage(search: {
  query: string
  status: "idle" | "loading" | "loadingMore" | "ready" | "error"
}): string {
  switch (search.status) {
    case "idle":
      return "Type a search and press Enter"
    case "loading":
    case "loadingMore":
      return "Searching Apple Music..."
    case "error":
      return "Apple Music search is unavailable"
    case "ready":
      return search.query ? `No songs found for ${search.query}` : "No songs found"
  }
}

export function footerHelp(state: AppState, width = 120): string {
  if (state.mode.type === "palette") return "type commands   ↑/↓ move   enter run   esc close"
  if (state.mode.type === "help") return "? or esc close   ctrl+p commands"
  if (state.mode.type === "search") return "type query   enter search Apple Music   esc cancel"
  if (state.mode.type === "filter") return "type filter   ↑/↓ move   enter apply   esc cancel"
  if (state.mode.pendingKey === "g") {
    return "n now playing   h home   l library   p playlists   r radio   s search   q queue"
  }
  if (width < 64) return "↑↓ move  enter play  l like  ←→ seek"
  if (width < 100) return "j/k move  enter play  l like  b/s/n transport  r repeat"
  return "j/k move  enter play  l like  b/s/n transport  r repeat  space pause  ←/→ seek  / filter  ctrl+p commands"
}

export function searchFooterHelp(hasMore: boolean, width: number): string {
  if (width < 64) return hasMore ? "enter play  l like  m more" : "enter play  l like"
  return hasMore
    ? "enter play   i info   l like   g s search   a album   m more"
    : "enter play   i info   l like   g s search   a album"
}

export function radioFooterHelp(
  hasMore: boolean,
  stationSelected: boolean,
  favorite: boolean,
  unavailable: boolean,
  width: number,
): string {
  if (!stationSelected) return hasMore
    ? "enter browse   / search stations   m more"
    : "enter browse   / search stations"
  const action = favorite ? "unfavorite" : "favorite"
  if (unavailable) return width < 64
    ? `unavailable in MusicKit  f ${action}`
    : `Apple Music cannot play this external radio stream   f ${action}`
  if (width < 64) return hasMore
    ? `enter play  f ${action}  / search  m more`
    : `enter play  f ${action}  / search`
  return hasMore
    ? `enter play or browse   f ${action}   / search stations   m more   ctrl+p commands`
    : `enter play or browse   f ${action}   / search stations   ctrl+p commands`
}

export function albumFooterHelp(width: number): string {
  return width < 64
    ? "enter play  l like  esc back"
    : "enter play   i info   l like   space pause   esc search results   g s search"
}

export function playlistFooterHelp(
  hasMore: boolean,
  width: number,
  destination: Destination,
): string {
  if (width < 64) return hasMore ? "enter open  i info  m more" : "enter open  i info"
  const back = destination === "playlists" ? "   esc home" : ""
  return hasMore
    ? `enter open playlist   i info   / filter   m load more${back}`
    : `enter open playlist   i info   / filter${back}`
}

export function homeFooterHelp(
  hasMore: boolean,
  stationSelected: boolean,
  favorite: boolean,
  unavailable: boolean,
  width: number,
): string {
  if (!stationSelected) return playlistFooterHelp(hasMore, width, "home")
  const action = favorite ? "unfavorite" : "favorite"
  if (unavailable) return width < 64
    ? `unavailable in MusicKit  f ${action}`
    : `Apple Music cannot play this external radio stream   f ${action}`
  if (width < 64) return hasMore
    ? `enter play  f ${action}  m more`
    : `enter play  f ${action}`
  return hasMore
    ? `enter play station   f ${action}   / filter   m load more`
    : `enter play station   f ${action}   / filter`
}

export function playlistDetailFooterHelp(hasMore: boolean, width: number): string {
  if (width < 64) return hasMore ? "enter play  l like  m more" : "enter play  l like"
  return hasMore
    ? "enter play   i info   l like   space pause   / filter   m more   esc back"
    : "enter play   i info   l like   space pause   / filter   esc back"
}

export function playlistEmptyMessage(
  destination: Destination,
  state: { status: string },
  loadedCount: number,
): string {
  if (state.status === "idle") {
    return destination === "home"
      ? "Apple Music Home is not loaded yet"
      : "Apple Music playlists are not loaded yet"
  }
  if (playlistLoading(state)) {
    return destination === "home"
      ? "Loading Apple Music Home..."
      : "Loading Apple Music playlists..."
  }
  if (playlistLandingUnavailable(state, loadedCount)) {
    return destination === "home"
      ? "Apple Music Home is unavailable"
      : "Apple Music playlists are unavailable"
  }
  if (loadedCount > 0) return "No playlists match this filter"
  return destination === "home" ? "No recommendations found" : "No playlists found"
}

export function playlistTrackEmptyMessage(
  status: "loading" | "ready" | "loadingMore" | "error",
): string {
  if (status === "loading") return "Loading playlist..."
  if (status === "error") return "Apple Music playlist is unavailable · esc back"
  return "This playlist has no playable songs"
}

export function albumEmptyMessage(status: "loading" | "ready" | "error"): string {
  if (status === "loading") return "Loading album..."
  if (status === "error") return "Apple Music album is unavailable · esc back"
  return "This album has no tracks"
}

export function playbackErrorMessage(errorCode: string): string {
  if (errorCode === "authorization_rejected" || errorCode === "authorization_invalid") {
    return "Apple Music playback authorization is required"
  }
  if (errorCode === "worker_crashed" || errorCode === "worker_exited") {
    return "the playback worker stopped; press Enter to retry"
  }
  if (errorCode === "playback_timeout") return "Apple Music playback did not start"
  if (errorCode === "external_station_unsupported") {
    return "Apple Music cannot play this external radio stream in MusicKit"
  }
  if (errorCode === "drm_unavailable") return "Apple Music DRM is unavailable"
  return "Apple Music could not complete the playback request"
}

export function pluralize(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`
}

function formatTrackInfo(track: Track): string[] {
  const lines = [safeInfoText(track.title), safeInfoText(track.artist), ""]
  infoField(lines, "Album", track.album)
  infoField(lines, "Duration", formatDuration(track.durationSeconds))
  const apple = (track as Partial<AppleCatalogTrack>).apple
  if (apple?.resourceType !== "songs") return lines

  const details = apple.details
  infoField(lines, "Released", formatInfoDate(details?.releaseDate))
  infoField(lines, "Genres", details?.genreNames?.join(", "))
  infoField(lines, "Track", details?.trackNumber)
  infoField(lines, "Disc", details?.discNumber)
  infoField(lines, "Composer", details?.composerName)
  infoField(lines, "Rating", titleCase(details?.contentRating))
  if (details?.hasLyrics !== undefined) {
    infoField(lines, "Lyrics", details.hasLyrics ? "Available" : "Unavailable")
  }
  if (details?.isAppleDigitalMaster !== undefined) {
    infoField(lines, "Master", details.isAppleDigitalMaster ? "Apple Digital Master" : "Standard")
  }
  if (track.audioQuality) {
    infoField(lines, "Audio", formatAudioQuality(track.audioQuality).replace(/^AUDIO\s+/, ""))
  }
  if (details?.editorialNotes) {
    lines.push("", "EDITORIAL NOTES", safeInfoText(details.editorialNotes, 2_000))
  }
  return lines
}

function formatAlbumInfo(album: AppleCatalogAlbum): string {
  const lines = [safeInfoText(album.title), safeInfoText(album.artist), ""]
  const details = album.apple.details
  infoField(lines, "Released", formatInfoDate(details?.releaseDate))
  infoField(lines, "Genres", details?.genreNames?.join(", "))
  infoField(lines, "Tracks", details?.trackCount ?? album.tracks.length)
  infoField(lines, "Label", details?.recordLabel)
  infoField(lines, "Rating", titleCase(details?.contentRating))
  if (details?.isCompilation !== undefined) {
    infoField(lines, "Compilation", details.isCompilation ? "Yes" : "No")
  }
  if (details?.isSingle !== undefined) infoField(lines, "Single", details.isSingle ? "Yes" : "No")
  infoField(lines, "Copyright", details?.copyright)
  if (details?.editorialNotes) {
    lines.push("", "EDITORIAL NOTES", safeInfoText(details.editorialNotes, 2_000))
  }
  return lines.join("\n")
}

function formatPlaylistInfo(playlist: ApplePlaylist): string {
  const lines = [safeInfoText(playlist.title), safeInfoText(playlist.curator), ""]
  const library = playlist.apple.resourceType === "library-playlists"
  const details = playlist.apple.details
  infoField(lines, "Source", library ? "Your Library" : "For You")
  infoField(lines, "Type", titleCase(details?.playlistType))
  infoField(lines, "Updated", formatInfoDate(details?.lastModifiedDate))
  infoField(lines, "Added", formatInfoDate(details?.dateAdded))
  if (details?.isChart !== undefined) infoField(lines, "Chart", details.isChart ? "Yes" : "No")
  if (details?.canEdit !== undefined) infoField(lines, "Editable", details.canEdit ? "Yes" : "No")
  if (details?.isPublic !== undefined) {
    infoField(lines, "Visibility", details.isPublic ? "Public" : "Private")
  }
  if (details?.hasCatalog !== undefined) {
    infoField(lines, "Catalog", details.hasCatalog ? "Matched" : "Library only")
  }
  if (playlist.description) {
    lines.push("", "DESCRIPTION", safeInfoText(playlist.description, 2_000))
  }
  return lines.join("\n")
}

function infoField(
  lines: string[],
  label: string,
  value: string | number | undefined,
): void {
  if (value === undefined || value === "") return
  lines.push(`${label.padEnd(14)}${safeInfoText(String(value), 1_000)}`)
}

function safeInfoText(value: string, maxLength = 500): string {
  return value
    .slice(0, maxLength)
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
}

function formatInfoDate(value: string | undefined): string | undefined {
  if (!value) return undefined
  return value.match(/^\d{4}-\d{2}-\d{2}/u)?.[0] ?? value
}

function titleCase(value: string | undefined): string | undefined {
  return value
    ?.split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ")
}
