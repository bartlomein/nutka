import { expect, test } from "bun:test"

import { PLAYBACK_JS } from "./apple-browser-pages"
import {
  MAX_PLAYBACK_METADATA_LENGTH,
  MAX_PLAYBACK_QUEUE_ITEMS,
} from "./apple-playback-protocol"

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

test("loads a station with the documented MusicKit queue shape", async () => {
  const queueCalls: unknown[] = []
  let playListener: (() => void) | undefined
  const music = {
    isAuthorized: true,
    isPlaying: true,
    playbackState: 2,
    currentPlaybackTime: 4,
    currentPlaybackDuration: 201,
    nowPlayingItem: {
      id: "generated-song",
      attributes: {
        name: "Generated Song",
        artistName: "Generated Artist",
        albumName: "Generated Album",
        durationInMillis: 201_000,
      },
    },
    queue: {
      position: 0,
      items: [{
        id: "generated-song",
        attributes: {
          name: "Generated Song",
          artistName: "Generated Artist",
          albumName: "Generated Album",
          durationInMillis: 201_000,
        },
      }],
    },
    shuffleMode: 0,
    repeatMode: 0,
    capabilities: {},
    addEventListener: () => {},
    setQueue: async (options: unknown) => queueCalls.push(options),
    play: async () => {},
  }
  const browserWindow: Record<string, unknown> = {}
  const document = {
    querySelector: (selector: string) => ({
      addEventListener: (_name: string, listener: () => void) => {
        if (selector === "#play") playListener = listener
      },
    }),
  }
  new Function("window", "MusicKit", "document", PLAYBACK_JS)(
    browserWindow,
    {
      PlayerShuffleMode: { off: 0, songs: 1 },
      PlayerRepeatMode: { none: 0, all: 1, one: 2 },
      configure: async () => {},
      getInstance: () => music,
    },
    document,
  )
  const playback = browserWindow.__nutkaPlayback as {
    initialize: (developerToken: string, musicUserToken: string) => Promise<void>
    setStation: (resourceId: string) => void
    snapshot: () => {
      completedCommandSequence: number
      currentItem: unknown
      queueItems: unknown
    }
  }
  await playback.initialize("developer-token", "user-token")
  playback.setStation("ra.123")
  playListener?.()
  while (playback.snapshot().completedCommandSequence === 0) await Bun.sleep(0)
  expect(queueCalls).toEqual([{ station: "ra.123" }])
  expect(playback.snapshot()).toMatchObject({
    currentItem: {
      resourceId: "generated-song",
      title: "Generated Song",
      artist: "Generated Artist",
      album: "Generated Album",
      durationSeconds: 201,
    },
    queueItems: [{ resourceId: "generated-song" }],
  })
})

test("exports direct MusicKit media-item metadata for radio tracks", async () => {
  const radioItem = {
    title: "Radio Song",
    artistName: "Radio Artist",
    albumName: "Radio Album",
    playbackDuration: 187,
    playParams: { id: "radio-song", kind: "song" },
  }
  const music = {
    isAuthorized: true,
    isPlaying: true,
    playbackState: 2,
    currentPlaybackTime: 5,
    currentPlaybackDuration: 187,
    nowPlayingItem: radioItem,
    queue: { position: 0, items: [radioItem] },
    shuffleMode: 0,
    repeatMode: 0,
    capabilities: {},
    addEventListener: () => {},
  }
  const browserWindow: Record<string, unknown> = {}
  new Function("window", "MusicKit", "document", PLAYBACK_JS)(
    browserWindow,
    {
      PlayerShuffleMode: { off: 0, songs: 1 },
      PlayerRepeatMode: { none: 0, all: 1, one: 2 },
      configure: async () => {},
      getInstance: () => music,
    },
    { querySelector: () => ({ addEventListener: () => {} }) },
  )
  const playback = browserWindow.__nutkaPlayback as {
    initialize: (developerToken: string, musicUserToken: string) => Promise<void>
    setStation: (resourceId: string) => void
    snapshot: () => Record<string, unknown>
  }
  await playback.initialize("developer-token", "user-token")
  playback.setStation("ra.123")

  expect(playback.snapshot()).toMatchObject({
    resourceId: "radio-song",
    title: "Radio Song",
    artist: "Radio Artist",
    album: "Radio Album",
    currentItem: {
      resourceId: "radio-song",
      title: "Radio Song",
      artist: "Radio Artist",
      album: "Radio Album",
      durationSeconds: 187,
    },
  })
})

