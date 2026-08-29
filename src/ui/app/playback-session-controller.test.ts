import { expect, test } from "bun:test"

import { createInitialState, type PlaybackState } from "../../core/state"
import type {
  AppleCatalogPlaylist,
  AppleCatalogTrack,
  PlaybackController,
  PlaybackSnapshot,
  PlaybackRepeatMode,
  PlaybackShuffleMode,
} from "../../core/types"
import {
  PlaybackSessionController,
  type PlaybackSessionHost,
  type PlaybackSessionServices,
} from "./playback-session-controller"

test("PlaybackSessionController coalesces seeks to the latest bounded target", async () => {
  const firstSeek = deferred<void>()
  const playback = new FakePlayback()
  playback.seekImpl = async () => {
    if (playback.seeks.length === 1) await firstSeek.promise
  }
  const fixture = createFixture({ playback }, [track("current")])
  fixture.state.currentTrackId = "apple:song:current"
  fixture.state.positionSeconds = 10
  fixture.state.durationSeconds = 180
  fixture.state.canSeek = true

  fixture.controller.requestSeek(15)
  fixture.controller.seekBy(5)
  fixture.controller.seekBy(15)
  expect(playback.seeks).toEqual([15])

  firstSeek.resolve()
  await flushPromises()
  expect(playback.seeks).toEqual([15, 35])

  fixture.controller.requestSeek(500)
  await flushPromises()
  expect(playback.seeks).toEqual([15, 35, 180])
})

test("PlaybackSessionController cancels stale like loads and rolls back failed saves", async () => {
  const firstLoad = deferred<boolean>()
  const secondLoad = deferred<boolean>()
  const loadSignals: AbortSignal[] = []
  let loadCount = 0
  const playback = new FakePlayback()
  const fixture = createFixture({
    playback,
    getSongLiked: async (_id, options) => {
      loadSignals.push(options!.signal!)
      return (loadCount++ === 0 ? firstLoad : secondLoad).promise
    },
    setSongLiked: async () => {
      throw new Error("service detail")
    },
  }, [track("current")])
  fixture.state.currentTrackId = "apple:song:current"

  fixture.controller.authenticationChanged(true, false)
  fixture.controller.authenticationChanged(false, false)
  expect(loadSignals[0]?.aborted).toBe(true)
  fixture.controller.authenticationChanged(true, false)
  const rendersBeforeStaleResult = fixture.renders.value

  firstLoad.resolve(true)
  await flushPromises()
  expect(fixture.renders.value).toBe(rendersBeforeStaleResult)
  expect(fixture.controller.currentSongLike().status).toBe("loading")

  secondLoad.resolve(false)
  await flushPromises()
  expect(fixture.controller.currentSongLike()).toEqual({
    liked: false,
    status: "ready",
    error: false,
  })

  const save = fixture.controller.toggleCurrentSongLike()
  expect(fixture.controller.currentSongLike()).toEqual({
    liked: true,
    status: "saving",
    error: false,
  })
  await save
  expect(fixture.controller.currentSongLike()).toEqual({
    liked: false,
    status: "error",
    error: true,
  })
})

test("PlaybackSessionController drops stale playlist loads and caps shuffle input", async () => {
  const stalePage = deferred<{
    items: readonly AppleCatalogTrack[]
    nextCursor: string | null
  }>()
  const playback = new FakePlayback()
  const firstSignals: AbortSignal[] = []
  const activeCursors: Array<string | undefined> = []
  let initialRequests = 0
  const fixture = createFixture({
    playback,
    random: () => 0,
    getPlaylistTracks: async (_playlist, options) => {
      if (!options?.cursor && initialRequests++ === 0) {
        firstSignals.push(options!.signal!)
        return stalePage.promise
      }
      activeCursors.push(options?.cursor)
      const page = activeCursors.length - 1
      return {
        items: Array.from({ length: 30 }, (_, index) => track(`${page}-${index}`)),
        nextCursor: `page-${page + 1}`,
      }
    },
  })
  fixture.selectedPlaylist.value = playlist("first")

  fixture.controller.playRandom()
  fixture.selectedPlaylist.value = playlist("second")
  fixture.controller.playRandom()
  await flushPromises(8)

  expect(firstSignals[0]?.aborted).toBe(true)
  expect(activeCursors).toEqual([undefined, "page-1", "page-2", "page-3"])
  expect(playback.plays).toHaveLength(1)
  expect([
    playback.plays[0]!.track,
    ...playback.plays[0]!.upcoming,
  ]).toHaveLength(100)
  expect(playback.shuffleModes).toEqual(["songs"])

  stalePage.resolve({ items: [track("stale")], nextCursor: null })
  await flushPromises()
  expect(playback.plays).toHaveLength(1)
})

