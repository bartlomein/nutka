import { describe, expect, test } from "bun:test"

import {
  AuthorizationBroker,
  AuthorizationBrokerError,
} from "./apple-authorization-broker"

function deterministicRandom() {
  let call = 0
  return (length: number) => new Uint8Array(length).fill(++call)
}

function browserToken(authorizationUrl: string): string {
  return new URL(authorizationUrl).hash.slice(1).replace("browserToken=", "")
}

describe("AuthorizationBroker", () => {
  test("creates independent credentials with the browser token only in the fragment", () => {
    const broker = new AuthorizationBroker(
      "http://127.0.0.1:8787/authorize",
      () => 1_000,
      deterministicRandom(),
    )
    const created = broker.create("developer-secret")
    const url = new URL(created.authorizationUrl)
    const token = new URLSearchParams(url.hash.slice(1)).get("browserToken")!
    const claimed = broker.claim(token)

    expect(created.cliToken).toHaveLength(43)
    expect(token).toHaveLength(43)
    expect(claimed.browserToken).toHaveLength(43)
    expect(claimed.csrfToken).toHaveLength(43)
    expect(
      new Set([created.cliToken, claimed.browserToken, claimed.csrfToken]).size,
    ).toBe(3)
    expect(created.expiresAt).toBe(new Date(301_000).toISOString())
    expect(url.origin + url.pathname).toBe(
      "http://127.0.0.1:8787/authorize",
    )
    expect(url.search).toBe("")
    expect(url.hash).toBe(`#browserToken=${token}`)
    expect(url.pathname).not.toContain(token)
    expect(url.search).not.toContain(token)
    expect(created).not.toHaveProperty("pairingCode")
    expect(created.authorizationUrl).not.toContain(claimed.csrfToken)
  })

  test("retains completion until it is acknowledged exactly once", () => {
    const broker = new AuthorizationBroker(
      "http://127.0.0.1:8787/authorize",
    )
    const created = broker.create("developer-token")

    expect(broker.status(created.cliToken)).toEqual({ status: "pending" })
    const claim = broker.claim(browserToken(created.authorizationUrl))
    expect(claim.developerToken).toBe("developer-token")
    expect(() => broker.claim(claim.browserToken)).toThrow(
      new AuthorizationBrokerError("already_claimed"),
    )

    broker.complete(claim.browserToken, claim.csrfToken, "music-user-token")
    expect(() =>
      broker.complete(claim.browserToken, claim.csrfToken, "replay"),
    ).toThrow(AuthorizationBrokerError)
    expect(broker.status(created.cliToken)).toEqual({
      status: "complete",
      musicUserToken: "music-user-token",
    })
    expect(broker.status(created.cliToken)).toEqual({
      status: "complete",
      musicUserToken: "music-user-token",
    })
    broker.acknowledge(created.cliToken)
    expect(() => broker.status(created.cliToken)).toThrow(
      AuthorizationBrokerError,
    )
  })

  test("completes concurrent sessions independently", () => {
    const broker = new AuthorizationBroker(
      "http://127.0.0.1:8787/authorize",
    )
    const first = broker.create("developer-token-1")
    const second = broker.create("developer-token-2")

    const secondClaim = broker.claim(browserToken(second.authorizationUrl))
    const firstClaim = broker.claim(browserToken(first.authorizationUrl))
    expect(firstClaim.developerToken).toBe("developer-token-1")
    expect(secondClaim.developerToken).toBe("developer-token-2")

    broker.complete(
      secondClaim.browserToken,
      secondClaim.csrfToken,
      "music-token-2",
    )
    expect(broker.status(first.cliToken)).toEqual({ status: "pending" })
    broker.complete(
      firstClaim.browserToken,
      firstClaim.csrfToken,
      "music-token-1",
    )

    expect(broker.status(first.cliToken)).toEqual({
      status: "complete",
      musicUserToken: "music-token-1",
    })
    expect(broker.status(second.cliToken)).toEqual({
      status: "complete",
      musicUserToken: "music-token-2",
    })
  })

  test("removes expired and terminal sessions and erases retained state", () => {
    let now = 0
    const broker = new AuthorizationBroker(
      "http://127.0.0.1:8787/authorize",
      () => now,
    )
    const expired = broker.create("expired-developer-token")
    now = 1_000
    const active = broker.create("active-developer-token")
    now = 300_000
    expect(() => broker.status(expired.cliToken)).toThrow(
      new AuthorizationBrokerError("expired"),
    )
    expect(broker.status(active.cliToken)).toEqual({ status: "pending" })
    expect(() => broker.claim(browserToken(expired.authorizationUrl))).toThrow(
      AuthorizationBrokerError,
    )

    const indexes = broker as unknown as {
      sessionsByCliToken: Map<string, Record<string, unknown>>
      sessionsByBrowserToken: Map<string, Record<string, unknown>>
    }
    expect(indexes.sessionsByCliToken.size).toBe(1)
    expect(indexes.sessionsByBrowserToken.size).toBe(1)

    const claim = broker.claim(browserToken(active.authorizationUrl))
    const retainedSession = indexes.sessionsByCliToken.get(active.cliToken)!
    broker.complete(claim.browserToken, claim.csrfToken, "active-music-token")
    expect(retainedSession).toMatchObject({
      browserToken: "",
      csrfToken: "",
      developerToken: "",
    })
    expect(broker.status(active.cliToken)).toEqual({
      status: "complete",
      musicUserToken: "active-music-token",
    })
    broker.acknowledge(active.cliToken)
    expect(indexes.sessionsByCliToken.size).toBe(0)
    expect(indexes.sessionsByBrowserToken.size).toBe(0)
    expect(retainedSession).toMatchObject({
      cliToken: "",
      browserToken: "",
      csrfToken: "",
      developerToken: "",
      musicUserToken: undefined,
    })
  })

  test("cancellation removes only the selected session", () => {
    const broker = new AuthorizationBroker(
      "http://127.0.0.1:8787/authorize",
    )
    const cancelled = broker.create("cancelled-developer-token")
    const active = broker.create("active-developer-token")

    broker.cancel(cancelled.cliToken)
    expect(() => broker.status(cancelled.cliToken)).toThrow(
      AuthorizationBrokerError,
    )
    expect(() =>
      broker.claim(browserToken(cancelled.authorizationUrl)),
    ).toThrow(AuthorizationBrokerError)
    expect(broker.status(active.cliToken)).toEqual({ status: "pending" })
  })

  test("caps concurrent sessions until one is removed", () => {
    const broker = new AuthorizationBroker(
      "http://127.0.0.1:8787/authorize",
      Date.now,
      deterministicRandom(),
      2,
    )
    const first = broker.create("developer-token-1")
    broker.create("developer-token-2")

    expect(() => broker.create("developer-token-3")).toThrow(
      new AuthorizationBrokerError("capacity"),
    )
    broker.cancel(first.cliToken)
    expect(broker.create("developer-token-3").cliToken).toHaveLength(43)
  })
})
