import { expect, test } from "bun:test"

import type { AppleCatalogStation, SearchPage } from "../../core/types"
import { RadioController, type RadioControllerHost } from "./radio-controller"

test("RadioController keeps only the latest overlapping station search", async () => {
  const requests = new Map<string, ReturnType<typeof deferred<SearchPage<AppleCatalogStation>>>>()
  const selection: { value: string | null } = { value: null }
  const controller = new RadioController({
    searchStations: (query) => {
      const request = deferred<SearchPage<AppleCatalogStation>>()
      requests.set(query, request)
      return request.promise
    },
  }, host({
    getSelectedId: () => selection.value,
    select: (id) => {
      selection.value = id
    },
  }))

  const first = controller.searchStations("first")
  const second = controller.searchStations("second")
  requests.get("second")!.resolve({
    items: [station("second", "Second Station")],
    nextCursor: null,
  })
  await second
  requests.get("first")!.resolve({
    items: [station("first", "First Station")],
    nextCursor: null,
  })
  await first

  expect(controller.search.query).toBe("second")
  expect(controller.visibleStations().map((item) => item.title)).toEqual(["Second Station"])
  expect(selection.value).toBe("apple:station:second")
})

function host(overrides: Partial<RadioControllerHost> = {}): RadioControllerHost {
  return {
    getDestination: () => "radio",
    getSelectedId: () => null,
    select: () => {},
    resetSelection: overrides.select ?? (() => {}),
    closeMode: () => {},
    favoritesChanged: () => {},
    render: () => {},
    ...overrides,
  }
}

function station(id: string, title: string): AppleCatalogStation {
  return {
    id: `apple:station:${id}`,
    title,
    isLive: false,
    apple: {
      resourceId: id,
      resourceType: "stations",
      playParams: { id, kind: "radioStation" },
      artwork: { url: "https://example.test/artwork", width: 100, height: 100 },
    },
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
