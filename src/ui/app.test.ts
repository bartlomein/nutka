import { afterEach, describe, expect, test } from "bun:test"
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing"

import { fakeTracks } from "../data/fake-tracks"
import { createNutaApp, type NutaApp } from "./app"

let setup: TestRendererSetup | undefined
let app: NutaApp | undefined

afterEach(() => {
  app?.destroy()
  setup?.renderer.destroy()
  app = undefined
  setup = undefined
})

describe("Nuta TUI", () => {
  test("renders the main music regions", async () => {
    setup = await createTestRenderer({ width: 120, height: 32 })
    app = createNutaApp(setup.renderer, {
      tracks: fakeTracks,
      onQuit: () => {},
    })

    await setup.renderOnce()
    const frame = setup.captureCharFrame()

    expect(frame).toContain("nuta")
    expect(frame).toContain("Search")
    expect(frame).toContain("Soft Static")
    expect(frame).toContain("up next")
    expect(frame).toContain("nothing playing")
  })

  test("moves, plays, pauses, and searches from the keyboard", async () => {
    setup = await createTestRenderer({ width: 120, height: 32 })
    app = createNutaApp(setup.renderer, {
      tracks: fakeTracks,
      onQuit: () => {},
    })

    setup.mockInput.pressKey("j")
    setup.mockInput.pressEnter()
    setup.mockInput.pressKey(" ")
    setup.mockInput.pressKey("/")
    await setup.mockInput.typeText("glass")
    await setup.renderOnce()

    expect(app.getState()).toMatchObject({
      inputMode: "search",
      query: "glass",
      selectedIndex: 0,
      currentTrackId: "glass-horizon",
      playbackStatus: "paused",
    })
    expect(setup.captureCharFrame()).toContain("Glass Horizon")
  })

  test("hides secondary panes in a narrow terminal", async () => {
    setup = await createTestRenderer({ width: 60, height: 22 })
    app = createNutaApp(setup.renderer, {
      tracks: fakeTracks,
      onQuit: () => {},
    })

    await setup.renderOnce()
    const frame = setup.captureCharFrame()

    expect(frame).toContain("Search")
    expect(frame).not.toContain("up next")
    expect(frame).not.toContain("1  home")
  })
})
