import { writeSync } from "node:fs"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import { prepareSignerLog, signerLogPath } from "./apple-signer-log"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(
    (directory) => rm(directory, { recursive: true, force: true }),
  ))
})

describe("Apple signer development log", () => {
  test("captures private signer output outside the terminal and truncates each run", async () => {
    const stateHome = await mkdtemp(join(tmpdir(), "nutka-signer-log-test-"))
    directories.push(stateHome)
    const path = join(stateHome, "nutka", "apple-signer.log")
    const first = await prepareSignerLog({ XDG_STATE_HOME: stateHome })
    try {
      expect(first.path).toBe(path)
      expect(first.output).toBeNumber()
      writeSync(first.output as number, "wrangler diagnostic\n")
    } finally {
      await first.close()
    }

    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(join(stateHome, "nutka"))).mode & 0o777).toBe(0o700)
    expect(await readFile(path, "utf8")).toContain("wrangler diagnostic")

    const second = await prepareSignerLog({ XDG_STATE_HOME: stateHome })
    await second.close()
    const contents = await readFile(path, "utf8")
    expect(contents).toContain("Nutka Apple signer log")
    expect(contents).not.toContain("wrangler diagnostic")
  })

  test("supports a custom path and disabled logging", async () => {
    expect(signerLogPath({ NUTKA_APPLE_SIGNER_LOG: "/logs/signer.log" })).toBe(
      "/logs/signer.log",
    )
    expect(signerLogPath({})).toBeUndefined()
    expect(signerLogPath({ NUTKA_APPLE_SIGNER_LOG: "off" })).toBeUndefined()
    const disabled = await prepareSignerLog({ NUTKA_APPLE_SIGNER_LOG: "off" })
    expect(disabled.output).toBe("ignore")
    await disabled.close()
  })
})
