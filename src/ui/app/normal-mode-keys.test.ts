import { describe, expect, test } from "bun:test"
import type { KeyEvent } from "@opentui/core"

import {
  NormalModeKeyController,
  type NormalModeKeyHost,
} from "./normal-mode-keys"

function key(name: string, options: Partial<KeyEvent> = {}): KeyEvent {
  return {
    name,
    sequence: name.length === 1 ? name : "",
    eventType: "press",
    ctrl: false,
    meta: false,
    option: false,
    shift: false,
    ...options,
  } as KeyEvent
}

function setupHost() {
  let pendingKey: string | null = null
  let browsePage = false
  const events: string[] = []
  const record = (event: string) => () => events.push(event)
  const host: NormalModeKeyHost = {
    pendingKey: () => pendingKey,
    hasBrowsePage: () => browsePage,
    beginGoto: () => {
      pendingKey = "g"
      events.push("begin-goto")
    },
    closeMode: () => {
      pendingKey = null
      events.push("close-mode")
    },
    navigate: (destination) => {
      pendingKey = null
      events.push(`navigate:${destination}`)
    },
    openNowPlayingContext: record("now-playing"),
    openPalette: record("palette"),
    popBrowsePage: record("pop-browse"),
    openVisualizerSettings: record("visualizer-settings"),
    moveBrowseSelection: (delta) => events.push(`browse:${delta}`),
    openSelectedBrowseItem: record("open-browse"),
    loadMoreSelectedBrowseSection: record("load-browse"),
    openSelectedInfo: record("info"),
    moveSelection: (delta) => events.push(`selection:${delta}`),
    activateSelection: record("activate"),
    togglePlayback: record("toggle-playback"),
    playPrevious: record("previous"),
    toggleLike: record("like"),
    toggleFavorite: record("favorite"),
    cycleRepeat: record("repeat"),
    playRandom: record("random"),
    playNext: record("next"),
    toggleVisualizer: record("visualizer"),
    seekBy: (seconds) => events.push(`seek:${seconds}`),
    openSearchOrFilter: record("search-or-filter"),
    openSelectedAlbum: record("album"),
    loadMore: record("load-more"),
    openHelp: record("help"),
    escape: record("escape"),
    quit: record("quit"),
  }

  return {
    controller: new NormalModeKeyController(host),
    events,
    setBrowsePage: (value: boolean) => (browsePage = value),
  }
}

describe("NormalModeKeyController", () => {
  test("resolves goto chords and cancels an unknown target", () => {
    const setup = setupHost()

    setup.controller.handle(key("g"))
    setup.controller.handle(key("r"))
    setup.controller.handle(key("g"))
    setup.controller.handle(key("n"))
    setup.controller.handle(key("g"))
    setup.controller.handle(key("x"))

    expect(setup.events).toEqual([
      "begin-goto",
      "navigate:radio",
      "begin-goto",
      "close-mode",
      "now-playing",
      "begin-goto",
      "close-mode",
    ])
  })

  test("gives browse controls precedence and routes global controls", () => {
    const setup = setupHost()
    setup.setBrowsePage(true)

    setup.controller.handle(key("j"))
    setup.controller.handle(key("i"))
    setup.controller.handle(key("escape"))
    setup.controller.handle(key("p", { ctrl: true }))
    setup.controller.handle(key("v", { shift: true, sequence: "V" }))

    expect(setup.events).toEqual([
      "browse:1",
      "pop-browse",
      "palette",
      "visualizer-settings",
    ])
  })

  test("uses five-second and shifted fifteen-second seek steps", () => {
    const setup = setupHost()

    setup.controller.handle(key("left"))
    setup.controller.handle(key("right", { shift: true }))
    setup.controller.handle(key("left", { ctrl: true }))

    expect(setup.events).toEqual(["seek:-5", "seek:15"])
  })
})
