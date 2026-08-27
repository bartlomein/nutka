import { describe, expect, test } from "bun:test"

import { getPaletteCommands, type CommandAvailability } from "./commands"

const available: CommandAvailability = {
  appleAuthStatus: { state: "signedOut" },
  canAppleAuth: true,
  canOpenAlbum: true,
  canOpenInfo: true,
  canBrowseNowPlaying: true,
  canFilter: true,
  canSetShuffleMode: true,
  canSetRepeatMode: true,
  canToggleCurrentSongLike: true,
}

describe("command palette policy", () => {
  test("filters commands by capability", () => {
    const ids = getPaletteCommands("", {
      ...available,
      canOpenAlbum: false,
      canFilter: false,
      canSetShuffleMode: false,
      canToggleCurrentSongLike: false,
    }).map(({ id }) => id)

    expect(ids).not.toContain("album")
    expect(ids).not.toContain("filter")
    expect(ids).not.toContain("shuffle")
    expect(ids).not.toContain("like")
    expect(ids).toContain("info")
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
