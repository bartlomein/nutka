import { describe, expect, test } from "bun:test"
import { AppleAuthManager, type AppleAuthStatus } from "../apple-auth"
import type { Fetch } from "../token-service"
import {
  browserSession,
  cliToken,
  expiresAt,
  serviceUrl,
  store,
  successFetch,
  userToken,
} from "./test-helpers"

describe("AppleAuthManager sign-in and restore", () => {
  test("orders create, browser, validation, save, then safe signed-in status", async () => {
    const credentials = store()
    const events = credentials.events
    const statuses: AppleAuthStatus[] = []
    const authEvents: Array<{ event: string; code?: string }> = []
    const manager = new AppleAuthManager({
      serviceUrl,
      credentialStore: credentials.credentialStore,
      fetch: successFetch(events),
      openBrowser: (url) => {
        events.push("browser")
        expect(url).toBe(`${serviceUrl}/authorize#browserToken=browser-secret`)
        return browserSession(() => events.push("browser-close"))
      },
      now: () => 1_000,
      logger: {
        log(event, details) {
          authEvents.push({ event, code: details?.code })
        },
      },
    })
    manager.subscribe((status) => statuses.push(status))

    await manager.signIn()

    expect(events).toEqual([
      "create",
      "browser",
      "status",
      "browser-close",
      "developer",
      "validate",
      "save",
      "acknowledge",
    ])
    expect(manager.status).toEqual({ state: "signedIn", storefront: "gb" })
    const statusStates = statuses.map(({ state }) => state)
    for (const expected of [
      "connecting",
      "authorizing",
      "validating",
      "saving",
      "signedIn",
    ] as const) {
      expect(statusStates).toContain(expected)
    }
    const loggedEvents = authEvents.map(({ event }) => event)
    for (const expected of [
      "session_created",
      "browser_open_succeeded",
      "authorization_received",
      "validation_succeeded",
      "credential_save_succeeded",
      "sign_in_succeeded",
    ]) {
      expect(loggedEvents).toContain(expected)
    }
    expect(JSON.stringify(statuses)).not.toContain(userToken)
    expect(JSON.stringify(statuses)).not.toContain(cliToken)
    expect(JSON.stringify(authEvents)).not.toContain(userToken)
    expect(JSON.stringify(authEvents)).not.toContain(cliToken)
  })

  test("restores valid credentials", async () => {
    const credentials = store(userToken)
    const events = credentials.events
    const manager = new AppleAuthManager({
      serviceUrl,
      credentialStore: credentials.credentialStore,
      fetch: successFetch(events),
      openBrowser: () => {},
    })

    await manager.restore()
    expect(events).toEqual(["load", "developer", "validate"])
    expect(manager.status).toEqual({ state: "signedIn", storefront: "gb" })
  })

  test("hands the user token only to a signed-in callback", async () => {
    const credentials = store(userToken)
    const manager = new AppleAuthManager({
      serviceUrl,
      credentialStore: credentials.credentialStore,
      fetch: successFetch(credentials.events),
      openBrowser: () => {},
    })

    await expect(
      manager.useMusicUserToken(() => "unexpected"),
    ).rejects.toMatchObject({ code: "authorization_invalid" })
    await manager.restore()
    expect(
      await manager.useMusicUserToken((token) => token === userToken),
    ).toBe(true)
    expect(JSON.stringify(manager.status)).not.toContain(userToken)
    await manager.logout()
    await expect(
      manager.useMusicUserToken(() => "unexpected"),
    ).rejects.toMatchObject({ code: "authorization_invalid" })
  })

  test("preserves credentials for ambiguous generic Apple authorization failures", async () => {
    const invalid = store(userToken)
    const unauthorizedFetch: Fetch = async (input) =>
      String(input).endsWith("/developer-token")
        ? Response.json({ token: "developer", expiresAt, mode: "apple" })
        : new Response(null, { status: 401 })
    const manager = new AppleAuthManager({
      serviceUrl,
      credentialStore: invalid.credentialStore,
      fetch: unauthorizedFetch,
      openBrowser: () => {},
    })

    await expect(manager.restore()).rejects.toMatchObject({ code: "service_unavailable" })
    expect(invalid.events).toEqual(["load"])
    expect(invalid.value()).toBe(userToken)
  })

  test("preserves restored credentials on transient validation failure", async () => {
    const credentials = store(userToken)
    const manager = new AppleAuthManager({
      serviceUrl,
      credentialStore: credentials.credentialStore,
      fetch: async () => {
        throw new Error(userToken)
      },
      openBrowser: () => {},
    })

    await expect(manager.restore()).rejects.toMatchObject({ code: "service_unavailable" })
    expect(credentials.events).toEqual(["load"])
    expect(credentials.value()).toBe(userToken)
    expect(JSON.stringify(manager.status)).not.toContain(userToken)
  })

  test("preserves a stored credential when the developer token is mock", async () => {
    const credentials = store(userToken)
    const manager = new AppleAuthManager({
      serviceUrl,
      credentialStore: credentials.credentialStore,
      fetch: async () =>
        Response.json({ token: "mock", expiresAt, mode: "mock" }),
      openBrowser: () => {},
    })

    await expect(manager.restore()).rejects.toMatchObject({ code: "service_unavailable" })
    expect(credentials.events).toEqual(["load"])
    expect(credentials.value()).toBe(userToken)
  })

  test("does not report signed in when saving fails", async () => {
    const credentials = store()
    credentials.credentialStore.save = async () => {
      throw new Error(userToken)
    }
    const manager = new AppleAuthManager({
      serviceUrl,
      credentialStore: credentials.credentialStore,
      fetch: successFetch(credentials.events),
      openBrowser: () => {},
      now: () => 1_000,
    })

    await expect(manager.signIn()).rejects.toMatchObject({ code: "credential_save_failed" })
    expect(manager.status).toEqual({ state: "error", code: "credential_save_failed" })
    expect(JSON.stringify(manager.status)).not.toContain(userToken)
  })

  test("reports load and delete failures without retaining signed-in memory", async () => {
    const loadFailure = store()
    loadFailure.credentialStore.load = async () => {
      throw new Error(userToken)
    }
    const loadManager = new AppleAuthManager({
      serviceUrl,
      credentialStore: loadFailure.credentialStore,
      fetch: successFetch([]),
      openBrowser: () => {},
    })
    await expect(loadManager.restore()).rejects.toMatchObject({
      code: "credential_load_failed",
    })

    const deleteFailure = store(userToken)
    deleteFailure.credentialStore.delete = async () => {
      throw new Error(userToken)
    }
    const deleteManager = new AppleAuthManager({
      serviceUrl,
      credentialStore: deleteFailure.credentialStore,
      fetch: successFetch(deleteFailure.events),
      openBrowser: () => {},
    })
    await deleteManager.restore()
    await expect(deleteManager.logout()).rejects.toMatchObject({
      code: "credential_delete_failed",
    })
    expect(deleteManager.status).toEqual({
      state: "error",
      code: "credential_delete_failed",
    })
    expect(JSON.stringify(deleteManager.status)).not.toContain(userToken)
  })
})
