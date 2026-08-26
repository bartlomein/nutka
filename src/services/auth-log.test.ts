import { afterEach, expect, test } from "bun:test"
import { readFileSync, rmSync, statSync } from "node:fs"

import { authLogPath, createAuthLogger } from "./auth-log"

const directory = "/tmp/opencode/nuta-auth-log-test"

afterEach(() => rmSync(directory, { recursive: true, force: true }))

test("writes permission-restricted structured events without arbitrary data", () => {
  const path = `${directory}/auth.log`
  const logger = createAuthLogger("client", { NUTA_AUTH_LOG: path })
  logger.log("validation_failed", { code: "service_unavailable", httpStatus: 503 })

  const entry = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
  expect(entry).toMatchObject({
    component: "client",
    event: "validation_failed",
    code: "service_unavailable",
    httpStatus: 503,
  })
  expect(statSync(path).mode & 0o777).toBe(0o600)
  expect(statSync(directory).mode & 0o777).toBe(0o700)
})

test("uses the state directory and supports disabling logs", () => {
  expect(authLogPath({ XDG_STATE_HOME: "/state" })).toBe("/state/nuta/auth.log")
  expect(authLogPath({ HOME: "/home/example" })).toBe(
    "/home/example/.local/state/nuta/auth.log",
  )
  expect(authLogPath({ HOME: "/home/example", NUTA_AUTH_LOG: "off" })).toBeUndefined()
})
