import { describe, expect, test } from "bun:test"
import { AppleAuthManager } from "../apple-auth"
import type { Fetch } from "../token-service"
import {
  browserSession,
  cliToken,
  deferred,
  expiresAt,
  serviceUrl,
  store,
  successFetch,
  userToken,
} from "./test-helpers"

describe("AppleAuthManager cancellation and cleanup", () => {
  test("cancels the broker and wakes a pending poll", async () => {
    const credentials = store()
    const events = credentials.events
    let sleepStarted!: () => void
    const sleeping = new Promise<void>((resolve) => (sleepStarted = resolve))
    const manager = new AppleAuthManager({
      serviceUrl,
      credentialStore: credentials.credentialStore,
      fetch: successFetch(events, "pending"),
      openBrowser: () => browserSession(() => events.push("browser-close")),
      sleep: async () => sleeping,
      now: () => 1_000,
    })
    const signingIn = manager.signIn()
    while (!events.includes("status")) await Promise.resolve()

    await manager.cancel()
    await signingIn
    expect(events).toContain("cancel")
    expect(events).toContain("browser-close")
    expect(manager.status).toEqual({ state: "signedOut" })
    sleepStarted()
  })

  test("closes Chromium when authorization status polling fails", async () => {
    const credentials = store()
    const events = credentials.events
    const baseFetch = successFetch(events)
    let failedStatus = false
    const manager = new AppleAuthManager({
      serviceUrl,
      credentialStore: credentials.credentialStore,
      fetch: async (input, init) => {
        if (String(input).endsWith("/auth/sessions/status") && !failedStatus) {
          failedStatus = true
          events.push("status-failed")
          return Response.json({ error: "unavailable" }, { status: 500 })
        }
        return baseFetch(input, init)
      },
      openBrowser: () => browserSession(() => events.push("browser-close")),
      now: () => 1_000,
    })

    await expect(manager.signIn()).rejects.toMatchObject({
      code: "service_unavailable",
    })
    expect(events).toContain("browser-close")

    await manager.signIn()
    expect(manager.status).toEqual({ state: "signedIn", storefront: "gb" })
  })

  test("times out at expiry and best-effort cancels", async () => {
    const credentials = store()
    const events = credentials.events
    let now = Date.parse(expiresAt) - 1
    const manager = new AppleAuthManager({
      serviceUrl,
      credentialStore: credentials.credentialStore,
      fetch: successFetch(events, "pending"),
      openBrowser: () => {},
      sleep: async () => {
        now++
      },
      now: () => now,
    })

    await expect(manager.signIn()).rejects.toMatchObject({ code: "session_expired" })
    expect(events).toContain("cancel")
  })

  test("returns one promise and creates one session for duplicate sign-in", async () => {
    const credentials = store()
    const events = credentials.events
    const manager = new AppleAuthManager({
      serviceUrl,
      credentialStore: credentials.credentialStore,
      fetch: successFetch(events),
      openBrowser: () => {},
      now: () => 1_000,
    })

    const first = manager.signIn()
    const second = manager.signIn()
    expect(second).toBe(first)
    await first
    expect(events.filter((event) => event === "create")).toHaveLength(1)
  })

  test("cancel and logout synchronously invalidate a delayed create", async () => {
    for (const action of ["cancel", "logout"] as const) {
      const credentials = store()
      const created = deferred<Response>()
      let createSignal: AbortSignal | null | undefined
      let createStarted = false
      let browserCalls = 0
      const manager = new AppleAuthManager({
        serviceUrl,
        credentialStore: credentials.credentialStore,
        fetch: async (input, init) => {
          if (String(input).endsWith("/auth/sessions")) {
            createStarted = true
            createSignal = init?.signal
            return created.promise
          }
          return new Response(null, { status: 204 })
        },
        openBrowser: () => {
          browserCalls++
        },
      })
      const signingIn = manager.signIn()
      while (!createStarted) await Promise.resolve()

      const invalidation = manager[action]()
      expect(manager.status).toEqual({
        state: action === "logout" ? "signingOut" : "signedOut",
      })
      expect(createSignal?.aborted).toBe(true)
      await invalidation
      await signingIn
      created.resolve(
        Response.json({
            cliToken,
            authorizationUrl: `${serviceUrl}/authorize#browserToken=browser-secret`,
          expiresAt,
        }),
      )
      await Promise.resolve()
      expect(browserCalls).toBe(0)
      expect(manager.status).toEqual({ state: "signedOut" })
      if (action === "logout") expect(credentials.events).toContain("delete")
    }
  })

  test("a delayed restore cannot overwrite a newer sign-in or logout", async () => {
    const signInCredentials = store(userToken)
    const firstLoad = deferred<string | null>()
    signInCredentials.credentialStore.load = () => firstLoad.promise
    const events = signInCredentials.events
    const signInManager = new AppleAuthManager({
      serviceUrl,
      credentialStore: signInCredentials.credentialStore,
      fetch: successFetch(events),
      openBrowser: () => {},
      now: () => 1_000,
    })
    const restoring = signInManager.restore()
    await signInManager.signIn()
    firstLoad.resolve("old-stored-secret")
    await restoring
    expect(signInManager.status).toEqual({ state: "signedIn", storefront: "gb" })

    const logoutCredentials = store(userToken)
    const secondLoad = deferred<string | null>()
    logoutCredentials.credentialStore.load = () => secondLoad.promise
    const logoutManager = new AppleAuthManager({
      serviceUrl,
      credentialStore: logoutCredentials.credentialStore,
      fetch: successFetch([]),
      openBrowser: () => {},
    })
    const staleRestore = logoutManager.restore()
    await logoutManager.logout()
    secondLoad.resolve(userToken)
    await staleRestore
    expect(logoutManager.status).toEqual({ state: "signedOut" })
    expect(logoutCredentials.value()).toBeNull()
  })

  test("logout during validation prevents save and stale status writes", async () => {
    const credentials = store()
    const events = credentials.events
    const appleResponse = deferred<Response>()
    let validating = false
    const baseFetch = successFetch(events)
    const fetchImpl: Fetch = async (input, init) => {
      if (String(input) === "https://api.music.apple.com/v1/me/storefront") {
        validating = true
        return appleResponse.promise
      }
      return baseFetch(input, init)
    }
    const manager = new AppleAuthManager({
      serviceUrl,
      credentialStore: credentials.credentialStore,
      fetch: fetchImpl,
      openBrowser: () => {},
      now: () => 1_000,
    })
    const signingIn = manager.signIn()
    while (!validating) await Promise.resolve()

    await manager.logout()
    await signingIn
    appleResponse.resolve(
      Response.json({ data: [{ id: "gb", type: "storefronts" }] }),
    )
    await Promise.resolve()
    expect(events).not.toContain("save")
    expect(manager.status).toEqual({ state: "signedOut" })
  })

  test("logout rolls back an in-flight stale save before completing", async () => {
    const credentials = store()
    const saveGate = deferred<void>()
    const originalSave = credentials.credentialStore.save
    credentials.credentialStore.save = async (token) => {
      credentials.events.push("saving")
      await saveGate.promise
      await originalSave(token)
    }
    const manager = new AppleAuthManager({
      serviceUrl,
      credentialStore: credentials.credentialStore,
      fetch: successFetch(credentials.events),
      openBrowser: () => {},
      now: () => 1_000,
    })
    const signingIn = manager.signIn()
    while (!credentials.events.includes("saving")) await Promise.resolve()

    const loggingOut = manager.logout()
    expect(manager.status).toEqual({ state: "signingOut" })
    saveGate.resolve()
    await Promise.all([signingIn, loggingOut])
    expect(credentials.value()).toBeNull()
    expect(manager.status).toEqual({ state: "signedOut" })
  })

  test("dispose waits for an in-flight credential save rollback", async () => {
    const credentials = store()
    const saveGate = deferred<void>()
    const originalSave = credentials.credentialStore.save
    credentials.credentialStore.save = async (token) => {
      credentials.events.push("saving")
      await saveGate.promise
      await originalSave(token)
    }
    const manager = new AppleAuthManager({
      serviceUrl,
      credentialStore: credentials.credentialStore,
      fetch: successFetch(credentials.events),
      openBrowser: () => {},
      now: () => 1_000,
    })
    const signingIn = manager.signIn()
    while (!credentials.events.includes("saving")) await Promise.resolve()

    let disposed = false
    const disposing = manager.dispose().then(() => {
      disposed = true
    })
    await Promise.resolve()
    expect(disposed).toBe(false)
    saveGate.resolve()
    await Promise.all([signingIn, disposing])
    expect(credentials.value()).toBeNull()
    expect(disposed).toBe(true)
  })

  test("bounds browser opening and dispose shuts down immediately", async () => {
    const credentials = store()
    let browserSignal: AbortSignal | undefined
    const browserManager = new AppleAuthManager({
      serviceUrl,
      credentialStore: credentials.credentialStore,
      fetch: successFetch(credentials.events),
      openBrowser: (_url, signal) => {
        browserSignal = signal
        return new Promise<void>(() => {})
      },
      browserTimeoutMs: 5,
      now: () => 1_000,
    })
    await expect(browserManager.signIn()).rejects.toMatchObject({
      code: "browser_open_failed",
    })
    expect(browserSignal?.aborted).toBe(true)

    const disposeEvents: string[] = []
    const disposeManager = new AppleAuthManager({
      serviceUrl,
      credentialStore: store().credentialStore,
      fetch: successFetch(disposeEvents, "pending"),
      openBrowser: () => {},
      sleep: async () => new Promise<void>(() => {}),
      now: () => 1_000,
    })
    const signingIn = disposeManager.signIn()
    while (!disposeEvents.includes("status")) await Promise.resolve()
    const disposing = disposeManager.dispose()
    expect(disposeManager.status).toEqual({ state: "signedOut" })
    await disposing
    await signingIn
    expect(() => disposeManager.signIn()).toThrow()
  })
})
