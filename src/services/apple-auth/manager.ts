import { createAuthLogger, type AuthLogger } from "../auth-log"
import {
  AppleMusicValidationError,
  validateAppleMusicUserToken,
} from "../apple-music"
import {
  DEFAULT_NETWORK_TIMEOUT_MS,
  type Fetch,
} from "../token-service"
import { AppleAuthorizationBrowser, openBrowser } from "./browser"
import { AppleAuthorizationClient } from "./client"
import {
  AppleAuthClientError,
  AppleAuthError,
  type AppleAuthErrorCode,
  type AppleAuthManagerOptions,
  type AppleAuthStatus,
  type AppleAuthorizationSession,
  type AppleAuthorizationSessionStatus,
} from "./types"

const DEFAULT_POLL_INTERVAL_MS = 1_000
const DEFAULT_BROWSER_TIMEOUT_MS = 10_000

type Listener = (status: AppleAuthStatus) => void
type OperationKind = "restore" | "signIn" | "cancel" | "logout"
type Operation = {
  generation: number
  kind: OperationKind
  controller: AbortController
}
type ActiveSession = { generation: number; cliToken: string }

export class AppleAuthManager {
  private readonly fetchImpl: Fetch
  private readonly browser: AppleAuthorizationBrowser
  private readonly client: AppleAuthorizationClient
  private readonly sleepImpl: (
    milliseconds: number,
    signal?: AbortSignal,
  ) => Promise<void>
  private readonly now: () => number
  private readonly pollIntervalMs: number
  private readonly networkTimeoutMs: number
  private readonly logger: AuthLogger
  private currentStatus: AppleAuthStatus = { state: "signedOut" }
  private musicUserToken?: string
  private operation?: Operation
  private generation = 0
  private active?: ActiveSession
  private signInPromise?: Promise<void>
  private disposePromise?: Promise<void>
  private credentialWrites: Promise<void> = Promise.resolve()
  private disposed = false
  private readonly listeners = new Set<Listener>()

  constructor(private readonly options: AppleAuthManagerOptions) {
    this.fetchImpl = options.fetch ?? fetch
    this.sleepImpl = options.sleep ?? ((milliseconds) => Bun.sleep(milliseconds))
    this.now = options.now ?? Date.now
    this.pollIntervalMs = positive(
      options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      "pollIntervalMs",
    )
    this.networkTimeoutMs = positive(
      options.networkTimeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS,
      "networkTimeoutMs",
    )
    const browserTimeoutMs = positive(
      options.browserTimeoutMs ?? DEFAULT_BROWSER_TIMEOUT_MS,
      "browserTimeoutMs",
    )
    this.logger =
      options.logger ??
      (process.env.NODE_ENV === "test"
        ? { log() {} }
        : createAuthLogger("client"))
    this.browser = new AppleAuthorizationBrowser(
      options.openBrowser ?? openBrowser,
      browserTimeoutMs,
      this.logger,
    )
    this.client = new AppleAuthorizationClient(
      options.serviceUrl,
      this.fetchImpl,
      this.networkTimeoutMs,
      this.logger,
    )
  }

  get status(): AppleAuthStatus {
    return this.currentStatus
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    listener(this.currentStatus)
    return () => this.listeners.delete(listener)
  }

  useMusicUserToken<T>(
    use: (musicUserToken: string) => T | Promise<T>,
  ): Promise<T> {
    if (
      this.disposed ||
      this.currentStatus.state !== "signedIn" ||
      !this.musicUserToken
    ) {
      return Promise.reject(new AppleAuthError("authorization_invalid"))
    }
    return Promise.resolve(use(this.musicUserToken))
  }

  restore(): Promise<void> {
    const operation = this.begin("restore")
    this.logger.log("restore_started")
    this.emitFor(operation, { state: "restoring" })
    return this.runRestore(operation)
  }

  signIn(): Promise<void> {
    if (
      this.signInPromise &&
      this.operation?.kind === "signIn" &&
      !this.operation.controller.signal.aborted
    ) {
      return this.signInPromise
    }
    const operation = this.begin("signIn")
    this.logger.log("session_create_started")
    this.emitFor(operation, { state: "connecting" })
    const running = this.runSignIn(operation)
    const tracked = running.finally(() => {
      if (this.signInPromise === tracked) this.signInPromise = undefined
    })
    this.signInPromise = tracked
    return tracked
  }

  cancel(): Promise<void> {
    const cliToken = this.active?.cliToken
    const operation = this.begin("cancel")
    this.logger.log("authorization_cancelled")
    this.active = undefined
    this.emitFor(operation, { state: "signedOut" })
    return this.runCancel(operation, cliToken)
  }

