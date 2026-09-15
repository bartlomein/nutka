import type { AuthLogger } from "../auth-log"
import { runWithAbortTimeout } from "../token-service"
import type {
  AppleAuthorizationBrowserSession,
  AppleAuthManagerOptions,
} from "./types"

export class AppleAuthorizationBrowser {
  private session?: AppleAuthorizationBrowserSession
  private pendingCleanup: Promise<void> = Promise.resolve()

  constructor(
    private readonly opener: NonNullable<AppleAuthManagerOptions["openBrowser"]>,
    private readonly timeoutMs: number,
    private readonly logger: AuthLogger,
  ) {}

  waitForCleanup(): Promise<void> {
    return this.pendingCleanup
  }

  async open(url: string, signal: AbortSignal): Promise<void> {
    let opened: AppleAuthorizationBrowserSession | undefined
    try {
      await runWithAbortTimeout(
        async (signal) => {
          const opening = this.opener(url, signal)
          if (isAuthorizationBrowserSession(opening)) {
            opened = opening
            this.session = opening
          }
          await opening
        },
        { signal, timeoutMs: this.timeoutMs },
      )
    } catch (error) {
      if (this.session === opened) {
        await this.close()
      } else {
        await closeBrowserSession(opened, this.logger)
      }
      throw error
    }
  }

  close(): Promise<void> {
    const browser = this.session
    this.session = undefined
    if (!browser) return this.pendingCleanup
    const cleanup = closeBrowserSession(browser, this.logger)
    this.pendingCleanup = Promise.all([this.pendingCleanup, cleanup]).then(() => {})
    return this.pendingCleanup
  }
}

function isAuthorizationBrowserSession(
  value: unknown,
): value is AppleAuthorizationBrowserSession {
  return (
    value instanceof Promise &&
    typeof (value as { close?: unknown }).close === "function"
  )
}

async function closeBrowserSession(
  browser: AppleAuthorizationBrowserSession | undefined,
  logger: AuthLogger,
): Promise<void> {
  try {
    await browser?.close()
  } catch {
    logger.log("browser_cleanup_failed", { code: "cleanup_failed" })
    // Browser cleanup cannot be allowed to retain a Music User Token in memory.
  }
}

export async function openBrowser(url: string, signal?: AbortSignal): Promise<void> {
  const command = browserOpenCommand(url)
  const processHandle = Bun.spawn(command, {
    stdout: "ignore",
    stderr: "ignore",
    env: browserEnvironment(process.env),
  })
  let resolveAbort!: () => void
  const aborted = new Promise<"aborted">((resolve) => {
    resolveAbort = () => resolve("aborted")
  })
  signal?.addEventListener("abort", resolveAbort, { once: true })
  try {
    const result = await Promise.race([
      processHandle.exited.then((exitCode) => ({ exitCode })),
      Bun.sleep(250).then(() => "started" as const),
      aborted,
    ])
    if (result === "aborted") {
      processHandle.kill()
      throw new Error("Browser launch was cancelled")
    }
    if (result === "started") {
      processHandle.unref()
      return
    }
    if (result.exitCode !== 0) throw new Error("Browser failed to open")
  } finally {
    signal?.removeEventListener("abort", resolveAbort)
  }
}

export function browserOpenCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): [string, string] {
  return platform === "darwin"
    ? ["/usr/bin/open", url]
    : ["/usr/bin/xdg-open", url]
}

function browserEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const environment: Record<string, string> = {
    PATH: "/usr/local/bin:/usr/bin:/bin",
  }
  for (const name of [
    "DBUS_SESSION_BUS_ADDRESS",
    "DISPLAY",
    "HOME",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "USER",
    "WAYLAND_DISPLAY",
    "XAUTHORITY",
    "XDG_CURRENT_DESKTOP",
    "XDG_RUNTIME_DIR",
    "XDG_SESSION_TYPE",
  ]) {
    const value = source[name]
    if (value) environment[name] = value
  }
  return environment
}
