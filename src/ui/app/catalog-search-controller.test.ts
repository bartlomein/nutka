import { expect, test } from "bun:test"

import type { SearchPage, Track } from "../../core/types"
import { CatalogSearchController } from "./catalog-search-controller"

test("CatalogSearchController owns replacement and paginated search state", async () => {
  const pages: SearchPage<Track>[] = [
    { items: [track("one")], nextCursor: "next" },
    { items: [track("one"), track("two")], nextCursor: null },
  ]
  const replacements: Array<readonly string[]> = []
  const selection: { value: string | null } = { value: null }
  const controller = new CatalogSearchController(async () => pages.shift()!, {
    replaceTracks: (_previous, next) => replacements.push(next.map((item) => item.id)),
    prepareSearch: () => {},
    select: (id) => {
      selection.value = id
    },
    closeMode: () => {},
    render: () => {},
  })

  await controller.submit("query")
  await controller.loadMore()

  expect(controller.state).toEqual({ query: "query", status: "ready", nextCursor: null })
  expect(controller.tracks.map((item) => item.id)).toEqual(["one", "two"])
  expect(replacements).toEqual([[], ["one"], ["one", "two"]])
  expect(selection.value).toBe("one")
})

function track(id: string): Track {
  return {
    id,
    title: id,
    artist: "artist",
    album: "album",
    durationSeconds: 180,
  }
}
