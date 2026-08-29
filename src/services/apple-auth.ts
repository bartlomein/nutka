import type { CredentialStore } from "./credentials"
import { createAuthLogger, type AuthLogger } from "./auth-log"
import {
  AppleMusicValidationError,
  validateAppleMusicUserToken,
} from "./apple-music"
import {
  DEFAULT_NETWORK_TIMEOUT_MS,
  runWithAbortTimeout,
  type Fetch,
  type NetworkRequestOptions,
} from "./token-service"

const MAX_RESPONSE_BYTES = 32 * 1024
const DEFAULT_POLL_INTERVAL_MS = 1_000
const DEFAULT_BROWSER_TIMEOUT_MS = 10_000

export interface AppleAuthorizationSession {
  cliToken: string
  authorizationUrl: string
  expiresAt: string
}

export type AppleAuthorizationSessionStatus =
  | { status: "pending" }
  | { status: "complete"; musicUserToken: string }

export type AppleAuthStatus =
  | { state: "signedOut" }
  | { state: "restoring" }
  | { state: "connecting" }
  | {
      state: "authorizing"
      expiresAt: string
    }
  | { state: "validating" }
  | { state: "saving" }
  | { state: "signedIn"; storefront: string }
  | { state: "signingOut" }
  | { state: "error"; code: AppleAuthErrorCode }

export type AppleAuthErrorCode =
  | "service_unavailable"
  | "session_expired"
  | "authorization_invalid"
  | "credential_load_failed"
  | "credential_save_failed"
  | "credential_delete_failed"
  | "browser_open_failed"

export class AppleAuthError extends Error {
  constructor(readonly code: AppleAuthErrorCode) {
    super(errorMessage(code))
    this.name = "AppleAuthError"
  }
}

export type AppleAuthClientErrorCode =
  | "unauthorized"
  | "expired"
  | "conflict"
  | "unavailable"

export class AppleAuthClientError extends Error {
  constructor(readonly code: AppleAuthClientErrorCode) {
    super("Apple authorization service is unavailable")
    this.name = "AppleAuthClientError"
  }
}

export async function createAppleAuthorizationSession(
  serviceUrl: string,
  fetchImpl: Fetch = fetch,
  options: NetworkRequestOptions = {},
): Promise<AppleAuthorizationSession> {
  const value = await postJson(
    serviceUrl,
    "/v1/apple/auth/sessions",
    {},
    fetchImpl,
    options,
  )
  if (!isCreatedSession(value)) throw new AppleAuthClientError("unavailable")
  validateAuthorizationUrl(serviceUrl, value.authorizationUrl)
  return value
}

export async function getAppleAuthorizationSessionStatus(
  serviceUrl: string,
  cliToken: string,
  fetchImpl: Fetch = fetch,
  options: NetworkRequestOptions = {},
): Promise<AppleAuthorizationSessionStatus> {
  const value = await postJson(
    serviceUrl,
    "/v1/apple/auth/sessions/status",
    { cliToken },
    fetchImpl,
    options,
  )
  if (!isSessionStatus(value)) throw new AppleAuthClientError("unavailable")
  return value
}

export async function cancelAppleAuthorizationSession(
  serviceUrl: string,
  cliToken: string,
  fetchImpl: Fetch = fetch,
  options: NetworkRequestOptions = {},
): Promise<void> {
  await postJson(
    serviceUrl,
    "/v1/apple/auth/sessions/cancel",
    { cliToken },
    fetchImpl,
    options,
    true,
  )
}

export async function acknowledgeAppleAuthorizationSession(
  serviceUrl: string,
  cliToken: string,
  fetchImpl: Fetch = fetch,
  options: NetworkRequestOptions = {},
): Promise<void> {
  await postJson(
    serviceUrl,
    "/v1/apple/auth/sessions/acknowledge",
    { cliToken },
    fetchImpl,
    options,
    true,
  )
}

