import { expect, test } from "bun:test"
import type { ListState } from "../../core/state"
import type { AppleLibrarySong, SearchPage } from "../../core/types"
import { LibraryController, type LibraryServices } from "./library-controller"

const song = (id: string): AppleLibrarySong => ({
  kind: "song", id, resourceId: id, title: id, artist: "Artist", album: "Album", durationSeconds: 10,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { resolve, promise }
}
function createController(overrides: Partial<LibraryServices> = {}) {
  let list: ListState = { filter: "", selectedTrackId: null }
  let active = true
  let authenticated = true
  let retained = 0
  const controller = new LibraryController({
    getSongs: async () => ({ items: [song("one")], nextCursor: null }),
    getAlbums: async () => ({ items: [], nextCursor: null }),
    getArtists: async () => ({ items: [], nextCursor: null }),
    getAlbumTracks: async () => ({ items: [], nextCursor: null }),
    getArtistAlbums: async () => ({ items: [], nextCursor: null }),
    ...overrides,
  }, {
    active: () => active, authenticated: () => authenticated, list: () => list, query: () => list.filter,
    restoreList: (next) => { list = next }, replaceTracks: (tracks) => { retained = tracks.length }, render() {},
  })
  return {
    controller, list: () => list, setList: (value: ListState) => { list = value }, retained: () => retained,
    leave: () => { controller.leave(); active = false },
    signOut: () => { authenticated = false; controller.reset() },
  }
}

test("a failed later page preserves rows and cursor, supports retry, and ignores duplicate load-more keys", async () => {
  const pending = deferred<SearchPage<AppleLibrarySong>>()
  let calls = 0
  const setup = createController({ getSongs: async (options) => {
    calls++
    if (!options?.cursor) return { items: [song("one")], nextCursor: "page2" }
    if (calls === 2) throw new Error("offline")
    return pending.promise
  } })
  setup.controller.enter()
  await Bun.sleep(0)
  expect(setup.controller.page.items).toEqual([song("one")])
  expect(setup.controller.page.nextCursor).toBe("page2")
  expect(setup.controller.statusLine("")).toContain("m retry")
  setup.controller.loadMore()
  setup.controller.loadMore()
  expect(calls).toBe(3)
  pending.resolve({ items: [song("one"), song("two")], nextCursor: null })
  await Bun.sleep(0)
  expect(setup.controller.page.items.map((item) => item.id)).toEqual(["one", "two"])
  expect(setup.list().selectedTrackId).toBe("one")
  expect(setup.controller.page.error).toBe(false)
})

test("refresh replaces data and ignores a superseded response", async () => {
  const old = deferred<SearchPage<AppleLibrarySong>>()
  let signal: AbortSignal | undefined
  let calls = 0
  const setup = createController({ getSongs: async (options) => {
    if (++calls === 1) { signal = options?.signal; return old.promise }
    return { items: [song("new")], nextCursor: null }
  } })
  setup.controller.enter()
  setup.controller.refresh()
  await Bun.sleep(0)
  old.resolve({ items: [song("old")], nextCursor: "old-page" })
  await Bun.sleep(0)
  expect(signal?.aborted).toBe(true)
  expect(setup.controller.page.items.map((item) => item.id)).toEqual(["new"])
  expect(setup.controller.page.nextCursor).toBeNull()
})

test("sign-out aborts pending personal requests and ignores their late responses", async () => {
  const pending = deferred<SearchPage<AppleLibrarySong>>()
  let signal: AbortSignal | undefined
  const setup = createController({ getSongs: async (options) => {
    signal = options?.signal
    return pending.promise
  } })
  setup.controller.enter()
  setup.signOut()
  pending.resolve({ items: [song("private")], nextCursor: null })
  await Bun.sleep(0)
  expect(signal?.aborted).toBe(true)
  expect(setup.controller.page.items).toEqual([])
  expect(setup.retained()).toBe(0)
  expect(setup.controller.emptyMessage("")).toContain("Sign in")
})

test("requests finishing on another section or destination do not change the active selection", async () => {
  const pending = deferred<SearchPage<AppleLibrarySong>>()
  const setup = createController({ getSongs: () => pending.promise })
  setup.controller.enter()
  setup.controller.switchSection("albums")
  await Bun.sleep(0)
  setup.setList({ selectedTrackId: "other-selection", filter: "saved" })
  setup.leave()
  pending.resolve({ items: [song("late")], nextCursor: null })
  await Bun.sleep(0)
  expect(setup.list()).toEqual({ selectedTrackId: "other-selection", filter: "saved" })
  expect(setup.controller.page.section).toBe("albums")
})

test("back aborts an unfinished album and permits opening it again", async () => {
  const pending = deferred<SearchPage<AppleLibrarySong>>()
  let signal: AbortSignal | undefined
  const album = { kind: "album" as const, id: "album", resourceId: "l.album", title: "Album", artist: "Artist" }
  let calls = 0
  const setup = createController({
    getAlbums: async () => ({ items: [album], nextCursor: null }),
    getAlbumTracks: async (_id, options) => {
      if (++calls === 1) { signal = options?.signal; return pending.promise }
      return { items: [song("new")], nextCursor: null }
    },
  })
  setup.controller.switchSection("albums")
  await Bun.sleep(0)
  setup.controller.openSelected("")
  setup.controller.back()
  expect(signal?.aborted).toBe(true)
  expect(setup.list().selectedTrackId).toBe("album")
  setup.controller.openSelected("")
  await Bun.sleep(0)
  pending.resolve({ items: [song("old")], nextCursor: null })
  await Bun.sleep(0)
  expect(setup.controller.page.items.map((item) => item.id)).toEqual(["new"])
})

test("a looping pagination cursor becomes a recoverable error without discarding rows", async () => {
  const setup = createController({ getSongs: async () => ({ items: [song("one")], nextCursor: "loop" }) })
  setup.controller.enter()
  await Bun.sleep(0)
  expect(setup.controller.page.error).toBe(true)
  expect(setup.controller.page.items).toEqual([song("one")])
  expect(setup.controller.statusLine("")).toContain("R refresh")
})

test("retry after a failed refresh reloads the first page instead of the old next page", async () => {
  const cursors: Array<string | undefined> = []
  const setup = createController({ getSongs: async (options) => {
    cursors.push(options?.cursor)
    if (cursors.length === 3) throw new Error("offline")
    if (options?.cursor) return { items: [], nextCursor: null }
    return { items: [song(cursors.length === 1 ? "old" : "new")], nextCursor: "page2" }
  } })
  setup.controller.enter()
  await Bun.sleep(0)
  setup.controller.refresh()
  await Bun.sleep(0)
  expect(setup.controller.page.items.map((item) => item.id)).toEqual(["old"])
  setup.controller.loadMore()
  await Bun.sleep(0)
  expect(cursors).toEqual([undefined, "page2", undefined, undefined, "page2"])
  expect(setup.controller.page.items.map((item) => item.id)).toEqual(["new"])
})

test("switching to a section that finished in the background selects its first visible item", async () => {
  const pending = deferred<SearchPage<AppleLibrarySong>>()
  const setup = createController({ getSongs: () => pending.promise })
  setup.controller.enter()
  setup.controller.switchSection("artists")
  pending.resolve({ items: [song("saved")], nextCursor: null })
  await Bun.sleep(0)
  setup.controller.switchSection("songs")
  expect(setup.list().selectedTrackId).toBe("saved")
})

test("loads every page progressively, including empty pages, while preserving the filter and selection", async () => {
  const pending = deferred<SearchPage<AppleLibrarySong>>()
  const cursors: Array<string | undefined> = []
  const setup = createController({ getSongs: async (options) => {
    cursors.push(options?.cursor)
    if (!options?.cursor) return { items: [song("one")], nextCursor: "page2" }
    if (options.cursor === "page2") return pending.promise
    return { items: [song("one"), song("two")], nextCursor: null }
  } })
  setup.controller.enter()
  await Bun.sleep(0)
  expect(setup.controller.page.items).toEqual([song("one")])
  expect(setup.controller.page.status).toBe("loadingMore")
  expect(setup.controller.statusLine("")).toContain("1 loaded")
  setup.setList({ selectedTrackId: null, filter: "two" })
  setup.controller.loadMore()
  expect(cursors).toEqual([undefined, "page2"])
  pending.resolve({ items: [], nextCursor: "page3" })
  await Bun.sleep(0)
  expect(cursors).toEqual([undefined, "page2", "page3"])
  expect(setup.controller.page.items.map((item) => item.id)).toEqual(["one", "two"])
  expect(setup.controller.page.status).toBe("ready")
  expect(setup.controller.page.nextCursor).toBeNull()
  expect(setup.list()).toEqual({ selectedTrackId: "two", filter: "two" })
})

test("stops an automatic pagination cycle involving multiple cursors", async () => {
  const cursors: Array<string | undefined> = []
  const setup = createController({ getSongs: async (options) => {
    cursors.push(options?.cursor)
    return { items: [song("one")], nextCursor: options?.cursor === "page2" ? "page3" : "page2" }
  } })
  setup.controller.enter()
  await Bun.sleep(0)
  expect(cursors).toEqual([undefined, "page2", "page3"])
  expect(setup.controller.page.error).toBe(true)
  expect(setup.controller.page.items).toEqual([song("one")])
})
