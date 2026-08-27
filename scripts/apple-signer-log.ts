import { constants } from "node:fs"
import { mkdir, open, type FileHandle } from "node:fs/promises"
import { dirname, join } from "node:path"

export interface PreparedSignerLog {
  readonly path?: string
  readonly output: number | "ignore"
  close(): Promise<void>
}

export async function prepareSignerLog(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<PreparedSignerLog> {
  const path = signerLogPath(environment)
  if (!path) return { output: "ignore", close: async () => {} }

  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const file = await open(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_TRUNC |
      constants.O_NOFOLLOW,
    0o600,
  )
  try {
    if (!(await file.stat()).isFile()) throw new Error("Apple signer log is not a file")
    await file.chmod(0o600)
    await file.write(`# Nutka Apple signer log\n# Started ${new Date().toISOString()}\n`)
  } catch (error) {
    await file.close()
    throw error
  }

  return preparedLog(path, file)
}

export function signerLogPath(
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (environment.NUTKA_APPLE_SIGNER_LOG === "off") return undefined
  if (environment.NUTKA_APPLE_SIGNER_LOG) return environment.NUTKA_APPLE_SIGNER_LOG
  if (environment.XDG_STATE_HOME) {
    return join(environment.XDG_STATE_HOME, "nutka", "apple-signer.log")
  }
  if (environment.HOME) {
    return join(environment.HOME, ".local", "state", "nutka", "apple-signer.log")
  }
  return undefined
}

function preparedLog(path: string, file: FileHandle): PreparedSignerLog {
  let closed = false
  return {
    path,
    output: file.fd,
    async close() {
      if (closed) return
      closed = true
      await file.close()
    },
  }
}
