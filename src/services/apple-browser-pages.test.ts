import { expect, test } from "bun:test"

import { PLAYBACK_JS } from "./apple-browser-pages"

test("clears stale playback errors before setting shuffle and repeat modes", async () => {
  let onPlaybackError: ((event: unknown) => void) | undefined
  const music = {
    isAuthorized: true,
    isPlaying: false,
    playbackState: 0,
    currentPlaybackTime: 0,
    currentPlaybackDuration: 0,
    nowPlayingItem: null,
    queue: { items: [], position: -1 },
    shuffleMode: 0,
    repeatMode: 0,
    capabilities: {
      canSetShuffleMode: true,
      canSetRepeatMode: true,
    },
    addEventListener: (_name: string, listener: (event: unknown) => void) => {
      onPlaybackError = listener
    },
  }
  const browserWindow: Record<string, unknown> = {}
  const musicKit = {
    PlayerShuffleMode: { off: 0, songs: 1 },
    PlayerRepeatMode: { none: 0, all: 1, one: 2 },
    configure: async () => {},
    getInstance: () => music,
  }
  const document = {
    querySelector: () => ({ addEventListener: () => {} }),
  }
  new Function("window", "MusicKit", "document", PLAYBACK_JS)(
    browserWindow,
    musicKit,
    document,
  )
  const playback = browserWindow.__nutkaPlayback as {
    initialize: (developerToken: string, musicUserToken: string) => Promise<void>
    setShuffleMode: (mode: "off" | "songs") => void
    setRepeatMode: (mode: "none" | "all" | "one") => void
    snapshot: () => {
      lastErrorCode: string | null
      shuffleMode: "off" | "songs"
      repeatMode: "none" | "all" | "one"
    }
  }

  await playback.initialize("developer-token", "user-token")
  onPlaybackError?.({ code: "STALE_ERROR" })
  expect(playback.snapshot().lastErrorCode).toBe("STALE_ERROR")

  playback.setShuffleMode("songs")
  expect(playback.snapshot()).toMatchObject({
    lastErrorCode: null,
    shuffleMode: "songs",
  })

  onPlaybackError?.({ code: "ANOTHER_STALE_ERROR" })
  playback.setRepeatMode("one")
  expect(playback.snapshot()).toMatchObject({
    lastErrorCode: null,
    repeatMode: "one",
  })
})