test("exports a bounded queue window around the current item", async () => {
  const items = Array.from({ length: 140 }, (_, index) => ({
    id: `song-${index}`,
    attributes: { name: `Song ${index}`, artistName: "Artist", albumName: "Album" },
  }))
  const music = {
    isAuthorized: true,
    isPlaying: true,
    playbackState: 2,
    currentPlaybackTime: 0,
    currentPlaybackDuration: 180,
    nowPlayingItem: items[120],
    queue: { items, position: 120 },
    shuffleMode: 0,
    repeatMode: 0,
    capabilities: {},
    addEventListener: () => {},
  }
  const browserWindow: Record<string, unknown> = {}
  new Function("window", "MusicKit", "document", PLAYBACK_JS)(
    browserWindow,
    {
      PlayerShuffleMode: { off: 0, songs: 1 },
      PlayerRepeatMode: { none: 0, all: 1, one: 2 },
      configure: async () => {},
      getInstance: () => music,
    },
    { querySelector: () => ({ addEventListener: () => {} }) },
  )
  const playback = browserWindow.__nutkaPlayback as {
    initialize: (developerToken: string, musicUserToken: string) => Promise<void>
    setStation: (resourceId: string) => void
    snapshot: () => { queueResourceIds: string[]; queuePosition: number }
  }
  await playback.initialize("developer-token", "user-token")
  playback.setStation("ra.123")

  expect(playback.snapshot()).toMatchObject({
    queueResourceIds: Array.from({ length: 21 }, (_, index) => `song-${index + 119}`),
    queuePosition: 1,
  })
})

test("keeps the full finite queue while omitting redundant metadata", async () => {
  const items = Array.from({ length: 100 }, (_, index) => ({
    id: `song-${index}`,
    attributes: { name: `Song ${index}`, artistName: "Artist", albumName: "Album" },
  }))
  const music = {
    isAuthorized: true,
    isPlaying: true,
    playbackState: 2,
    currentPlaybackTime: 0,
    currentPlaybackDuration: 180,
    nowPlayingItem: items[50],
    queue: { items, position: 50 },
    shuffleMode: 0,
    repeatMode: 0,
    capabilities: {},
    addEventListener: () => {},
  }
  const browserWindow: Record<string, unknown> = {}
  new Function("window", "MusicKit", "document", PLAYBACK_JS)(
    browserWindow,
    {
      PlayerShuffleMode: { off: 0, songs: 1 },
      PlayerRepeatMode: { none: 0, all: 1, one: 2 },
      configure: async () => {},
      getInstance: () => music,
    },
    { querySelector: () => ({ addEventListener: () => {} }) },
  )
  const playback = browserWindow.__nutkaPlayback as {
    initialize: (developerToken: string, musicUserToken: string) => Promise<void>
    snapshot: () => { queueResourceIds: string[]; queueItems: unknown[]; queuePosition: number }
  }
  await playback.initialize("developer-token", "user-token")

  expect(playback.snapshot()).toMatchObject({
    queueResourceIds: Array.from({ length: 100 }, (_, index) => `song-${index}`),
    queueItems: [],
    queuePosition: 50,
  })
})

test("uses the shared playback queue and metadata limits", async () => {
  const item = {
    id: "song-1",
    attributes: { name: "x".repeat(MAX_PLAYBACK_METADATA_LENGTH + 20) },
  }
  const music = {
    isAuthorized: true,
    isPlaying: false,
    playbackState: 0,
    currentPlaybackTime: 0,
    currentPlaybackDuration: 180,
    nowPlayingItem: item,
    queue: { items: [item], position: 0 },
    shuffleMode: 0,
    repeatMode: 0,
    capabilities: {},
    addEventListener: () => {},
  }
  const browserWindow: Record<string, unknown> = {}
  new Function("window", "MusicKit", "document", PLAYBACK_JS)(
    browserWindow,
    {
      PlayerShuffleMode: { off: 0, songs: 1 },
      PlayerRepeatMode: { none: 0, all: 1, one: 2 },
      configure: async () => {},
      getInstance: () => music,
    },
    { querySelector: () => ({ addEventListener: () => {} }) },
  )
  const playback = browserWindow.__nutkaPlayback as {
    initialize: (developerToken: string, musicUserToken: string) => Promise<void>
    setQueue: (resourceIds: readonly string[]) => void
    snapshot: () => { currentItem: { title: string } }
  }
  await playback.initialize("developer-token", "user-token")

  expect(() => playback.setQueue(
    Array.from({ length: MAX_PLAYBACK_QUEUE_ITEMS + 1 }, (_, index) => `song-${index}`),
  )).toThrow("invalid_queue")
  expect(playback.snapshot().currentItem.title).toHaveLength(MAX_PLAYBACK_METADATA_LENGTH)
})
