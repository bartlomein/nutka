export {}

import { join } from "node:path"

import {
  prepareSignerEnvironment,
  type PreparedSignerEnvironment,
} from "./apple-signer-environment"
import { prepareSignerLog, type PreparedSignerLog } from "./apple-signer-log"
import { createClientEnvironment } from "./client-environment"

const signerHost = "127.0.0.1"
const signerPort = "8788"
const signerUrl = `http://${signerHost}:${signerPort}`
const clientEnvironment = createClientEnvironment()
const serviceDirectory = join(process.cwd(), "services", "apple-token")

await run()

async function run(): Promise<void> {
  let signerEnvironment: PreparedSignerEnvironment | undefined
  let signerLog: PreparedSignerLog | undefined
  let signer: Bun.Subprocess | undefined
  let app: Bun.Subprocess | undefined
  let signalExitCode: number | undefined

  const stopChildren = (): void => {
    app?.kill()
    signer?.kill()
  }
  const requestStop = (exitCode: number): void => {
    signalExitCode ??= exitCode
    stopChildren()
  }
  const handleSigint = (): void => requestStop(130)
  const handleSigterm = (): void => requestStop(143)
  process.on("SIGINT", handleSigint)
  process.on("SIGTERM", handleSigterm)

  try {
    signerEnvironment = await prepareSignerEnvironment(serviceDirectory)
    if (signalExitCode !== undefined) return
    signerLog = await prepareSignerLog()
    if (signalExitCode !== undefined) return

    const signerCommand = [
      process.execPath,
      "run",
      "--cwd",
      "services/apple-token",
      "dev",
      "--",
      "--ip",
      signerHost,
      "--port",
      signerPort,
    ]
    if (signerEnvironment.envFile) {
      signerCommand.push("--env-file", signerEnvironment.envFile)
    }
    signer = Bun.spawn({
      cmd: signerCommand,
      cwd: process.cwd(),
      env: process.env,
      stdin: "ignore",
      stdout: signerLog.output,
      stderr: signerLog.output,
    })

    await waitForSigner(signerUrl, signer, signerLog.path)
    if (signalExitCode !== undefined) return

    app = Bun.spawn({
      cmd: [process.execPath, "--no-env-file", "run", "src/index.ts"],
      cwd: process.cwd(),
      env: {
        ...clientEnvironment,
        NUTKA_APPLE_SIGNER_URL: signerUrl,
      },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })

    const exitCode = await app.exited
    if (signalExitCode === undefined) process.exitCode = exitCode
  } catch (error) {
    if (signalExitCode === undefined) throw error
  } finally {
    stopChildren()
    try {
      await Promise.all([waitForExit(app), waitForExit(signer)])
    } finally {
      try {
        await signerLog?.close()
      } finally {
        try {
          await signerEnvironment?.cleanup()
        } finally {
          process.off("SIGINT", handleSigint)
          process.off("SIGTERM", handleSigterm)
          if (signalExitCode !== undefined) process.exitCode = signalExitCode
        }
      }
    }
  }
}

async function waitForExit(child: Bun.Subprocess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return
  const exited = await Promise.race([
    child.exited.then(() => true),
    Bun.sleep(2_000).then(() => false),
  ])
  if (exited) return
  child.kill(9)
  await child.exited
}

async function waitForSigner(
  signerUrl: string,
  process: Bun.Subprocess,
  logPath?: string,
): Promise<void> {
  const deadline = Date.now() + 5_000

  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(
        withSignerLog(`Apple signer exited with code ${process.exitCode}`, logPath),
      )
    }

    let health: Response
    try {
      health = await fetch(`${signerUrl}/healthz`)
    } catch {
      // The service may still be binding its port.
      await Bun.sleep(75)
      continue
    }
    if (health.ok) {
      let token: Response
      try {
        token = await fetch(`${signerUrl}/v1/apple/developer-token`)
      } catch {
        throw new Error(withSignerLog("Apple signer token probe failed", logPath))
      }
      if (token.ok) return
      if (token.status === 429) {
        throw new Error(withSignerLog("Apple signer token probe was rate limited", logPath))
      }
      throw new Error(
        withSignerLog(
          `Apple signer cannot issue tokens (HTTP ${token.status}). Configure services/apple-token/.dev.vars and set SIGNING_ENABLED=true`,
          logPath,
        ),
      )
    }

    await Bun.sleep(75)
  }

  throw new Error(
    withSignerLog(
      "Apple signer did not become ready. Check services/apple-token/.dev.vars",
      logPath,
    ),
  )
}

function withSignerLog(message: string, path?: string): string {
  return path ? `${message}. Signer log: ${path}` : message
}
