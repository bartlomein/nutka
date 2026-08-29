import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createPlaybackLogger, playbackLogPath } from "./playback-log"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("writes private structured playback diagnostics", () => {
  const directory = mkdtempSync(join(tmpdir(), "nutka-playback-log-"))
  directories.push(directory)
  const path = join(directory, "state", "playback.log")
  const logger = createPlaybackLogger({ NUTKA_PLAYBACK_LOG: path })

  logger.log("station_play_failed", { resourceId: "ra.123", code: "playback_timeout" })

  const entry = JSON.parse(readFileSync(path, "utf8"))
  expect(entry).toMatchObject({
    event: "station_play_failed",
    resourceId: "ra.123",
    code: "playback_timeout",
  })
  expect(typeof entry.time).toBe("string")
  expect(statSync(path).mode & 0o777).toBe(0o600)
})

test("resolves the playback log path safely", () => {
  expect(playbackLogPath({ XDG_STATE_HOME: "/state", HOME: "/home/test" }))
    .toBe("/state/nutka/playback.log")
  expect(playbackLogPath({ XDG_STATE_HOME: "relative", HOME: "/home/test" }))
    .toBe("/home/test/.local/state/nutka/playback.log")
  expect(playbackLogPath({ NUTKA_PLAYBACK_LOG: "off", HOME: "/home/test" }))
    .toBeUndefined()
})
