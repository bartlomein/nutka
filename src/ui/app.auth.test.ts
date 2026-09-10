import { afterEach, describe, expect, test } from "bun:test"

import { createAppFixture } from "./test-support/app-fixture"

const fixture = createAppFixture()
const { createApp } = fixture
afterEach(fixture.destroy)

describe("Nutka TUI: auth", () => {
  test("signs in through a safe browser overlay and exposes sign out afterward", async () => {
    let signIns = 0
    let signOuts = 0
    let cancellations = 0
    await createApp(
      { kittyKeyboard: true },
      () => {},
      {
        onSignIn: () => signIns++,
        onSignOut: () => signOuts++,
        onCancel: () => cancellations++,
      },
    )

    fixture.setup.mockInput.pressKey("p", { ctrl: true })
    await fixture.setup.mockInput.typeText("sign in")
    fixture.setup.mockInput.pressEnter()
    expect(signIns).toBe(1)

    fixture.app.setAppleAuthStatus({
      state: "authorizing",
      expiresAt: "2030-01-01T00:00:00.000Z",
    })
    await fixture.setup.renderOnce()
    const authFrame = fixture.setup.captureCharFrame()
    expect(authFrame).toContain("apple music login")
    expect(authFrame).toContain("No pairing code is required.")
    expect(authFrame).toContain("Waiting for Apple Music")

    fixture.app.setAppleAuthStatus({ state: "validating" })
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("Checking it with Apple Music")

    fixture.app.setAppleAuthStatus({ state: "saving" })
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("Saving it to the system keyring")

    fixture.setup.mockInput.pressEscape()
    expect(cancellations).toBe(1)

    fixture.app.setAppleAuthStatus({ state: "signedIn", storefront: "us" })
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("apple music connected")
    expect(fixture.setup.captureCharFrame()).toContain("stored in the system keyring")
    fixture.setup.mockInput.pressEnter()
    fixture.setup.mockInput.pressKey("p", { ctrl: true })
    await fixture.setup.mockInput.typeText("sign out")
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("Sign out of Apple Music")
    fixture.setup.mockInput.pressEnter()
    expect(signOuts).toBe(1)
  })

  test("keeps compact authorization actionable and cancellable while connecting", async () => {
    let cancellations = 0
    await createApp(
      { width: 40, height: 10, kittyKeyboard: true },
      () => {},
      { onSignIn: () => {}, onCancel: () => cancellations++ },
    )

    fixture.app.setAppleAuthStatus({ state: "connecting" })
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("esc cancel")
    fixture.setup.mockInput.pressEscape()
    expect(cancellations).toBe(1)

    fixture.app.setAppleAuthStatus({
      state: "authorizing",
      expiresAt: "2030-01-01T00:00:00.000Z",
    })
    await fixture.setup.renderOnce()
    const frame = fixture.setup.captureCharFrame()
    expect(frame).toContain("No pairing code")
    expect(frame).toContain("Waiting for Apple")
  })

  test("offers keyring restore and credential cleanup retries", async () => {
    let restores = 0
    let signOuts = 0
    await createApp(
      { width: 60, height: 20 },
      () => {},
      {
        onSignIn: () => {},
        onSignOut: () => signOuts++,
        onRestore: () => restores++,
      },
    )

    fixture.app.setAppleAuthStatus({ state: "error", code: "credential_load_failed" })
    fixture.setup.mockInput.pressKey("p", { ctrl: true })
    await fixture.setup.mockInput.typeText("keyring")
    fixture.setup.mockInput.pressEnter()
    expect(restores).toBe(1)

    fixture.app.setAppleAuthStatus({ state: "error", code: "credential_save_failed" })
    fixture.setup.mockInput.pressKey("p", { ctrl: true })
    await fixture.setup.mockInput.typeText("incomplete")
    fixture.setup.mockInput.pressEnter()
    expect(signOuts).toBe(1)

    fixture.app.setAppleAuthStatus({ state: "error", code: "credential_delete_failed" })
    await fixture.setup.renderOnce()
    expect(fixture.setup.captureCharFrame()).toContain("apple × sign-out")
  })
})
