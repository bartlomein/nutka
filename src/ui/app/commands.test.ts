import { describe, expect, test } from "bun:test"

import { getPaletteCommands, type CommandAvailability } from "./commands"

const available: CommandAvailability = {
  appleAuthStatus: { state: "signedOut" },
  canAppleAuth: true,
  canOpenAlbum: true,
  canOpenInfo: true,
  canBrowseNowPlaying: true,
  canStartSongStation: true,
  canFilter: true,
  canSetShuffleMode: true,
  canSetRepeatMode: true,
  canToggleCurrentSongLike: true,
  canToggleSelectedStationFavorite: true,
  canToggleSelectedStationLike: true,
}

describe("command palette policy", () => {
  test("filters commands by capability", () => {
    const ids = getPaletteCommands("", {
      ...available,
      canOpenAlbum: false,
      canFilter: false,
      canSetShuffleMode: false,
      canToggleCurrentSongLike: false,
      canToggleSelectedStationFavorite: false,
      canToggleSelectedStationLike: false,
    }).map(({ id }) => id)

    expect(ids).not.toContain("album")
    expect(ids).not.toContain("filter")
    expect(ids).not.toContain("shuffle")
    expect(ids).not.toContain("like")
    expect(ids).not.toContain("favorite-station")
    expect(ids).not.toContain("like-station")
    expect(ids).toContain("info")
  })

  test("only exposes the current-song station action when its exact context is available", () => {
    expect(getPaletteCommands("station", available).map(({ id }) => id)).toContain(
      "station-from-song",
    )
    expect(getPaletteCommands("station", {
      ...available,
      canStartSongStation: false,
    }).map(({ id }) => id)).not.toContain("station-from-song")
  })

  test("offers the recovery command matching the authentication failure", () => {
    const ids = getPaletteCommands("apple", {
      ...available,
      appleAuthStatus: { state: "error", code: "credential_load_failed" },
    }).map(({ id }) => id)

    expect(ids).toContain("apple-retry-restore")
    expect(ids).not.toContain("apple-sign-in")
    expect(ids).not.toContain("apple-cleanup")
  })
})