export interface AppleAuthManagerOptions {
  serviceUrl: string
  credentialStore: CredentialStore
  fetch?: Fetch
  openBrowser?: (
    url: string,
    signal?: AbortSignal,
  ) => void | Promise<void> | AppleAuthorizationBrowserSession
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  now?: () => number
  pollIntervalMs?: number
  networkTimeoutMs?: number
  browserTimeoutMs?: number
  logger?: AuthLogger
}

export interface AppleAuthorizationBrowserSession extends Promise<void> {
  close(): Promise<void>
}

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
  private readonly openBrowserImpl: (
    url: string,
    signal?: AbortSignal,
  ) => void | Promise<void> | AppleAuthorizationBrowserSession
  private readonly sleepImpl: (
    milliseconds: number,
    signal?: AbortSignal,
  ) => Promise<void>
  private readonly now: () => number
  private readonly pollIntervalMs: number
  private readonly networkTimeoutMs: number
  private readonly browserTimeoutMs: number
  private readonly logger: AuthLogger
  private currentStatus: AppleAuthStatus = { state: "signedOut" }
  private musicUserToken?: string
  private operation?: Operation
  private generation = 0
  private active?: ActiveSession
  private signInPromise?: Promise<void>
  private disposePromise?: Promise<void>
  private credentialWrites: Promise<void> = Promise.resolve()
  private brokerCleanup: Promise<void> = Promise.resolve()
  private browserCleanup: Promise<void> = Promise.resolve()
  private authorizationBrowser?: AppleAuthorizationBrowserSession
  private disposed = false
  private readonly listeners = new Set<Listener>()

  constructor(private readonly options: AppleAuthManagerOptions) {
    this.fetchImpl = options.fetch ?? fetch
    this.openBrowserImpl = options.openBrowser ?? openBrowser
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
    this.browserTimeoutMs = positive(
      options.browserTimeoutMs ?? DEFAULT_BROWSER_TIMEOUT_MS,
      "browserTimeoutMs",
    )
    this.logger =
      options.logger ??
      (process.env.NODE_ENV === "test"
        ? { log() {} }
        : createAuthLogger("client"))
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
      ? cancelAppleAuthorizationSession(
          this.options.serviceUrl,
          cliToken,
          this.fetchImpl,
          { timeoutMs: this.networkTimeoutMs },
        ).catch(() => {
          this.logger.log("session_cancel_cleanup_failed", { code: "cleanup_failed" })
        })
      : Promise.resolve()
    this.disposePromise = Promise.all([
      this.credentialWrites,
      this.brokerCleanup,
      this.closeAuthorizationBrowser(),
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
    await this.browserCleanup
    if (!this.isCurrent(operation)) return

    let session: AppleAuthorizationSession
    try {
      session = await createAppleAuthorizationSession(
        this.options.serviceUrl,
        this.fetchImpl,
        this.networkOptions(operation),
      )
    } catch {
      if (this.isCurrent(operation)) this.failFor(operation, "service_unavailable")
      return
    }
    if (!this.isCurrent(operation)) {
      this.cancelDetached(session.cliToken)
      return
    }

    this.logger.log("session_created")

    this.active = { generation: operation.generation, cliToken: session.cliToken }
    this.emitFor(operation, {
      state: "authorizing",
      expiresAt: session.expiresAt,
    })

    let browserSession: AppleAuthorizationBrowserSession | undefined
    try {
      this.logger.log("browser_open_started")
      await runWithAbortTimeout(
        async (signal) => {
          const opening = this.openBrowserImpl(
            session.authorizationUrl,
            signal,
          )
          if (isAuthorizationBrowserSession(opening)) {
            browserSession = opening
            this.authorizationBrowser = opening
          }
          await opening
        },
        {
          signal: operation.controller.signal,
          timeoutMs: this.browserTimeoutMs,
        },
      )
      this.logger.log("browser_open_succeeded")
    } catch {
      if (this.authorizationBrowser === browserSession) {
        await this.closeAuthorizationBrowser()
      } else {
        await closeBrowserSession(browserSession, this.logger)
      }
      this.logger.log("browser_open_failed")
      if (!this.isCurrent(operation)) return
      this.clearActive(operation)
      this.cancelDetached(session.cliToken)
      this.failFor(operation, "browser_open_failed")
    }
    if (!this.isCurrent(operation)) return

    const expiresAt = Date.parse(session.expiresAt)
    while (this.isCurrent(operation) && this.now() < expiresAt) {
      let result: AppleAuthorizationSessionStatus
      try {
        result = await getAppleAuthorizationSessionStatus(
          this.options.serviceUrl,
          session.cliToken,
          this.fetchImpl,
          this.networkOptions(operation),
        )
      } catch (error) {
        if (!this.isCurrent(operation)) return
        if (error instanceof AppleAuthClientError && error.code === "expired") break
        await this.closeAuthorizationBrowser()
        if (!this.isCurrent(operation)) return
        this.clearActive(operation)
        this.cancelDetached(session.cliToken)
        this.failFor(operation, "service_unavailable")
      }
      if (!this.isCurrent(operation)) return
      if (result.status === "complete") {
        this.logger.log("authorization_received")
        await this.closeAuthorizationBrowser()
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
    await this.closeAuthorizationBrowser()
    if (!this.isCurrent(operation)) return
    this.clearActive(operation)
    this.cancelDetached(session.cliToken)
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
      this.cancelDetached(cliToken)
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
        this.cancelDetached(cliToken)
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
    this.acknowledgeDetached(cliToken)
  }

  private async runCancel(
    operation: Operation,
    cliToken: string | undefined,
  ): Promise<void> {
    const browserCleanup = this.closeAuthorizationBrowser()
    if (!cliToken) {
      await browserCleanup
      return
    }
    try {
      await Promise.all([
        browserCleanup,
        cancelAppleAuthorizationSession(
          this.options.serviceUrl,
          cliToken,
          this.fetchImpl,
          this.networkOptions(operation),
        ),
      ])
    } catch {
      if (this.isCurrent(operation)) throw new AppleAuthError("service_unavailable")
    }
  }

  private async runLogout(
    operation: Operation,
    cliToken: string | undefined,
  ): Promise<void> {
    const browserCleanup = this.closeAuthorizationBrowser()
    const deletion = this.mutateCredential(
      operation,
      () => this.options.credentialStore.delete(),
      undefined,
      true,
    )
    const cancellation = cliToken
      ? cancelAppleAuthorizationSession(
          this.options.serviceUrl,
          cliToken,
          this.fetchImpl,
          this.networkOptions(operation),
        ).then(
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

  private cancelDetached(cliToken: string): void {
    this.trackBrokerCleanup(
      cancelAppleAuthorizationSession(
        this.options.serviceUrl,
        cliToken,
        this.fetchImpl,
        { timeoutMs: this.networkTimeoutMs },
      ),
    )
  }

  private acknowledgeDetached(cliToken: string): void {
    this.trackBrokerCleanup(
      acknowledgeAppleAuthorizationSession(
        this.options.serviceUrl,
        cliToken,
        this.fetchImpl,
        { timeoutMs: this.networkTimeoutMs },
      ).catch(() =>
        cancelAppleAuthorizationSession(
          this.options.serviceUrl,
          cliToken,
          this.fetchImpl,
          { timeoutMs: this.networkTimeoutMs },
        ),
      ),
    )
  }

  private trackBrokerCleanup(cleanup: Promise<void>): void {
    this.brokerCleanup = Promise.all([
      this.brokerCleanup,
      cleanup.catch(() => {
        this.logger.log("broker_cleanup_failed", { code: "cleanup_failed" })
      }),
    ]).then(() => {})
  }

  private closeAuthorizationBrowser(): Promise<void> {
    const browser = this.authorizationBrowser
    this.authorizationBrowser = undefined
    if (!browser) return this.browserCleanup
    const cleanup = closeBrowserSession(browser, this.logger)
    this.browserCleanup = Promise.all([this.browserCleanup, cleanup]).then(() => {})
    return this.browserCleanup
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

async function postJson(
  serviceUrl: string,
  path: string,
  body: Record<string, string>,
  fetchImpl: Fetch,
  options: NetworkRequestOptions,
  allowEmpty = false,
): Promise<unknown> {
  try {
    return await runWithAbortTimeout(
      async (signal) => {
        const response = await fetchImpl(
          new URL(path, ensureTrailingSlash(serviceUrl)),
          {
            method: "POST",
            headers: {
              accept: "application/json",
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
            redirect: "manual",
            signal,
          },
        )
        if (!response.ok) {
          if (response.status === 401) throw new AppleAuthClientError("unauthorized")
          if (response.status === 410) throw new AppleAuthClientError("expired")
          if (response.status === 409) throw new AppleAuthClientError("conflict")
          throw new AppleAuthClientError("unavailable")
        }
        if (allowEmpty && response.status === 204) return undefined
        return readBoundedJson(response)
      },
      options,
    )
  } catch (error) {
    if (error instanceof AppleAuthClientError) throw error
    throw new AppleAuthClientError("unavailable")
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
    throw new AppleAuthClientError("unavailable")
  }
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new AppleAuthClientError("unavailable")
  }
  const reader = response.body?.getReader()
  if (!reader) throw new AppleAuthClientError("unavailable")
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new AppleAuthClientError("unavailable")
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown
  } catch {
    throw new AppleAuthClientError("unavailable")
  }
}

function isCreatedSession(value: unknown): value is AppleAuthorizationSession {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return (
    isBoundedString(record.cliToken, 4096) &&
    isBoundedString(record.authorizationUrl, 2048) &&
    typeof record.expiresAt === "string" &&
    Number.isFinite(Date.parse(record.expiresAt))
  )
}

function isSessionStatus(value: unknown): value is AppleAuthorizationSessionStatus {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return (
    record.status === "pending" ||
    (record.status === "complete" && isBoundedString(record.musicUserToken, 16 * 1024))
  )
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max
}

function authorizationUrl(serviceUrl: string): string {
  return new URL("/authorize", ensureTrailingSlash(serviceUrl)).toString()
}

function validateAuthorizationUrl(serviceUrl: string, value: string): void {
  try {
    const expected = new URL(authorizationUrl(serviceUrl))
    const actual = new URL(value)
    const fragment = new URLSearchParams(actual.hash.slice(1))
    const browserTokens = fragment.getAll("browserToken")
    if (
      actual.origin !== expected.origin ||
      actual.pathname !== expected.pathname ||
      actual.search !== "" ||
      actual.username !== "" ||
      actual.password !== "" ||
      fragment.size !== 1 ||
      browserTokens.length !== 1 ||
      !isBoundedString(browserTokens[0], 128)
    ) {
      throw new Error()
    }
  } catch {
    throw new AppleAuthClientError("unavailable")
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`
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

async function openBrowser(url: string, signal?: AbortSignal): Promise<void> {
  const command =
    process.platform === "darwin"
      ? ["/usr/bin/open", url]
      : ["/usr/bin/xdg-open", url]
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

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${name} must be positive`)
  return value
}

function errorMessage(code: AppleAuthErrorCode): string {
  switch (code) {
    case "service_unavailable":
      return "Apple authorization service is unavailable"
    case "session_expired":
      return "Apple authorization session expired"
    case "authorization_invalid":
      return "Apple Music authorization is no longer valid"
    case "credential_load_failed":
      return "Apple Music credential could not be loaded"
    case "credential_save_failed":
      return "Apple Music credential could not be saved"
    case "credential_delete_failed":
      return "Apple Music credential could not be deleted"
    case "browser_open_failed":
      return "Apple authorization page could not be opened"
  }
}
