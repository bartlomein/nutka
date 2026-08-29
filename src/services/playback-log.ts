import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs"
import { dirname, isAbsolute, join } from "node:path"

const MAX_LOG_BYTES = 256 * 1024

export interface PlaybackLogDetails {
  code?: string
  resourceId?: string
}

export interface PlaybackLogger {
  log(event: string, details?: PlaybackLogDetails): void
}

export function createPlaybackLogger(
  environment: NodeJS.ProcessEnv = process.env,
): PlaybackLogger {
  const path = playbackLogPath(environment)
  if (!path) return { log() {} }

  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    chmodSync(dirname(path), 0o700)
    if ((statSync(path, { throwIfNoEntry: false })?.size ?? 0) >= MAX_LOG_BYTES) {
      rmSync(`${path}.1`, { force: true })
      renameSync(path, `${path}.1`)
    }
  } catch {
    return { log() {} }
  }

  return {
    log(event, details = {}) {
      const entry: Record<string, string> = {
        time: new Date().toISOString(),
        event,
      }
      if (details.code) entry.code = details.code
      if (details.resourceId) entry.resourceId = details.resourceId
      try {
        appendFileSync(path, `${JSON.stringify(entry)}\n`, {
          encoding: "utf8",
          flag: "a",
          mode: 0o600,
        })
        chmodSync(path, 0o600)
      } catch {
        // Diagnostics must never interrupt playback.
      }
    },
  }
}

export function playbackLogPath(
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (environment.NUTKA_PLAYBACK_LOG === "off") return undefined
  if (environment.NUTKA_PLAYBACK_LOG) return environment.NUTKA_PLAYBACK_LOG
  if (environment.XDG_STATE_HOME && isAbsolute(environment.XDG_STATE_HOME)) {
    return join(environment.XDG_STATE_HOME, "nutka", "playback.log")
  }
  if (environment.HOME && isAbsolute(environment.HOME)) {
    return join(environment.HOME, ".local", "state", "nutka", "playback.log")
  }
  return undefined
}
