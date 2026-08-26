import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs"
import { dirname, join } from "node:path"

const MAX_LOG_BYTES = 256 * 1024

export interface AuthLogDetails {
  code?: string
  httpStatus?: number
}

export interface AuthLogger {
  log(event: string, details?: AuthLogDetails): void
}

export function createAuthLogger(
  component: "client" | "service",
  environment: NodeJS.ProcessEnv = process.env,
): AuthLogger {
  const path = authLogPath(environment)
  if (!path) return { log() {} }

  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    chmodSync(dirname(path), 0o700)
    const existingSize = statSync(path, { throwIfNoEntry: false })?.size ?? 0
    if (existingSize >= MAX_LOG_BYTES) {
      rmSync(`${path}.1`, { force: true })
      renameSync(path, `${path}.1`)
    }
  } catch {
    return { log() {} }
  }

  return {
    log(event, details = {}) {
      const entry: Record<string, string | number> = {
        time: new Date().toISOString(),
        component,
        event,
      }
      if (details.code) entry.code = details.code
      if (Number.isInteger(details.httpStatus)) entry.httpStatus = details.httpStatus!
      try {
        appendFileSync(path, `${JSON.stringify(entry)}\n`, {
          encoding: "utf8",
          flag: "a",
          mode: 0o600,
        })
        chmodSync(path, 0o600)
      } catch {
        // Diagnostics must never interrupt authorization.
      }
    },
  }
}

export function authLogPath(
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (environment.NUTA_AUTH_LOG === "off") return undefined
  if (environment.NUTA_AUTH_LOG) return environment.NUTA_AUTH_LOG
  const stateHome = environment.XDG_STATE_HOME
  if (stateHome) return join(stateHome, "nuta", "auth.log")
  const home = environment.HOME
  return home ? join(home, ".local", "state", "nuta", "auth.log") : undefined
}
