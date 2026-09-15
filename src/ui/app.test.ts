import { afterEach, describe, expect, test } from "bun:test"

import { createAppFixture } from "./test-support/app-fixture"

const fixture = createAppFixture()
const { createApp } = fixture
afterEach(fixture.destroy)

describe("Nutka TUI: navigation and layout", () => {
  test("starts with an honest empty Apple Music workspace", async () => {
    await createApp({ tracks: [] })
    await fixture.setup.renderOnce()
    const frame = fixture.setup.captureCharFrame()

    expect(frame).toContain("Apple Music Home is not loaded yet")
    expect(frame).toContain("DESTINATIONS")
    expect(frame).toContain("› Home")
    expect(frame).toContain("QUEUE")
    expect(frame).toContain("queue is empty")
    expect(frame).not.toContain("First Track")

    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("s")
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("Type a search and press Enter")
  })

  test("uses ctrl+p for commands rather than track search", async () => {
    await createApp()

    fixture.setup.mockInput.pressKey("p", { ctrl: true })
    await fixture.setup.mockInput.typeText("queue")
    await fixture.setup.renderOnce()

    expect(fixture.app.getState().mode).toEqual({
      type: "palette",
      query: "queue",
      selectedIndex: 0,
    })
    expect(fixture.setup.captureCharFrame()).toContain("commands")
    expect(fixture.setup.captureCharFrame()).toContain("Go to Queue")

    fixture.setup.mockInput.pressEnter()
    await fixture.setup.renderOnce()

    expect(fixture.app.getState().destination).toBe("queue")
    expect(fixture.app.getState().mode.type).toBe("normal")
    expect(fixture.setup.captureCharFrame()).toContain("queue is empty")
  })

  test("shows contextual help without letting q quit through the overlay", async () => {
    let quitCount = 0
    await createApp({}, () => quitCount++)

    fixture.setup.mockInput.pressKey("?")
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("keyboard help")
    expect(fixture.setup.captureCharFrame()).toContain("g h home")
    expect(fixture.setup.captureCharFrame()).toContain("g l library")
    expect(fixture.setup.captureCharFrame()).toContain("b/s/n")
    expect(fixture.setup.captureCharFrame()).toContain("r repeat")
    expect(fixture.setup.captureCharFrame()).toContain("f station favorite")
    expect(fixture.setup.captureCharFrame()).toContain("v visualizer")
    expect(fixture.setup.captureCharFrame()).toContain("V settings")
    expect(fixture.setup.captureCharFrame()).toContain("shift+←/→  seek 15s")

    fixture.setup.mockInput.pressKey("q")
    expect(fixture.app.getState().mode.type).toBe("help")
    expect(quitCount).toBe(0)

    fixture.setup.mockInput.pressKey("?")
    fixture.setup.mockInput.pressKey("q")
    expect(quitCount).toBe(1)
  })

  test("adapts the same workspace across wide and narrow terminals", async () => {
    await createApp()
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("l")
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("First Album")

    fixture.setup.resize(60, 22)
    await fixture.setup.renderOnce()
    const frame = fixture.setup.captureCharFrame()

    expect(frame).toContain("First Track — Artist One")
    expect(frame).not.toContain("First Album")
    expect(frame).not.toContain("apple music")
    expect(frame).not.toContain("playlists")
  })

  test("hides the wide rail below the wide-terminal breakpoint", async () => {
    await createApp({ width: 100, height: 24 })
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("l")
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).not.toContain("DESTINATIONS")

    fixture.setup.resize(60, 22)
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).not.toContain("DESTINATIONS")
    expect(fixture.setup.captureCharFrame()).toContain("First Track — Artist One")
  })

  test("hides the wide rail when short terminals cannot fit its queue", async () => {
    for (const height of [21, 22]) {
      const shortFixture = createAppFixture()
      await shortFixture.createApp({ width: 120, height })
      shortFixture.setup.mockInput.pressKey("g")
      shortFixture.setup.mockInput.pressKey("l")
      await shortFixture.setup.renderOnce()
      const frame = shortFixture.setup.captureCharFrame()

      expect(frame).not.toContain("DESTINATIONS")
      expect(frame).not.toContain("QUEUE")
      expect(frame).toContain("First Track")
      expect(frame).toContain("nothing playing")
      expect(frame).toContain("NORMAL")
      expect(frame).not.toContain("SPECTRUM")
      shortFixture.destroy()
    }
  })

  test("keeps palette selection visible in a short terminal", async () => {
    let quitCount = 0
    await createApp({ width: 60, height: 12 }, () => quitCount++)

    fixture.setup.mockInput.pressKey("p", { ctrl: true })
    for (let index = 0; index < 10; index++) fixture.setup.mockInput.pressArrow("down")
    await fixture.setup.renderOnce()
    const frame = fixture.setup.captureCharFrame()

    expect(frame).toContain("Quit Nutka")
    expect(frame).not.toContain("Go to Library")
    fixture.setup.mockInput.pressEnter()
    expect(quitCount).toBe(1)
  })

  test("preserves content and controls in a very short terminal", async () => {
    await createApp({ width: 60, height: 10 })
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("l")
    await fixture.setup.renderOnce()
    const frame = fixture.setup.captureCharFrame()

    expect(frame).toContain("First Track — Artist One")
    expect(frame).toContain("nothing playing")
    expect(frame).toContain("NORMAL")
  })

  test("cancels a pending destination chord without running its suffix", async () => {
    let quitCount = 0
    await createApp({ kittyKeyboard: true }, () => quitCount++)

    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressKey("q")
    fixture.setup.mockInput.pressKey("g")
    fixture.setup.mockInput.pressEscape()

    expect(fixture.app.getState().destination).toBe("queue")
    expect(fixture.app.getState().mode).toEqual({ type: "normal", pendingKey: null })
    expect(quitCount).toBe(0)

    fixture.setup.mockInput.pressKey("q", { ctrl: true })
    fixture.setup.mockInput.pressKey("q", { shift: true })
    expect(quitCount).toBe(0)
  })

  test("does not expose a playback command before playback is connected", async () => {
    await createApp()
    fixture.setup.mockInput.pressKey("p", { ctrl: true })
    await fixture.setup.mockInput.typeText("pause")
    await fixture.setup.renderOnce()

    expect(fixture.setup.captureCharFrame()).toContain("no matching commands")
    expect(fixture.app.getState().playback.status).toBe("idle")
  })
})
