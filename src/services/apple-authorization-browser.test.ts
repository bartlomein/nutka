import { chmod, mkdir, mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"
import type { LaunchOptions } from "puppeteer-core"

import {
  AppleAuthorizationBrowserError,
  AppleAuthorizationBrowserLauncher,
  type AppleAuthorizationBrowser,
  type AppleAuthorizationBrowserPage,
} from "./apple-authorization-browser"
import type { AppleAuthManagerOptions } from "./apple-auth"
import { playbackBrowserEnvironment } from "./chromium-process"

const token = "browser-secret-NOT-IN-PROCESS-OPTIONS"
const authorizationUrl = `http://127.0.0.1:8787/authorize#browserToken=${token}`

class FakePage implements AppleAuthorizationBrowserPage {
  readonly listeners = new Map<string, () => void>()
  readonly navigations: Array<{
    url: string
    options: { waitUntil: "domcontentloaded"; timeout: number }
  }> = []

  constructor(private readonly navigate: () => Promise<unknown> = async () => {}) {}

  on(event: "console" | "pageerror", listener: () => void): void {
    this.listeners.set(event, listener)
  }

  async goto(
    url: string,
    options: { waitUntil: "domcontentloaded"; timeout: number },
  ): Promise<unknown> {
    this.navigations.push({ url, options })
    return this.navigate()
  }
}

class FakeBrowser implements AppleAuthorizationBrowser {
  closeCalls = 0

  constructor(readonly page = new FakePage()) {}

  async newPage(): Promise<AppleAuthorizationBrowserPage> {
    return this.page
  }

  async close(): Promise<void> {
    this.closeCalls++
  }
}

describe("Apple authorization browser", () => {
  test("launches visible Chromium with the private playback profile", async () => {
    const page = new FakePage()
    const browser = new FakeBrowser(page)
    const profilePath = "/state/nutka/chromium-profile"
    const prepared: string[] = []
    let launchOptions: LaunchOptions | undefined
    const previousSecret = process.env.NUTKA_TEST_BROWSER_SECRET
    process.env.NUTKA_TEST_BROWSER_SECRET = token

    try {
      const launcher = new AppleAuthorizationBrowserLauncher({
        profilePath: () => profilePath,
        prepareProfile: async (path) => {
          prepared.push(path)
        },
        launch: async (options) => {
          launchOptions = options
          return browser
        },
      })

      const session = launcher.openBrowser(authorizationUrl)
      const injectedOpenBrowser: NonNullable<AppleAuthManagerOptions["openBrowser"]> =
        launcher.openBrowser.bind(launcher)
      await session

      expect(prepared).toEqual([profilePath])
      expect(injectedOpenBrowser).toBeFunction()
      expect(launchOptions).toMatchObject({
        executablePath: "/usr/bin/chromium",
        headless: false,
        pipe: true,
        userDataDir: profilePath,
        ignoreDefaultArgs: ["--mute-audio"],
        timeout: 30_000,
        env: playbackBrowserEnvironment(process.env),
      })
      expect(launchOptions?.args).toBeUndefined()
      expect(JSON.stringify(launchOptions?.env)).not.toContain(token)
      expect(JSON.stringify(launchOptions?.args ?? [])).not.toContain(token)
      expect(page.listeners.has("console")).toBe(true)
      expect(page.listeners.has("pageerror")).toBe(true)
      expect(() => page.listeners.get("console")?.()).not.toThrow()
      expect(() => page.listeners.get("pageerror")?.()).not.toThrow()
      expect(page.navigations).toEqual([
        {
          url: authorizationUrl,
          options: { waitUntil: "domcontentloaded", timeout: 30_000 },
        },
      ])

      const firstClose = session.close()
      const secondClose = session.close()
      expect(secondClose).toBe(firstClose)
      await Promise.all([firstClose, secondClose])
      expect(browser.closeCalls).toBe(1)
    } finally {
      if (previousSecret === undefined) delete process.env.NUTKA_TEST_BROWSER_SECRET
      else process.env.NUTKA_TEST_BROWSER_SECRET = previousSecret
    }
  })

  test("creates an existing persistent profile with mode 0700", async () => {
    const root = await mkdtemp(join(tmpdir(), "nutka-authorization-browser-"))
    const profilePath = join(root, "profile")
    await mkdir(profilePath)
    await chmod(profilePath, 0o755)
    const browser = new FakeBrowser()
    let session: { close(): Promise<void> } | undefined

    try {
      const launcher = new AppleAuthorizationBrowserLauncher({
        profilePath: () => profilePath,
        launch: async () => browser,
      })
      const opening = launcher.openBrowser(authorizationUrl)
      session = opening
      await opening

      expect((await stat(profilePath)).mode & 0o777).toBe(0o700)
    } finally {
      await session?.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("strictly rejects authorization URL variations before profile access", async () => {
    let profileAccesses = 0
    let launches = 0
    const launcher = new AppleAuthorizationBrowserLauncher({
      profilePath: () => {
        profileAccesses++
        return "/unused"
      },
      prepareProfile: async () => {},
      launch: async () => {
        launches++
        return new FakeBrowser()
      },
    })
    const longToken = "a".repeat(129)
    const invalid = [
      `https://127.0.0.1:8787/authorize#browserToken=${token}`,
      `http://localhost:8787/authorize#browserToken=${token}`,
      `http://127.0.0.1/authorize#browserToken=${token}`,
      `http://127.0.0.1:0/authorize#browserToken=${token}`,
      `http://127.0.0.1:65536/authorize#browserToken=${token}`,
      `http://user@127.0.0.1:8787/authorize#browserToken=${token}`,
      `http://127.0.0.1:8787/authorize/?#browserToken=${token}`,
      `http://127.0.0.1:8787/authorize?next=x#browserToken=${token}`,
      "http://127.0.0.1:8787/authorize",
      "http://127.0.0.1:8787/authorize#browserToken=",
      `http://127.0.0.1:8787/authorize#browserToken=${token}&browserToken=second`,
      `http://127.0.0.1:8787/authorize#browserToken=${token}&other=value`,
      `http://127.0.0.1:8787/authorize#browserToken=${longToken}`,
      "http://127.0.0.1:8787/authorize#browserToken=encoded%20token",
    ]

    for (const url of invalid) {
      await expect(launcher.openBrowser(url)).rejects.toMatchObject({
        code: "invalid_authorization_url",
      })
    }
    expect(profileAccesses).toBe(0)
    expect(launches).toBe(0)
  })

  test("closes a browser when launch or navigation is aborted", async () => {
    const launchGate = Promise.withResolvers<AppleAuthorizationBrowser>()
    const launchBrowser = new FakeBrowser()
    let launchOptions: LaunchOptions | undefined
    const launchController = new AbortController()
    const launchLauncher = new AppleAuthorizationBrowserLauncher({
      profilePath: () => "/profile",
      prepareProfile: async () => {},
      launch: async (options) => {
        launchOptions = options
        return launchGate.promise
      },
    })
    const openingDuringLaunch = launchLauncher.openBrowser(
      authorizationUrl,
      launchController.signal,
    )
    while (!launchOptions) await Promise.resolve()

    launchController.abort()
    launchGate.resolve(launchBrowser)
    const launchError = await rejection(openingDuringLaunch)
    expect(launchOptions.signal).toBe(launchController.signal)
    expect(launchError).toMatchObject({ code: "aborted" })
    expect(String(launchError)).not.toContain(token)
    expect(launchBrowser.closeCalls).toBe(1)

    const navigationGate = Promise.withResolvers<void>()
    const page = new FakePage(() => navigationGate.promise)
    const navigationBrowser = new FakeBrowser(page)
    const navigationController = new AbortController()
    const navigationLauncher = new AppleAuthorizationBrowserLauncher({
      profilePath: () => "/profile",
      prepareProfile: async () => {},
      launch: async () => navigationBrowser,
    })
    const openingDuringNavigation = navigationLauncher.openBrowser(
      authorizationUrl,
      navigationController.signal,
    )
    while (page.navigations.length === 0) await Promise.resolve()

    navigationController.abort()
    navigationGate.resolve()
    const navigationError = await rejection(openingDuringNavigation)
    expect(navigationError).toMatchObject({ code: "aborted" })
    expect(String(navigationError)).not.toContain(token)
    expect(navigationBrowser.closeCalls).toBe(1)
  })

  test("rejects concurrent use of the persistent profile", async () => {
    const firstLaunch = Promise.withResolvers<AppleAuthorizationBrowser>()
    const firstBrowser = new FakeBrowser()
    const secondBrowser = new FakeBrowser()
    let launches = 0
    let profilePreparations = 0
    const launcher = new AppleAuthorizationBrowserLauncher({
      profilePath: () => "/profile",
      prepareProfile: async () => {
        profilePreparations++
      },
      launch: async () => {
        launches++
        return launches === 1 ? firstLaunch.promise : secondBrowser
      },
    })
    const firstOpening = launcher.openBrowser(authorizationUrl)
    while (launches === 0) await Promise.resolve()

    await expect(launcher.openBrowser(authorizationUrl)).rejects.toMatchObject({
      code: "browser_in_use",
    })
    expect(launches).toBe(1)
    expect(profilePreparations).toBe(1)

    firstLaunch.resolve(firstBrowser)
    await firstOpening
    await expect(launcher.openBrowser(authorizationUrl)).rejects.toMatchObject({
      code: "browser_in_use",
    })
    await firstOpening.close()

    const secondSession = launcher.openBrowser(authorizationUrl)
    await secondSession
    expect(launches).toBe(2)
    expect(profilePreparations).toBe(2)
    await secondSession.close()
  })

  test("sanitizes navigation failures and closes Chromium", async () => {
    const browser = new FakeBrowser(
      new FakePage(async () => {
        throw new Error(`navigation exposed ${token}`)
      }),
    )
    const launcher = new AppleAuthorizationBrowserLauncher({
      executablePath: "/opt/chromium",
      profilePath: () => "/profile",
      prepareProfile: async () => {},
      launch: async (options) => {
        expect(options.executablePath).toBe("/opt/chromium")
        return browser
      },
    })

    const error = await rejection(launcher.openBrowser(authorizationUrl))
    expect(error).toBeInstanceOf(AppleAuthorizationBrowserError)
    expect(error).toMatchObject({ code: "browser_open_failed" })
    expect(String(error)).not.toContain(token)
    expect(browser.closeCalls).toBe(1)
  })
})

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error("Expected promise to reject")
}
