import { chmod, mkdir } from "node:fs/promises"

import puppeteer, { type LaunchOptions } from "puppeteer-core"

import {
  applePlaybackProfilePath,
  defaultChromiumExecutablePath,
  playbackBrowserEnvironment,
} from "./chromium-process"

const NAVIGATION_TIMEOUT_MS = 30_000
const MAX_BROWSER_TOKEN_LENGTH = 128
const ABORTED = Symbol("aborted")

export type AppleAuthorizationBrowserErrorCode =
  | "invalid_authorization_url"
  | "browser_in_use"
  | "aborted"
  | "browser_open_failed"

export class AppleAuthorizationBrowserError extends Error {
  constructor(readonly code: AppleAuthorizationBrowserErrorCode) {
    super(errorMessage(code))
    this.name = "AppleAuthorizationBrowserError"
  }
}

export interface AppleAuthorizationBrowserPage {
  on(event: "console" | "pageerror", listener: () => void): unknown
  goto(
    url: string,
    options: { waitUntil: "domcontentloaded"; timeout: number },
  ): Promise<unknown>
}

export interface AppleAuthorizationBrowser {
  newPage(): Promise<AppleAuthorizationBrowserPage>
  close(): Promise<void>
}

export type AppleAuthorizationBrowserLaunch = (
  options: LaunchOptions,
) => Promise<AppleAuthorizationBrowser>

export interface AppleAuthorizationBrowserSession extends Promise<void> {
  close(): Promise<void>
}

export interface AppleAuthorizationBrowserLauncherOptions {
  executablePath?: string
  launch?: AppleAuthorizationBrowserLaunch
  profilePath?: () => string
  prepareProfile?: (profilePath: string) => Promise<void>
}

interface ActiveBrowser {
  browser?: AppleAuthorizationBrowser
  launch?: Promise<AppleAuthorizationBrowser>
  close?: Promise<void>
  cancel?: () => void
}

export class AppleAuthorizationBrowserLauncher {
  private readonly executablePath: string
  private readonly launch: AppleAuthorizationBrowserLaunch
  private readonly profilePath: () => string
  private readonly prepareProfile: (profilePath: string) => Promise<void>
  private active?: ActiveBrowser

  constructor(options: AppleAuthorizationBrowserLauncherOptions = {}) {
    this.executablePath = options.executablePath ?? defaultChromiumExecutablePath()
    this.launch = options.launch ?? ((launchOptions) => puppeteer.launch(launchOptions))
    this.profilePath = options.profilePath ?? applePlaybackProfilePath
    this.prepareProfile = options.prepareProfile ?? ensurePrivateProfile
  }

  openBrowser(
    authorizationUrl: string,
    signal?: AbortSignal,
  ): AppleAuthorizationBrowserSession {
    let active: ActiveBrowser | undefined
    const opening = this.open(authorizationUrl, signal, (value) => {
      active = value
    }) as AppleAuthorizationBrowserSession
    let closing: Promise<void> | undefined
    Object.defineProperty(opening, "close", {
      value: () => {
        closing ??= active
          ? this.closeActive(active)
          : opening.then(() => {}, () => {})
        return closing
      },
    })
    return opening
  }

  private async open(
    authorizationUrl: string,
    signal: AbortSignal | undefined,
    setActive: (active: ActiveBrowser) => void,
  ): Promise<void> {
    validateAuthorizationUrl(authorizationUrl)
    if (signal?.aborted) throw new AppleAuthorizationBrowserError("aborted")
    if (this.active) throw new AppleAuthorizationBrowserError("browser_in_use")

    const active: ActiveBrowser = {}
    this.active = active
    setActive(active)
    const aborted = new Promise<never>((_resolve, reject) => {
      active.cancel = () => reject(ABORTED)
    })
    void aborted.catch(() => {})
    const onAbort = () => {
      active.cancel?.()
      void this.closeActive(active)
    }

    try {
      const profilePath = this.profilePath()
      await this.prepareProfile(profilePath)
      if (active.close || signal?.aborted) throw ABORTED
      signal?.addEventListener("abort", onAbort, { once: true })

      active.launch = Promise.resolve().then(() =>
        this.launch({
          executablePath: this.executablePath,
          headless: false,
          pipe: true,
          userDataDir: profilePath,
          ignoreDefaultArgs: ["--mute-audio"],
          env: playbackBrowserEnvironment(process.env),
          timeout: NAVIGATION_TIMEOUT_MS,
          ...(signal ? { signal } : {}),
        })
      )
      const browser = await raceAbort(active.launch, aborted)
      active.browser = browser
      if (active.close || signal?.aborted) throw ABORTED

      const page = await raceAbort(browser.newPage(), aborted)
      if (active.close || signal?.aborted) throw ABORTED
      page.on("console", () => {})
      page.on("pageerror", () => {})
      await raceAbort(
        page.goto(authorizationUrl, {
          waitUntil: "domcontentloaded",
          timeout: NAVIGATION_TIMEOUT_MS,
        }),
        aborted,
      )
      if (active.close || signal?.aborted) throw ABORTED
    } catch (error) {
      const wasClosing = active.close !== undefined
      await this.closeActive(active)
      if (error === ABORTED || signal?.aborted || wasClosing) {
        throw new AppleAuthorizationBrowserError("aborted")
      }
      throw new AppleAuthorizationBrowserError("browser_open_failed")
    } finally {
      signal?.removeEventListener("abort", onAbort)
    }
  }

  private closeActive(active: ActiveBrowser): Promise<void> {
    if (active.close) return active.close
    active.cancel?.()
    active.cancel = undefined
    active.close = (async () => {
      let browser = active.browser
      if (!browser && active.launch) {
        try {
          browser = await active.launch
        } catch {
          return
        }
      }
      try {
        await browser?.close()
      } catch {
        // Browser shutdown failures must not expose Chromium diagnostics or URLs.
      }
    })().finally(() => {
      if (this.active === active) this.active = undefined
    })
    return active.close
  }
}

async function ensurePrivateProfile(profilePath: string): Promise<void> {
  await mkdir(profilePath, { recursive: true, mode: 0o700 })
  await chmod(profilePath, 0o700)
}

function validateAuthorizationUrl(value: string): void {
  const match = value.match(
    /^http:\/\/127\.0\.0\.1:([0-9]{1,5})\/authorize#browserToken=([A-Za-z0-9_-]+)$/,
  )
  const port = Number(match?.[1])
  const token = match?.[2]
  if (
    !match ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    !token ||
    token.length > MAX_BROWSER_TOKEN_LENGTH
  ) {
    throw new AppleAuthorizationBrowserError("invalid_authorization_url")
  }
}

function raceAbort<T>(promise: Promise<T>, aborted: Promise<never>): Promise<T> {
  return Promise.race([promise, aborted])
}

function errorMessage(code: AppleAuthorizationBrowserErrorCode): string {
  switch (code) {
    case "invalid_authorization_url":
      return "Apple authorization URL is not allowed"
    case "browser_in_use":
      return "Apple authorization browser is already open"
    case "aborted":
      return "Apple authorization browser opening was cancelled"
    case "browser_open_failed":
      return "Apple authorization browser failed to open"
  }
}
