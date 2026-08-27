import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import { prepareSignerEnvironment } from "./apple-signer-environment"

describe("Apple signer development environment", () => {
  test("converts the existing ignored environment into a temporary private file", async () => {
    const root = await mkdtemp(join(tmpdir(), "nutka-signer-environment-test-"))
    const serviceDirectory = join(root, "service")
    const keyPath = join(root, "AuthKey.p8")
    await mkdir(serviceDirectory)
    await writeFile(keyPath, "private-key\n")

    const prepared = await prepareSignerEnvironment(serviceDirectory, {
      APPLE_TEAM_ID: "team",
      APPLE_KEY_ID: "key",
      APPLE_PRIVATE_KEY_PATH: keyPath,
      APPLE_TOKEN_TTL_SECONDS: "900",
    })
    try {
      expect(prepared.envFile).toBeString()
      expect((await stat(prepared.envFile!)).mode & 0o777).toBe(0o600)
      const contents = await readFile(prepared.envFile!, "utf8")
      expect(contents).toContain('SIGNING_ENABLED="true"')
      expect(contents).toContain('APPLE_TEAM_ID="team"')
      expect(contents).toContain('APPLE_KEY_ID="key"')
      expect(contents).toContain('APPLE_PRIVATE_KEY="private-key\\n"')
      expect(contents).not.toContain(keyPath)
    } finally {
      const envFile = prepared.envFile!
      await prepared.cleanup()
      await expect(stat(envFile)).rejects.toThrow()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("leaves an explicit service .dev.vars file in control", async () => {
    const root = await mkdtemp(join(tmpdir(), "nutka-signer-environment-test-"))
    await writeFile(join(root, ".dev.vars"), "SIGNING_ENABLED=false\n")
    try {
      const prepared = await prepareSignerEnvironment(root, {
        APPLE_TEAM_ID: "legacy-team",
      })
      expect(prepared.envFile).toBeUndefined()
      await prepared.cleanup()
      expect(await readFile(join(root, ".dev.vars"), "utf8")).toBe(
        "SIGNING_ENABLED=false\n",
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects incomplete or ambiguous existing configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "nutka-signer-environment-test-"))
    try {
      await expect(
        prepareSignerEnvironment(root, { APPLE_TEAM_ID: "team" }),
      ).rejects.toThrow("incomplete")
      await expect(
        prepareSignerEnvironment(root, {
          APPLE_TEAM_ID: "team",
          APPLE_KEY_ID: "key",
          APPLE_PRIVATE_KEY: "inline",
          APPLE_PRIVATE_KEY_PATH: "/another/key",
        }),
      ).rejects.toThrow("incomplete")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
