import { describe, expect, test } from "bun:test"

import { restoreAppleAuthOnStartup } from "./startup"
import type { AppleAuthStatus } from "./types"

function fakeAuth(initialStatus: AppleAuthStatus, events: string[]) {
  let status = initialStatus
  return {
    get status() {
      return status
    },
    restore: async () => {
      events.push("restore")
    },
    signIn: async () => {
      events.push("sign-in")
      status = { state: "connecting" }
    },
  }
}

describe("Apple auth startup", () => {
  test("starts sign-in after restore confirms the user is signed out", async () => {
    const events: string[] = []
    const auth = fakeAuth({ state: "signedOut" }, events)

    await restoreAppleAuthOnStartup(auth)

    expect(events).toEqual(["restore", "sign-in"])
  })

  test("does not start sign-in after restore confirms the user is signed in", async () => {
    const events: string[] = []
    const auth = fakeAuth({ state: "signedIn", storefront: "us" }, events)

    await restoreAppleAuthOnStartup(auth)

    expect(events).toEqual(["restore"])
  })
})
