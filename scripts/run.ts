import { createClientEnvironment } from "./client-environment"

const app = Bun.spawn({
  cmd: [process.execPath, "--no-env-file", "run", "src/index.ts"],
  cwd: process.cwd(),
  env: createClientEnvironment(),
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

function stop(): void {
  app.kill()
}

process.once("SIGINT", stop)
process.once("SIGTERM", stop)
process.exitCode = await app.exited
