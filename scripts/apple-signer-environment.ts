import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

export interface PreparedSignerEnvironment {
  envFile?: string
  cleanup(): Promise<void>
}

export async function prepareSignerEnvironment(
  serviceDirectory: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<PreparedSignerEnvironment> {
  if (await exists(join(serviceDirectory, ".dev.vars"))) {
    return { cleanup: async () => {} }
  }

  const teamId = environment.APPLE_TEAM_ID?.trim()
  const keyId = environment.APPLE_KEY_ID?.trim()
  const inlineKey = environment.APPLE_PRIVATE_KEY?.trim()
  const keyPath = environment.APPLE_PRIVATE_KEY_PATH?.trim()
  const hasLegacyConfiguration = Boolean(teamId || keyId || inlineKey || keyPath)
  if (!hasLegacyConfiguration) return { cleanup: async () => {} }
  if (!teamId || !keyId || (!inlineKey && !keyPath) || (inlineKey && keyPath)) {
    throw new Error("Existing Apple signer configuration is incomplete")
  }

  const privateKey = inlineKey ?? await readFile(keyPath!, "utf8")
  const directory = await mkdtemp(join(tmpdir(), "nutka-apple-signer-"))
  await chmod(directory, 0o700)
  const envFile = join(directory, ".dev.vars")
  const values: Record<string, string> = {
    SIGNING_ENABLED: "true",
    APPLE_TEAM_ID: teamId,
    APPLE_KEY_ID: keyId,
    APPLE_PRIVATE_KEY: privateKey,
  }
  const ttl = environment.APPLE_TOKEN_TTL_SECONDS?.trim()
  if (ttl) values.APPLE_TOKEN_TTL_SECONDS = ttl

  await writeFile(
    envFile,
    `${Object.entries(values)
      .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
      .join("\n")}\n`,
    { mode: 0o600 },
  )
  await chmod(envFile, 0o600)

  return {
    envFile,
    async cleanup() {
      await rm(directory, { recursive: true, force: true })
    },
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
