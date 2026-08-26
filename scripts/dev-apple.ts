export {}

const host = process.env.NUTA_TOKEN_SERVICE_HOST ?? "127.0.0.1"
const port = process.env.NUTA_TOKEN_SERVICE_PORT ?? "8787"
const serviceUrl = `http://${host}:${port}`

const service = Bun.spawn({
  cmd: [process.execPath, "run", "services/apple-token/src/index.ts"],
  cwd: process.cwd(),
  env: {
    ...process.env,
    NUTA_TOKEN_SERVICE_HOST: host,
    NUTA_TOKEN_SERVICE_PORT: port,
  },
  stdin: "ignore",
  stdout: "inherit",
  stderr: "inherit",
})

let app: Bun.Subprocess | undefined

function stopChildren(): void {
  app?.kill()
  service.kill()
}

process.once("SIGINT", stopChildren)
process.once("SIGTERM", stopChildren)

try {
  await waitForService(`${serviceUrl}/health`, service)

  app = Bun.spawn({
    cmd: [process.execPath, "run", "src/index.ts"],
    cwd: process.cwd(),
    env: {
      ...process.env,
      NUTA_TOKEN_SERVICE_URL: serviceUrl,
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })

  const exitCode = await app.exited
  process.exitCode = exitCode
} finally {
  stopChildren()
  await service.exited
}

async function waitForService(
  healthUrl: string,
  process: Bun.Subprocess,
): Promise<void> {
  const deadline = Date.now() + 5_000

  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`Token service exited with code ${process.exitCode}`)
    }

    try {
      const response = await fetch(healthUrl)
      if (response.ok) return
    } catch {
      // The service may still be binding its port.
    }

    await Bun.sleep(75)
  }

  throw new Error(`Token service did not become ready at ${healthUrl}`)
}
