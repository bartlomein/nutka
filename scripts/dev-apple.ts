export {}

import { createClientEnvironment } from "./client-environment"

const signerHost = "127.0.0.1"
const signerPort = "8788"
const signerUrl = `http://${signerHost}:${signerPort}`
const clientEnvironment = createClientEnvironment()

const signer = Bun.spawn({
  cmd: [
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
  ],
  cwd: process.cwd(),
  env: process.env,
  stdin: "ignore",
  stdout: "inherit",
  stderr: "inherit",
})

let app: Bun.Subprocess | undefined

function stopChildren(): void {
  app?.kill()
  signer.kill()
}

process.once("SIGINT", stopChildren)
process.once("SIGTERM", stopChildren)

try {
  await waitForSigner(signerUrl, signer)

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
  process.exitCode = exitCode
} finally {
  stopChildren()
  await signer.exited
}

async function waitForSigner(
  signerUrl: string,
  process: Bun.Subprocess,
): Promise<void> {
  const deadline = Date.now() + 5_000

  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`Apple signer exited with code ${process.exitCode}`)
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
      const token = await fetch(`${signerUrl}/v1/apple/developer-token`)
      if (token.ok) return
      throw new Error(
        "Apple signer cannot issue tokens. Configure services/apple-token/.dev.vars and set SIGNING_ENABLED=true.",
      )
    }

    await Bun.sleep(75)
  }

  throw new Error(
    "Apple signer did not become ready. Check services/apple-token/.dev.vars.",
  )
}
