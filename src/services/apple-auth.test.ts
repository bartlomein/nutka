import { describe, expect, test } from "bun:test"

import type { CredentialStore } from "./credentials"
import {
  AppleAuthManager,
  acknowledgeAppleAuthorizationSession,
  cancelAppleAuthorizationSession,
  createAppleAuthorizationSession,
  getAppleAuthorizationSessionStatus,
  type AppleAuthorizationBrowserSession,
  type AppleAuthStatus,
} from "./apple-auth"
import type { Fetch } from "./token-service"

const serviceUrl = "http://127.0.0.1:8787"
const userToken = "music-user-super-secret"
const cliToken = "cli-super-secret"
const expiresAt = "2030-01-01T00:00:00.000Z"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

function browserSession(onClose: () => void): AppleAuthorizationBrowserSession {
  const session = Promise.resolve() as AppleAuthorizationBrowserSession
  session.close = async () => onClose()
  return session
}

function store(initial: string | null = null) {
  let value = initial
  const events: string[] = []
  const credentialStore: CredentialStore = {
    async load() {
      events.push("load")
      return value
    },
    async save(token) {
      events.push("save")
      value = token
    },
    async delete() {
      events.push("delete")
      value = null
    },
  }
  return { credentialStore, events, value: () => value }
}

function successFetch(events: string[], status: "pending" | "complete" = "complete"): Fetch {
  return async (input, init) => {
    const url = String(input)
    if (url.endsWith("/auth/sessions")) {
      events.push("create")
      return Response.json(
        {
          cliToken,
          authorizationUrl: `${serviceUrl}/authorize#browserToken=browser-secret`,
          expiresAt,
        },
        { status: 201 },
      )
    }
    if (url.endsWith("/auth/sessions/status")) {
      events.push("status")
      const body = JSON.parse(String(init?.body)) as Record<string, string>
      expect(body).toEqual({ cliToken })
      expect(url).not.toContain(cliToken)
      return Response.json(
        status === "complete" ? { status, musicUserToken: userToken } : { status },
      )
    }
    if (url.endsWith("/auth/sessions/cancel")) {
      events.push("cancel")
      return new Response(null, { status: 204 })
    }
    if (url.endsWith("/auth/sessions/acknowledge")) {
      events.push("acknowledge")
      return new Response(null, { status: 204 })
    }
    if (url.endsWith("/developer-token")) {
      events.push("developer")
      return Response.json({
        token: "developer-secret",
        expiresAt,
        mode: "apple",
      })
    }
    events.push("validate")
    expect(url).toBe("https://api.music.apple.com/v1/me/storefront")
    expect(new Headers(init?.headers).get("music-user-token")).toBe(userToken)
    return Response.json({ data: [{ id: "gb", type: "storefronts" }] })
  }
}

describe("Apple authorization clients", () => {
  test("use typed JSON POST bodies and never put CLI tokens in URLs", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl: Fetch = async (input, init) => {
      calls.push({ url: String(input), init })
      if (String(input).endsWith("/sessions")) {
        return Response.json({
          cliToken,
          authorizationUrl: `${serviceUrl}/authorize#browserToken=browser-secret`,
          expiresAt,
        })
      }
      if (String(input).endsWith("/status")) return Response.json({ status: "pending" })
      return new Response(null, { status: 204 })
    }

    await createAppleAuthorizationSession(serviceUrl, fetchImpl)
    await getAppleAuthorizationSessionStatus(serviceUrl, cliToken, fetchImpl)
    await acknowledgeAppleAuthorizationSession(serviceUrl, cliToken, fetchImpl)
    await cancelAppleAuthorizationSession(serviceUrl, cliToken, fetchImpl)

    expect(calls.every(({ init }) => init?.method === "POST")).toBe(true)
    expect(calls.every(({ init }) => init?.signal instanceof AbortSignal)).toBe(true)
    expect(calls.every(({ url }) => !url.includes(cliToken))).toBe(true)
    expect(calls.slice(1).map(({ init }) => JSON.parse(String(init?.body)))).toEqual([
      { cliToken },
      { cliToken },
      { cliToken },
    ])
  })

  test("requires JSON with valid UTF-8", async () => {
    await expect(
      createAppleAuthorizationSession(
        serviceUrl,
        async () =>
          new Response('{"cliToken":"secret"}', {
            headers: { "content-type": "text/plain" },
          }),
      ),
    ).rejects.toMatchObject({ code: "unavailable" })
    await expect(
      createAppleAuthorizationSession(
        serviceUrl,
        async () =>
          new Response(new Uint8Array([0xc3, 0x28]), {
            headers: { "content-type": "application/json" },
          }),
      ),
    ).rejects.toMatchObject({ code: "unavailable" })
  })

  test("hard-times out and aborts cancellation requests", async () => {
    let signal: AbortSignal | null | undefined
    const stalled: Fetch = async (_input, init) => {
      signal = init?.signal
      return new Promise<Response>(() => {})
    }
    await expect(
      cancelAppleAuthorizationSession(serviceUrl, cliToken, stalled, {
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ code: "unavailable" })
    expect(signal?.aborted).toBe(true)
  })
})

describe("AppleAuthManager", () => {
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
