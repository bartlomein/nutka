import { describe, expect, test } from "bun:test"
import type { KeyEvent } from "@opentui/core"

import { createInitialState, reduceAppState, type AppState } from "../../core/state"
import type { AppleAuthStatus } from "../../services/apple-auth"
import { defaultVisualizerSettings } from "../visualizer/preferences"
import {
  AppInteractionController,
  type AppInteractionHost,
} from "./app-interaction-controller"
import { commands, type CommandId } from "./commands"
import type { InfoTarget } from "./copy"

const infoTarget: InfoTarget = {
  kind: "track",
  track: {
    id: "track-1",
    title: "Test Track",
    artist: "Test Artist",
    album: "Test Album",
    durationSeconds: 180,
  },
}

function key(
  name: string,
  options: Partial<KeyEvent> = {},
): KeyEvent {
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

function command(id: CommandId) {
  return commands.find((item) => item.id === id)!
}

function setupHost(options: { saveFails?: boolean } = {}) {
  let state: AppState = createInitialState([])
  let authStatus: AppleAuthStatus = { state: "signedOut" }
  let contextPicker = false
  let browsePage = false
  const events: string[] = []
  const settingsChanges: unknown[] = []
  const savedSettings: unknown[] = []

  const host: AppInteractionHost = {
    getState: () => state,
    getAppleAuthStatus: () => authStatus,
    hasAppleAuth: () => true,
    hasBrowsePage: () => browsePage,
    hasContextPicker: () => contextPicker,
    selectedInfoTarget: () => infoTarget,
    visibleItemIds: () => ["track-1", "track-2"],
    filteredItemIds: (draft) => draft ? ["track-2"] : ["track-1", "track-2"],
    canOpenAlbum: () => true,
    canOpenInfo: () => true,
    canBrowseNowPlaying: () => true,
    canStartSongStation: () => true,
    canSetShuffleMode: () => true,
    canSetRepeatMode: () => true,
    canToggleCurrentSongLike: () => true,
    canToggleSelectedStationFavorite: () => true,
    canToggleSelectedStationLike: () => true,
    applyState: (action) => {
      events.push(`apply:${action.type}`)
      state = reduceAppState(state, action)
    },
    dispatch: (action) => {
      events.push(`dispatch:${action.type}`)
      state = reduceAppState(state, action)
    },
    render: () => events.push("render"),
    navigate: (destination) => {
      events.push(`navigate:${destination}`)
      state = reduceAppState(state, { type: "navigate", destination })
    },
    touchRadioSelection: () => events.push("touch-radio"),
    submitRadioSearch: (query) => events.push(`radio-search:${query}`),
    submitCatalogSearch: (query) => events.push(`catalog-search:${query}`),
    moveContextSelection: (delta) => events.push(`context:${delta}`),
    closeContextPicker: () => {
      events.push("close-context")
      contextPicker = false
    },
    chooseContextTarget: () => events.push("choose-context"),
    openNowPlayingContext: () => events.push("now-playing-context"),
    popBrowsePage: () => events.push("pop-browse"),
    moveBrowseSelection: (delta) => events.push(`browse:${delta}`),
    openSelectedBrowseItem: () => events.push("open-browse-item"),
    loadMoreSelectedBrowseSection: () => events.push("load-browse"),
    moveSelection: (delta) => events.push(`selection:${delta}`),
    activateSelection: () => events.push("activate"),
    togglePlayback: () => events.push("toggle-playback"),
    playPrevious: () => events.push("previous"),
    toggleCurrentSongLike: () => events.push("like-song"),
    toggleSelectedStationFavorite: () => events.push("favorite-station"),
    toggleSelectedStationLike: () => events.push("like-station"),
    cycleRepeatMode: () => events.push("repeat"),
    toggleShuffleMode: () => events.push("shuffle"),
    playRandom: () => events.push("random"),
    playNext: () => events.push("next"),
    seekBy: (seconds) => events.push(`seek:${seconds}`),
    openSearchOrFilter: () => events.push("search-or-filter"),
    openSelectedAlbum: () => events.push("album"),
    loadMore: () => events.push("load-more"),
    escapeNormalMode: () => events.push("normal-escape"),
    startCurrentSongStation: () => events.push("song-station"),
    signIn: () => events.push("sign-in"),
    signOut: () => events.push("sign-out"),
    cancelSignIn: () => events.push("cancel-sign-in"),
    restoreSignIn: () => events.push("restore-sign-in"),
    quit: () => events.push("quit"),
    resetInfoScroll: () => events.push("reset-info-scroll"),
    scrollInfo: (delta) => events.push(`info-scroll:${delta}`),
    scrollInfoPage: (delta) => events.push(`info-page:${delta}`),
    scrollInfoTo: (edge) => events.push(`info-to:${edge}`),
    setVisualizerEnabled: (enabled) => events.push(`visualizer:${enabled}`),
    setAudioAnalysisEnabled: (enabled) => events.push(`analysis:${enabled}`),
    setVisualizerSettings: (settings) => settingsChanges.push({ ...settings }),
    saveVisualizerSettings: (settings) => {
      if (options.saveFails) throw new Error("save failed")
      savedSettings.push({ ...settings })
    },
    resize: () => events.push("resize"),
  }
  const controller = new AppInteractionController(host, { ...defaultVisualizerSettings })

  return {
    controller,
    events,
    settingsChanges,
    savedSettings,
    state: () => state,
    setState: (next: AppState) => (state = next),
    setAuthStatus: (next: AppleAuthStatus) => (authStatus = next),
    setContextPicker: (value: boolean) => (contextPicker = value),
    setBrowsePage: (value: boolean) => (browsePage = value),
  }
}

describe("AppInteractionController", () => {
  test("routes keys through modal precedence", () => {
    const setup = setupHost()
    setup.controller.handleKey(key("i"))
    setup.setContextPicker(true)
    setup.controller.executeCommand(command("visualizer-settings"))
    setup.events.length = 0

    setup.controller.handleKey(key("down"))
    expect(setup.controller.snapshot().visualizerSettingsDialog?.selectedIndex).toBe(1)
    expect(setup.events).toEqual(["render"])

    setup.controller.handleKey(key("escape"))
    setup.events.length = 0
    setup.controller.handleKey(key("down"))
    expect(setup.events).toEqual(["context:1"])

    setup.controller.handleKey(key("escape"))
    setup.events.length = 0
    setup.controller.handleKey(key("down"))
    expect(setup.events).toEqual(["info-scroll:1"])
  })

  test("routes normal keys and goto chords", () => {
    const setup = setupHost()

    setup.controller.handleKey(key("g"))
    expect(setup.state().mode).toEqual({ type: "normal", pendingKey: "g" })
    setup.controller.handleKey(key("h"))
    expect(setup.events).toContain("navigate:home")

    setup.controller.handleKey(key("g"))
    setup.controller.handleKey(key("n"))
    expect(setup.events.slice(-2)).toEqual([
      "dispatch:close-mode",
      "now-playing-context",
    ])

    setup.setBrowsePage(true)
    setup.controller.handleKey(key("j"))
    setup.controller.handleKey(key("i"))
    expect(setup.events).toContain("browse:1")
    expect(setup.controller.snapshot().infoTarget).toBeUndefined()

    setup.setBrowsePage(false)
    setup.controller.handleKey(key("p", { ctrl: true }))
    expect(setup.state().mode.type).toBe("palette")
  })

  test("dispatches navigation, playback, auth, and quit commands", () => {
    const setup = setupHost()

    setup.controller.executeCommand(command("radio"))
    setup.controller.executeCommand(command("shuffle"))
    setup.controller.executeCommand(command("favorite-station"))
    setup.controller.executeCommand(command("apple-sign-in"))
    setup.controller.executeCommand(command("apple-cleanup"))
    setup.controller.executeCommand(command("quit"))

    expect(setup.events).toEqual([
      "navigate:radio",
      "apply:close-mode",
      "shuffle",
      "apply:close-mode",
      "favorite-station",
      "dispatch:close-mode",
      "sign-in",
      "dispatch:close-mode",
      "sign-out",
      "dispatch:close-mode",
      "quit",
    ])
  })

  test("previews and rolls back visualizer settings", () => {
    const setup = setupHost()

    setup.controller.handleKey(key("V", { name: "v", shift: true }))
    setup.controller.handleKey(key("down"))
    setup.controller.handleKey(key("right"))
    expect(setup.settingsChanges).toHaveLength(1)
    expect(setup.settingsChanges[0]).not.toEqual(defaultVisualizerSettings)

    setup.controller.handleKey(key("escape"))
    expect(setup.settingsChanges.at(-1)).toEqual(defaultVisualizerSettings)
    expect(setup.controller.snapshot().visualizerSettings).toEqual(defaultVisualizerSettings)
    expect(setup.controller.snapshot().visualizerSettingsDialog).toBeUndefined()
  })

  test("commits settings only after a successful save", () => {
    const setup = setupHost()
    setup.controller.handleKey(key("V", { name: "v", shift: true }))
    setup.controller.handleKey(key("down"))
    setup.controller.handleKey(key("right"))
    const draft = setup.controller.snapshot().visualizerSettingsDialog!.draft
    setup.controller.handleKey(key("enter"))

    expect(setup.savedSettings).toEqual([draft])
    expect(setup.controller.snapshot().visualizerSettings).toEqual(draft)
    expect(setup.controller.snapshot().visualizerSettingsDialog).toBeUndefined()
  })

  test("keeps the dialog open and the committed settings unchanged on save failure", () => {
    const setup = setupHost({ saveFails: true })
    setup.controller.handleKey(key("V", { name: "v", shift: true }))
    setup.controller.handleKey(key("down"))
    setup.controller.handleKey(key("right"))
    setup.controller.handleKey(key("enter"))

    expect(setup.controller.snapshot().visualizerSettings).toEqual(defaultVisualizerSettings)
    expect(setup.controller.snapshot().visualizerSettingsDialog?.error).toBe(
      "Could not save visualizer settings",
    )
  })

  test("gates all interaction while authentication is in progress", () => {
    const setup = setupHost()
    setup.setAuthStatus({ state: "validating" })

    setup.controller.handleKey(key("j"))
    setup.controller.handleKey(key("escape"))

    expect(setup.events).toEqual(["cancel-sign-in"])
  })
})
