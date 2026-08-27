import type { AppleAuthStatus } from "../../services/apple-auth"

export type CommandId =
  | "home"
  | "library"
  | "playlists"
  | "search"
  | "queue"
  | "browse-now-playing"
  | "album"
  | "info"
  | "filter"
  | "apple-sign-in"
  | "apple-sign-out"
  | "apple-retry-restore"
  | "apple-cleanup"
  | "shuffle"
  | "repeat"
  | "like"
  | "visualizer"
  | "visualizer-settings"
  | "help"
  | "quit"

export interface Command {
  readonly id: CommandId
  readonly title: string
  readonly description: string
  readonly shortcut: string
  readonly keywords: string
}

export interface CommandAvailability {
  readonly appleAuthStatus: AppleAuthStatus
  readonly canAppleAuth: boolean
  readonly canOpenAlbum: boolean
  readonly canOpenInfo: boolean
  readonly canBrowseNowPlaying: boolean
  readonly canFilter: boolean
  readonly canSetShuffleMode: boolean
  readonly canSetRepeatMode: boolean
  readonly canToggleCurrentSongLike: boolean
}

export const commands: readonly Command[] = [
  { id: "home", title: "Go to Home", description: "Browse personalized recommendations", shortcut: "g h", keywords: "home personalized recommendations for you" },
  { id: "library", title: "Go to Library", description: "Browse saved tracks", shortcut: "g l", keywords: "library tracks browse saved" },
  { id: "playlists", title: "Go to Playlists", description: "Browse saved playlists", shortcut: "g p", keywords: "playlists saved library" },
  { id: "search", title: "Search music", description: "Find title, artist, or album", shortcut: "g s", keywords: "search find catalog music" },
  { id: "queue", title: "Go to Queue", description: "See what plays next", shortcut: "g q", keywords: "queue upcoming next" },
  { id: "browse-now-playing", title: "Browse Now Playing", description: "Open the current album or artist", shortcut: "g n", keywords: "now playing current song album artist context browse" },
  { id: "filter", title: "Filter current list", description: "Narrow visible tracks", shortcut: "/", keywords: "filter current list narrow" },
  { id: "info", title: "Show Item Info", description: "Inspect the selected item", shortcut: "i", keywords: "info details metadata selected track album playlist" },
  { id: "album", title: "Go to Album", description: "Open the selected song's album", shortcut: "a", keywords: "album release selected song open" },
  { id: "apple-sign-in", title: "Sign in to Apple Music", description: "Authorize this device", shortcut: "", keywords: "apple music login sign in authorize account" },
  { id: "apple-retry-restore", title: "Retry Apple Music keyring", description: "Try loading the saved login again", shortcut: "", keywords: "apple music retry keyring restore login" },
  { id: "apple-cleanup", title: "Remove incomplete Apple login", description: "Clean up after a keyring save failure", shortcut: "", keywords: "apple music cleanup remove incomplete keyring save failed" },
  { id: "apple-sign-out", title: "Sign out of Apple Music", description: "Remove login from this device", shortcut: "", keywords: "apple music logout sign out account" },
  { id: "shuffle", title: "Toggle Shuffle", description: "Shuffle or restore the current queue order", shortcut: "s", keywords: "shuffle random playback mode queue order" },
  { id: "repeat", title: "Cycle Repeat Mode", description: "Repeat off, all songs, or one song", shortcut: "r", keywords: "repeat loop all one song playback mode" },
  { id: "like", title: "Toggle Current Song Like", description: "Like or unlike the song playing now", shortcut: "l", keywords: "like unlike love heart current now playing song rating" },
  { id: "visualizer", title: "Toggle visualizer", description: "Show or hide audio visualization", shortcut: "v", keywords: "visualizer spectrum audio show hide toggle" },
  { id: "visualizer-settings", title: "Visualizer settings", description: "Choose visualization, style, palette, and height", shortcut: "shift+v", keywords: "visualizer settings configure style palette color height" },
  { id: "help", title: "Keyboard help", description: "Show all shortcuts", shortcut: "?", keywords: "help keyboard shortcuts keys" },
  { id: "quit", title: "Quit Nutka", description: "Close the player", shortcut: "q", keywords: "quit exit close" },
]

export function getPaletteCommands(
  query: string,
  availability: CommandAvailability,
): readonly Command[] {
  const availableCommands = commands.filter((command) => {
    if (command.id === "album") return availability.canOpenAlbum
    if (command.id === "info") return availability.canOpenInfo
    if (command.id === "browse-now-playing") return availability.canBrowseNowPlaying
    if (command.id === "filter") return availability.canFilter
    if (command.id === "shuffle") return availability.canSetShuffleMode
    if (command.id === "repeat") return availability.canSetRepeatMode
    if (command.id === "like") return availability.canToggleCurrentSongLike
    const status = availability.appleAuthStatus
    if (command.id === "apple-sign-in") {
      if (!availability.canAppleAuth) return false
      return status.state === "signedOut" || (
        status.state === "error" && [
          "authorization_invalid",
          "browser_open_failed",
          "service_unavailable",
          "session_expired",
        ].includes(status.code)
      )
    }
    if (command.id === "apple-sign-out") {
      return availability.canAppleAuth && (
        status.state === "signedIn" ||
        (status.state === "error" && status.code === "credential_delete_failed")
      )
    }
    if (command.id === "apple-retry-restore") {
      return availability.canAppleAuth && status.state === "error" &&
        status.code === "credential_load_failed"
    }
    if (command.id === "apple-cleanup") {
      return availability.canAppleAuth && status.state === "error" &&
        status.code === "credential_save_failed"
    }
    return true
  })
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return availableCommands
  return availableCommands.filter((command) =>
    `${command.title} ${command.description} ${command.keywords}`
      .toLowerCase()
      .includes(normalizedQuery),
  )
}
