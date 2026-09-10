import { expect } from "bun:test"
import type { CredentialStore } from "../credentials"
import type { Fetch } from "../token-service"
import type { AppleAuthorizationBrowserSession } from "./types"

export const serviceUrl = "http://127.0.0.1:8787"
export const userToken = "music-user-super-secret"
export const cliToken = "cli-super-secret"
export const expiresAt = "2030-01-01T00:00:00.000Z"

export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

export function browserSession(onClose: () => void): AppleAuthorizationBrowserSession {
  const session = Promise.resolve() as AppleAuthorizationBrowserSession
  session.close = async () => onClose()
  return session
}

export function store(initial: string | null = null) {
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

export function successFetch(events: string[], status: "pending" | "complete" = "complete"): Fetch {
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
