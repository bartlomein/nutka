import { afterEach, describe, expect, test } from "bun:test"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import {
  createFavoriteStationStore,
  FavoriteStationStoreError,
  favoriteStationStorePath,
} from "./favorite-stations"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function temporaryPath(): { directory: string; path: string } {
  const directory = mkdtempSync(join(tmpdir(), "nutka-favorites-"))
  directories.push(directory)
  return { directory, path: join(directory, "data", "favorites.json") }
}

describe("favorite station paths", () => {
  test("uses environment paths in priority order", () => {
    expect(favoriteStationStorePath({
      NUTKA_FAVORITES_PATH: "/explicit/favorites.json",
      XDG_DATA_HOME: "/xdg",
      HOME: "/home/test",
    })).toBe("/explicit/favorites.json")
    expect(favoriteStationStorePath({ XDG_DATA_HOME: "/xdg", HOME: "/home/test" }))
      .toBe("/xdg/nutka/apple-station-favorites.json")
    expect(favoriteStationStorePath({ HOME: "/home/test" }))
      .toBe("/home/test/.local/share/nutka/apple-station-favorites.json")
    expect(favoriteStationStorePath({ XDG_DATA_HOME: "relative", HOME: "/home/test" }))
      .toBe("/home/test/.local/share/nutka/apple-station-favorites.json")
    expect(favoriteStationStorePath({ HOME: "relative" })).toBeUndefined()
    expect(favoriteStationStorePath({})).toBeUndefined()
  })

  test("gives an option path priority over the environment", () => {
    const first = temporaryPath()
    const second = temporaryPath()
    const store = createFavoriteStationStore({
      path: first.path,
      environment: { NUTKA_FAVORITES_PATH: second.path },
    })
    store.set("us", "ra.123", true)
    expect(statSync(first.path).isFile()).toBeTrue()
    expect(() => statSync(second.path)).toThrow()
  })

  test("has safe no-path behavior", () => {
    const store = createFavoriteStationStore({ environment: {} })
    expect(store.load("us")).toEqual([])
    expect(() => store.set("us", "ra.123", true)).not.toThrow()
    expect(() => store.load("US")).toThrow(FavoriteStationStoreError)
  })
})

test("roundtrips in insertion order with storefront isolation and idempotence", () => {
  const { path } = temporaryPath()
  const store = createFavoriteStationStore({ path })
  store.set("us", "ra.2", true)
  store.set("us", "ra.1", true)
  store.set("gb", "ra.gb", true)

  const inode = statSync(path).ino
  store.set("us", "ra.1", true)
  expect(statSync(path).ino).toBe(inode)
  expect(store.load("us")).toEqual(["ra.2", "ra.1"])
  expect(store.load("gb")).toEqual(["ra.gb"])

  store.set("us", "ra.2", false)
  store.set("us", "missing", false)
  expect(store.load("us")).toEqual(["ra.1"])
  expect(store.load("gb")).toEqual(["ra.gb"])
})

describe("favorite station validation", () => {
  test("rejects malformed data without overwriting it", () => {
    const malformed = [
      "not json",
      JSON.stringify({ version: 2, storefronts: {} }),
      JSON.stringify({ version: 1, storefronts: {}, extra: true }),
      JSON.stringify({ version: 1, storefronts: [] }),
      JSON.stringify({ version: 1, storefronts: { US: [] } }),
      JSON.stringify({ version: 1, storefronts: { us: ["ra.1", "ra.1"] } }),
      JSON.stringify({ version: 1, storefronts: { us: ["bad/id"] } }),
    ]
    for (const value of malformed) {
      const { path } = temporaryPath()
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, value)
      const store = createFavoriteStationStore({ path })
      expect(() => store.set("us", "ra.2", true)).toThrow(FavoriteStationStoreError)
      expect(readFileSync(path, "utf8")).toBe(value)
    }
  })

  test("rejects oversized files", () => {
    const { path } = temporaryPath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, "x".repeat(64 * 1024 + 1))
    expect(() => createFavoriteStationStore({ path }).load("us"))
      .toThrow(FavoriteStationStoreError)
  })

  test("enforces ID and storefront limits", () => {
    const { path } = temporaryPath()
    const store = createFavoriteStationStore({ path })
    for (let index = 0; index < 25; index++) store.set("us", `ra.${index}`, true)
    expect(() => store.set("us", "ra.25", true)).toThrow(FavoriteStationStoreError)

    const full = Object.fromEntries(
      Array.from({ length: 256 }, (_, index) => {
        const first = String.fromCharCode(97 + Math.floor(index / 26))
        const second = String.fromCharCode(97 + index % 26)
        return [`${first}${second}`, ["ra.1"]]
      }),
    )
    writeFileSync(path, JSON.stringify({ version: 1, storefronts: full }))
    expect(() => store.set("zz", "ra.2", true)).toThrow(FavoriteStationStoreError)
  })

  test("rejects invalid public inputs with sanitized errors", () => {
    const { path } = temporaryPath()
    const store = createFavoriteStationStore({ path })
    for (const operation of [
      () => store.load("USA"),
      () => store.set("US", "ra.1", true),
      () => store.set("us", "private/id", true),
      () => store.set("us", "ra.1", "yes" as unknown as boolean),
    ]) {
      expect(operation).toThrow(FavoriteStationStoreError)
      try { operation() } catch (error) {
        expect(String(error)).not.toContain("private/id")
        expect(String(error)).not.toContain(path)
      }
    }
  })
})

test("writes the parent and file with private modes", () => {
  const { path } = temporaryPath()
  const store = createFavoriteStationStore({ path })
  store.set("us", "ra.123", true)

  expect(statSync(path).mode & 0o777).toBe(0o600)
  expect(statSync(join(path, "..")).mode & 0o777).toBe(0o700)
  chmodSync(path, 0o644)
  store.set("us", "ra.456", true)
  expect(statSync(path).mode & 0o777).toBe(0o600)
})