  logout(): Promise<void> {
    const cliToken = this.active?.cliToken
    const operation = this.begin("logout")
    this.logger.log("logout_started")
    this.active = undefined
    this.musicUserToken = undefined
    this.emitFor(operation, { state: "signingOut" })
    return this.runLogout(operation, cliToken)
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise
    const cliToken = this.active?.cliToken
    this.disposed = true
    this.generation++
    this.operation?.controller.abort()
    this.operation = undefined
    this.active = undefined
    this.musicUserToken = undefined
    this.emit({ state: "signedOut" })
    this.listeners.clear()
    const cancellation = cliToken
      ? this.client.cancel(cliToken).catch(() => {
          this.logger.log("session_cancel_cleanup_failed", { code: "cleanup_failed" })
        })
      : Promise.resolve()
    this.disposePromise = Promise.all([
      this.credentialWrites,
      this.client.waitForCleanup(),
      this.browser.close(),
      cancellation,
    ]).then(() => {})
    return this.disposePromise
  }

  private async runRestore(operation: Operation): Promise<void> {
    let token: string | null
    try {
      token = await this.options.credentialStore.load()
    } catch {
      if (this.isCurrent(operation)) this.failFor(operation, "credential_load_failed")
      return
    }
    if (!this.isCurrent(operation)) return
    if (!token) {
      this.logger.log("restore_empty")
      this.musicUserToken = undefined
      this.emitFor(operation, { state: "signedOut" })
      return
    }

    try {
      this.logger.log("restore_validation_started")
      const validation = await validateAppleMusicUserToken(
        this.options.serviceUrl,
        token,
        this.networkOptions(operation),
      )
      if (!this.isCurrent(operation)) return
      this.musicUserToken = token
      this.logger.log("restore_succeeded")
      this.emitFor(operation, {
        state: "signedIn",
        storefront: validation.storefront,
      })
    } catch (error) {
      if (!this.isCurrent(operation)) return
      if (
        error instanceof AppleMusicValidationError &&
        error.code === "unauthorized" &&
        error.definitive
      ) {
        this.musicUserToken = undefined
        try {
          const deleted = await this.mutateCredential(
            operation,
            () => this.options.credentialStore.delete(),
          )
          if (!deleted) return
        } catch {
          if (this.isCurrent(operation)) {
            this.failFor(operation, "credential_delete_failed")
          }
          return
        }
        if (this.isCurrent(operation)) this.failFor(operation, "authorization_invalid")
        return
      }
      this.failFor(operation, "service_unavailable")
    }
  }

  private async runSignIn(operation: Operation): Promise<void> {
    await this.browser.waitForCleanup()
    if (!this.isCurrent(operation)) return

    let session: AppleAuthorizationSession
    try {
      session = await this.client.create(operation.controller.signal)
    } catch {
      if (this.isCurrent(operation)) this.failFor(operation, "service_unavailable")
      return
    }
    if (!this.isCurrent(operation)) {
      this.client.cancelDetached(session.cliToken)
      return
    }

    this.logger.log("session_created")

    this.active = { generation: operation.generation, cliToken: session.cliToken }
    this.emitFor(operation, {
      state: "authorizing",
      expiresAt: session.expiresAt,
    })

    try {
      this.logger.log("browser_open_started")
      await this.browser.open(session.authorizationUrl, operation.controller.signal)
      this.logger.log("browser_open_succeeded")
    } catch {
      this.logger.log("browser_open_failed")
      if (!this.isCurrent(operation)) return
      this.clearActive(operation)
      this.client.cancelDetached(session.cliToken)
      this.failFor(operation, "browser_open_failed")
    }
    if (!this.isCurrent(operation)) return

    const expiresAt = Date.parse(session.expiresAt)
    while (this.isCurrent(operation) && this.now() < expiresAt) {
      let result: AppleAuthorizationSessionStatus
      try {
        result = await this.client.status(session.cliToken, operation.controller.signal)
      } catch (error) {
        if (!this.isCurrent(operation)) return
        if (error instanceof AppleAuthClientError && error.code === "expired") break
        await this.browser.close()
        if (!this.isCurrent(operation)) return
        this.clearActive(operation)
        this.client.cancelDetached(session.cliToken)
        this.failFor(operation, "service_unavailable")
      }
      if (!this.isCurrent(operation)) return
      if (result.status === "complete") {
        this.logger.log("authorization_received")
        await this.browser.close()
        if (!this.isCurrent(operation)) return
        this.emitFor(operation, { state: "validating" })
        await this.finishSignIn(operation, session.cliToken, result.musicUserToken)
        return
      }
      try {
        await cancellableSleep(
          this.sleepImpl,
          Math.max(0, Math.min(this.pollIntervalMs, expiresAt - this.now())),
          operation.controller.signal,
        )
      } catch {
        return
      }
    }

    if (!this.isCurrent(operation)) return
    await this.browser.close()
    if (!this.isCurrent(operation)) return
    this.clearActive(operation)
    this.client.cancelDetached(session.cliToken)
    this.failFor(operation, "session_expired")
  }

