import type { CredentialStore } from "../credentials"
import type { AuthLogger } from "../auth-log"
import type { Fetch } from "../token-service"

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