function createFixture(
  services: PlaybackSessionServices,
  initialTracks: readonly AppleCatalogTrack[] = [],
) {
  const state = { ...createInitialState([]).playback }
  const tracks = new Map(initialTracks.map((item) => [item.id, item]))
  const selectedPlaylist: { value: AppleCatalogPlaylist | undefined } = { value: undefined }
  const renders = { value: 0 }
  const host: PlaybackSessionHost = {
    getPlaybackState: () => state,
    getTrack: (id) => tracks.get(id),
    getRandomTracks: () => [...tracks.values()],
    getSelectedPlaylist: () => selectedPlaylist.value,
    replacePlaybackTracks: (next) => {
      tracks.clear()
      for (const item of next) tracks.set(item.id, item)
    },
    syncPlayback: (snapshot) => assignSnapshot(state, snapshot),
    renderAudioAnalysis: () => {},
    render: () => {
      renders.value++
    },
  }
  return {
    controller: new PlaybackSessionController(services, host),
    state,
    selectedPlaylist,
    renders,
  }
}

function assignSnapshot(
  state: PlaybackState,
  snapshot: PlaybackSnapshot<AppleCatalogTrack>,
): void {
  Object.assign(state, {
    currentTrackId: snapshot.currentTrack?.id ?? null,
    status: snapshot.status,
    queueTrackIds: snapshot.queue.map((item) => item.id),
    positionSeconds: snapshot.positionSeconds,
    durationSeconds: snapshot.durationSeconds,
    errorCode: snapshot.errorCode,
    shuffleMode: snapshot.shuffleMode,
    repeatMode: snapshot.repeatMode,
    canSetShuffleMode: snapshot.canSetShuffleMode,
    canSetRepeatMode: snapshot.canSetRepeatMode,
    source: snapshot.source ?? null,
    dynamicQueue: snapshot.dynamicQueue ?? false,
    canSeek: snapshot.canSeek ?? true,
    canSkipNext: snapshot.canSkipNext ?? true,
    canSkipPrevious: snapshot.canSkipPrevious ?? true,
  })
}

class FakePlayback implements PlaybackController<AppleCatalogTrack> {
  snapshot: PlaybackSnapshot<AppleCatalogTrack> = {
    status: "idle",
    currentTrack: null,
    queue: [],
    positionSeconds: 0,
    durationSeconds: null,
    errorCode: null,
    shuffleMode: "off",
    repeatMode: "none",
    canSetShuffleMode: false,
    canSetRepeatMode: false,
  }
  seeks: number[] = []
  plays: Array<{ track: AppleCatalogTrack; upcoming: readonly AppleCatalogTrack[] }> = []
  shuffleModes: PlaybackShuffleMode[] = []
  seekImpl: () => Promise<void> = async () => {}

  subscribe(): () => void {
    return () => {}
  }
  async play(track: AppleCatalogTrack, upcoming: readonly AppleCatalogTrack[]): Promise<void> {
    this.plays.push({ track, upcoming })
  }
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async previous(): Promise<void> {}
  async next(): Promise<void> {}
  async setShuffleMode(mode: PlaybackShuffleMode): Promise<void> {
    this.shuffleModes.push(mode)
  }
  async setRepeatMode(_mode: PlaybackRepeatMode): Promise<void> {}
  async seek(positionSeconds: number): Promise<void> {
    this.seeks.push(positionSeconds)
    await this.seekImpl()
  }
  async stop(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async dispose(): Promise<void> {}
}

function track(id: string): AppleCatalogTrack {
  return {
    id: `apple:song:${id}`,
    title: id,
    artist: "Artist",
    album: "Album",
    durationSeconds: 180,
    apple: {
      resourceId: id,
      resourceType: "songs",
      playParams: { id, kind: "song" },
    },
  }
}

function playlist(id: string): AppleCatalogPlaylist {
  return {
    id: `apple:playlist:${id}`,
    title: id,
    curator: "Curator",
    apple: { resourceId: id, resourceType: "playlists" },
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function flushPromises(turns = 3): Promise<void> {
  for (let turn = 0; turn < turns; turn++) await Promise.resolve()
}
