const SESSION_TTL_MS = 5 * 60 * 1_000
const TOKEN_BYTES = 32
const DEFAULT_MAX_SESSIONS = 32

export type AuthorizationStatus =
  | { status: "pending" }
  | { status: "complete"; musicUserToken: string }

export interface CreatedAuthorizationSession {
  cliToken: string
  authorizationUrl: string
  expiresAt: string
}

export interface ClaimedAuthorizationSession {
  browserToken: string
  csrfToken: string
  developerToken: string
}

export type AuthorizationBrokerErrorCode =
  | "invalid_session"
  | "expired"
  | "already_claimed"
  | "already_completed"
  | "cancelled"
  | "already_consumed"
  | "capacity"

export class AuthorizationBrokerError extends Error {
  constructor(readonly code: AuthorizationBrokerErrorCode) {
    super("Authorization session is not available")
    this.name = "AuthorizationBrokerError"
  }
}

interface Session {
  cliToken: string
  browserToken: string
  csrfToken: string
  developerToken: string
  expiresAt: number
  state: "pending" | "claimed" | "complete" | "cancelled" | "consumed"
  musicUserToken?: string
}

type RandomBytes = (length: number) => Uint8Array

export class AuthorizationBroker {
  private readonly sessionsByCliToken = new Map<string, Session>()
  private readonly sessionsByBrowserToken = new Map<string, Session>()

  constructor(
    private readonly authorizationUrl: string,
    private readonly now: () => number = Date.now,
    private readonly randomBytes: RandomBytes = secureRandomBytes,
    private readonly maxSessions = DEFAULT_MAX_SESSIONS,
  ) {}

  create(developerToken: string): CreatedAuthorizationSession {
    this.cleanupExpired()
    if (this.sessionsByCliToken.size >= this.maxSessions) {
      throw new AuthorizationBrokerError("capacity")
    }
    const expiresAt = this.now() + SESSION_TTL_MS
    const session: Session = {
      cliToken: this.uniqueToken(this.sessionsByCliToken),
      browserToken: this.uniqueToken(this.sessionsByBrowserToken),
      csrfToken: base64Url(this.randomBytes(TOKEN_BYTES)),
      developerToken,
      expiresAt,
      state: "pending",
    }
    this.sessionsByCliToken.set(session.cliToken, session)
    this.sessionsByBrowserToken.set(session.browserToken, session)

    const authorizationUrl = new URL(this.authorizationUrl)
    authorizationUrl.hash = new URLSearchParams({
      browserToken: session.browserToken,
    }).toString()

    return {
      cliToken: session.cliToken,
      authorizationUrl: authorizationUrl.toString(),
      expiresAt: new Date(expiresAt).toISOString(),
    }
  }

  claim(browserToken: string): ClaimedAuthorizationSession {
    const session = this.requireSession(this.sessionsByBrowserToken, browserToken)
    if (session.state === "claimed") {
      throw new AuthorizationBrokerError("already_claimed")
    }
    if (session.state !== "pending") this.throwForState(session)
    session.state = "claimed"
    return {
      browserToken: session.browserToken,
      csrfToken: session.csrfToken,
      developerToken: session.developerToken,
    }
  }

  complete(browserToken: string, csrfToken: string, musicUserToken: string): void {
    const session = this.requireSession(this.sessionsByBrowserToken, browserToken)
    if (!constantTimeEqual(session.csrfToken, csrfToken)) {
      throw new AuthorizationBrokerError("invalid_session")
    }
    if (session.state === "complete") {
      throw new AuthorizationBrokerError("already_completed")
    }
    if (session.state !== "claimed") this.throwForState(session)
    session.musicUserToken = musicUserToken
    session.state = "complete"
    this.sessionsByBrowserToken.delete(session.browserToken)
    session.browserToken = ""
    session.csrfToken = ""
    session.developerToken = ""
  }

  status(cliToken: string): AuthorizationStatus {
    const session = this.requireSession(this.sessionsByCliToken, cliToken)
    if (session.state === "pending" || session.state === "claimed") {
      return { status: "pending" }
    }
    if (session.state !== "complete") this.throwForState(session)
    return { status: "complete", musicUserToken: session.musicUserToken! }
  }

  acknowledge(cliToken: string): void {
    const session = this.requireSession(this.sessionsByCliToken, cliToken)
    if (session.state !== "complete") this.throwForState(session)
    this.remove(session, "consumed")
  }

  cancel(cliToken: string): void {
    const session = this.requireSession(this.sessionsByCliToken, cliToken)
    if (session.state === "cancelled") {
      throw new AuthorizationBrokerError("cancelled")
    }
    if (session.state === "consumed") {
      throw new AuthorizationBrokerError("already_consumed")
    }
    this.remove(session, "cancelled")
  }

  private requireSession(index: Map<string, Session>, value: string): Session {
    const session = value ? index.get(value) : undefined
    if (!session) {
      this.cleanupExpired()
      throw new AuthorizationBrokerError("invalid_session")
    }
    if (this.now() >= session.expiresAt) {
      this.remove(session)
      this.cleanupExpired()
      throw new AuthorizationBrokerError("expired")
    }
    this.cleanupExpired(session)
    return session
  }

  private cleanupExpired(except?: Session): void {
    const now = this.now()
    for (const session of this.sessionsByCliToken.values()) {
      if (session !== except && now >= session.expiresAt) this.remove(session)
    }
  }

  private remove(
    session: Session,
    state: "cancelled" | "consumed" = session.state === "complete"
      ? "consumed"
      : "cancelled",
  ): void {
    this.sessionsByCliToken.delete(session.cliToken)
    this.sessionsByBrowserToken.delete(session.browserToken)
    session.cliToken = ""
    session.browserToken = ""
    session.csrfToken = ""
    session.developerToken = ""
    session.musicUserToken = undefined
    session.state = state
  }

  private uniqueToken(index: Map<string, Session>): string {
    let token: string
    do token = base64Url(this.randomBytes(TOKEN_BYTES))
    while (index.has(token))
    return token
  }

  private throwForState(session: Session): never {
    if (session.state === "cancelled") {
      throw new AuthorizationBrokerError("cancelled")
    }
    if (session.state === "consumed") {
      throw new AuthorizationBrokerError("already_consumed")
    }
    if (session.state === "claimed") {
      throw new AuthorizationBrokerError("already_claimed")
    }
    if (session.state === "complete") {
      throw new AuthorizationBrokerError("already_completed")
    }
    throw new AuthorizationBrokerError("invalid_session")
  }
}

function secureRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length))
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url")
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left)
  const rightBytes = new TextEncoder().encode(right)
  let difference = leftBytes.length ^ rightBytes.length
  const length = Math.max(leftBytes.length, rightBytes.length)
  for (let index = 0; index < length; index++) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }
  return difference === 0
}