  private async finishSignIn(
    operation: Operation,
    cliToken: string,
    token: string,
  ): Promise<void> {
    let storefront: string
    try {
      this.logger.log("validation_started")
      const validation = await validateAppleMusicUserToken(
        this.options.serviceUrl,
        token,
        this.networkOptions(operation),
      )
      storefront = validation.storefront
      this.logger.log("validation_succeeded")
    } catch (error) {
      if (!this.isCurrent(operation)) return
      this.client.cancelDetached(cliToken)
      this.clearActive(operation)
      this.failFor(
        operation,
        error instanceof AppleMusicValidationError &&
          error.code === "unauthorized" &&
          error.definitive
          ? "authorization_invalid"
          : "service_unavailable",
      )
    }
    if (!this.isCurrent(operation)) return

    try {
      this.emitFor(operation, { state: "saving" })
      this.logger.log("credential_save_started")
      const saved = await this.mutateCredential(
        operation,
        () => this.options.credentialStore.save(token),
        () => this.options.credentialStore.delete(),
      )
      if (!saved) return
      this.logger.log("credential_save_succeeded")
    } catch {
      if (this.isCurrent(operation)) {
        this.client.cancelDetached(cliToken)
        this.clearActive(operation)
        this.failFor(operation, "credential_save_failed")
      }
      return
    }
    if (!this.isCurrent(operation)) return
    this.musicUserToken = token
    this.clearActive(operation)
    this.emitFor(operation, { state: "signedIn", storefront })
    this.logger.log("sign_in_succeeded")
    this.client.acknowledgeDetached(cliToken)
  }

  private async runCancel(
    operation: Operation,
    cliToken: string | undefined,
  ): Promise<void> {
    const browserCleanup = this.browser.close()
    if (!cliToken) {
      await browserCleanup
      return
    }
    try {
      await Promise.all([
        browserCleanup,
        this.client.cancel(cliToken, operation.controller.signal),
      ])
    } catch {
      if (this.isCurrent(operation)) throw new AppleAuthError("service_unavailable")
    }
  }

  private async runLogout(
    operation: Operation,
    cliToken: string | undefined,
  ): Promise<void> {
    const browserCleanup = this.browser.close()
    const deletion = this.mutateCredential(
      operation,
      () => this.options.credentialStore.delete(),
      undefined,
      true,
    )
    const cancellation = cliToken
      ? this.client.cancel(cliToken, operation.controller.signal).then(
          () => false,
          () => true,
        )
      : Promise.resolve(false)

    try {
      await Promise.all([deletion, browserCleanup])
    } catch {
      if (this.isCurrent(operation)) this.failFor(operation, "credential_delete_failed")
      return
    }
    const cancellationFailed = await cancellation
    if (!this.isCurrent(operation)) return
    this.emitFor(operation, { state: "signedOut" })
    this.logger.log("logout_succeeded")
    if (cancellationFailed) throw new AppleAuthError("service_unavailable")
  }

  private begin(kind: OperationKind): Operation {
    if (this.disposed) throw new AppleAuthError("service_unavailable")
    this.operation?.controller.abort()
    const operation = {
      generation: ++this.generation,
      kind,
      controller: new AbortController(),
    }
    this.operation = operation
    return operation
  }

  private isCurrent(operation: Operation): boolean {
    return (
      !this.disposed &&
      this.operation === operation &&
      this.generation === operation.generation &&
      !operation.controller.signal.aborted
    )
  }

  private networkOptions(operation: Operation) {
    return {
      fetch: this.fetchImpl,
      signal: operation.controller.signal,
      timeoutMs: this.networkTimeoutMs,
    }
  }

  private clearActive(operation: Operation): void {
    if (this.active?.generation === operation.generation) this.active = undefined
  }

  private mutateCredential(
    operation: Operation,
    mutation: () => Promise<void>,
    rollbackIfStale?: () => Promise<void>,
    runIfStale = false,
  ): Promise<boolean> {
    const pending = this.credentialWrites.catch(() => {}).then(async () => {
      if (!runIfStale && !this.isCurrent(operation)) return false
      await mutation()
      if (!this.isCurrent(operation)) {
        await rollbackIfStale?.()
        return false
      }
      return true
    })
    this.credentialWrites = pending.then(
      () => {},
      () => {},
    )
    return pending
  }

  private emitFor(operation: Operation, status: AppleAuthStatus): void {
    if (this.isCurrent(operation)) this.emit(status)
  }

  private emit(status: AppleAuthStatus): void {
    this.currentStatus = status
    for (const listener of this.listeners) {
      try {
        listener(status)
      } catch {
        this.logger.log("auth_listener_failed", { code: "listener_failed" })
        // A UI listener must not interrupt credential handling.
      }
    }
  }

  private failFor(operation: Operation, code: AppleAuthErrorCode): never {
    this.logger.log("auth_failed", { code })
    if (this.isCurrent(operation)) this.emit({ state: "error", code })
    throw new AppleAuthError(code)
  }
}

async function cancellableSleep(
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw new Error("Operation aborted")
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", abort)
      callback()
    }
    const abort = () => finish(() => reject(new Error("Operation aborted")))
    signal.addEventListener("abort", abort, { once: true })
    Promise.resolve(sleep(milliseconds, signal)).then(
      () => finish(resolve),
      () => finish(() => reject(new Error("Operation aborted"))),
    )
  })
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${name} must be positive`)
  return value
}
