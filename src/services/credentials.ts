const DEFAULT_TIMEOUT_MS = 5_000
const MAX_TOKEN_BYTES = 16 * 1024
const MAX_RAW_OUTPUT_BYTES = MAX_TOKEN_BYTES + 2

const LINUX_TOOL = "/usr/bin/secret-tool"
const LINUX_ATTRIBUTES = [
  "application",
  "nutka",
  "credential",
  "apple-music-user-token",
  "version",
  "1",
] as const
const LEGACY_LINUX_ATTRIBUTES = [
  "application",
  "nuta",
  "credential",
  "apple-music-user-token",
  "version",
  "1",
] as const

export interface CredentialStore {
  load(): Promise<string | null>
  save(token: string): Promise<void>
  delete(): Promise<void>
}

export interface ProcessRequest {
  executable: string
  args: readonly string[]
  stdin?: Uint8Array
  timeoutMs: number
  maxStdoutBytes: number
  env: Readonly<Record<string, string>>
  signal?: AbortSignal
}

export interface ProcessResult {
  exitCode: number
  stdout: Uint8Array
}

export interface ProcessRunner {
  run(request: ProcessRequest): Promise<ProcessResult>
}

export type CredentialStoreErrorCode =
  | "unsupported_platform"
  | "store_unavailable"
  | "operation_failed"
  | "invalid_data"
  | "timeout"

export class CredentialStoreError extends Error {
  readonly code: CredentialStoreErrorCode

  constructor(code: CredentialStoreErrorCode) {
    super(errorMessage(code))
    this.name = "CredentialStoreError"
    this.code = code
  }
}

export interface CreateCredentialStoreOptions {
  platform?: NodeJS.Platform
  runner?: ProcessRunner
  timeoutMs?: number
  environment?: NodeJS.ProcessEnv
}

export function createCredentialStore(
  options: CreateCredentialStoreOptions = {},
): CredentialStore {
  const platform = options.platform ?? process.platform
  const runner = options.runner ?? bunProcessRunner
  const timeoutMs = validateTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const environment = createProcessEnvironment(
    platform,
    options.environment ?? process.env,
  )

  if (platform === "linux") {
    return createMigratingStore(
      createLinuxStore(
        runner,
        timeoutMs,
        environment,
        LINUX_ATTRIBUTES,
        "Nutka Apple Music",
      ),
      createLinuxStore(
        runner,
        timeoutMs,
        environment,
        LEGACY_LINUX_ATTRIBUTES,
        "Nuta Apple Music",
      ),
    )
  }
  throw new CredentialStoreError("unsupported_platform")
}

function createLinuxStore(
  runner: ProcessRunner,
  timeoutMs: number,
  env: Readonly<Record<string, string>>,
  attributes: readonly string[],
  label: string,
): CredentialStore {
  return {
    async load() {
      const result = await run(
        runner,
        {
          executable: LINUX_TOOL,
          args: ["lookup", ...attributes],
          timeoutMs,
          maxStdoutBytes: MAX_RAW_OUTPUT_BYTES,
          env,
        },
        "load",
      )
      if (result.exitCode === 1) return null
      requireSuccess(result)
      return decodeToolToken(result.stdout, MAX_RAW_OUTPUT_BYTES)
    },

    async save(token) {
      const bytes = validateToken(token)
      const result = await run(
        runner,
        {
          executable: LINUX_TOOL,
          args: ["store", `--label=${label}`, ...attributes],
          stdin: bytes,
          timeoutMs,
          maxStdoutBytes: 1,
          env,
        },
        "save",
      )
      requireSuccess(result)
    },

    async delete() {
      const result = await run(
        runner,
        {
          executable: LINUX_TOOL,
          args: ["clear", ...attributes],
          timeoutMs,
          maxStdoutBytes: 1,
          env,
        },
        "delete",
      )
      if (result.exitCode !== 0 && result.exitCode !== 1) requireSuccess(result)
    },
  }
}

function createMigratingStore(
  current: CredentialStore,
  legacy: CredentialStore,
): CredentialStore {
  return {
    async load() {
      const currentToken = await current.load()
      if (currentToken !== null) return currentToken

      const legacyToken = await legacy.load()
      if (legacyToken === null) return null
      await current.save(legacyToken)
      await legacy.delete()
      return legacyToken
    },

    save(token) {
      return current.save(token)
    },

    async delete() {
      let failure: unknown
      try {
        await current.delete()
      } catch (error) {
        failure = error
      }
      try {
        await legacy.delete()
      } catch (error) {
        failure ??= error
      }
      if (failure) throw failure
    },
  }
}

async function run(
  runner: ProcessRunner,
  request: ProcessRequest,
  operation: "load" | "save" | "delete",
): Promise<ProcessResult> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const execution = Promise.resolve()
      .then(() => runner.run({ ...request, signal: controller.signal }))
      .catch((error: unknown) => {
        if (error instanceof CredentialStoreError) throw error
        if (error instanceof ProcessRunnerError && error.reason === "timeout") {
          throw new CredentialStoreError("timeout")
        }
        if (
          error instanceof ProcessRunnerError &&
          error.reason === "unavailable"
        ) {
          throw new CredentialStoreError("store_unavailable")
        }
        throw new CredentialStoreError("operation_failed")
      })
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new CredentialStoreError("timeout"))
      }, request.timeoutMs)
    })

    return await Promise.race([execution, timeout])
  } catch (error) {
    if (error instanceof CredentialStoreError) throw error
    void operation
    throw new CredentialStoreError("operation_failed")
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function createProcessEnvironment(
  platform: NodeJS.Platform,
  source: NodeJS.ProcessEnv,
): Readonly<Record<string, string>> {
  const names =
    platform === "linux"
      ? [
          "HOME",
          "XDG_RUNTIME_DIR",
          "DBUS_SESSION_BUS_ADDRESS",
          "DISPLAY",
          "WAYLAND_DISPLAY",
        ]
      : []
  const env: Record<string, string> = {}
  for (const name of names) {
    const value = source[name]
    if (value !== undefined) env[name] = value
  }
  return Object.freeze(env)
}

function requireSuccess(result: ProcessResult): void {
  if (result.exitCode !== 0) {
    throw new CredentialStoreError("operation_failed")
  }
}

function validateToken(token: string): Uint8Array {
  if (token.length === 0 || token.includes("\n") || token.includes("\r")) {
    throw new CredentialStoreError("invalid_data")
  }
  const bytes = new TextEncoder().encode(token)
  if (bytes.byteLength > MAX_TOKEN_BYTES) {
    throw new CredentialStoreError("invalid_data")
  }
  if (new TextDecoder().decode(bytes) !== token) {
    throw new CredentialStoreError("invalid_data")
  }
  return bytes
}

function decodeToolToken(stdout: Uint8Array, maxBytes: number): string {
  if (stdout.byteLength === 0 || stdout.byteLength > maxBytes) {
    throw new CredentialStoreError("invalid_data")
  }

  let value: string
  try {
    value = new TextDecoder("utf-8", { fatal: true }).decode(stdout)
  } catch {
    throw new CredentialStoreError("invalid_data")
  }
  if (value.endsWith("\n")) value = value.slice(0, -1)
  if (value.endsWith("\r")) value = value.slice(0, -1)
  if (value.length === 0 || value.includes("\n") || value.includes("\r")) {
    throw new CredentialStoreError("invalid_data")
  }
  return value
}

function validateTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CredentialStoreError("operation_failed")
  }
  return value
}

function errorMessage(code: CredentialStoreErrorCode): string {
  switch (code) {
    case "unsupported_platform":
      return "Credential storage is not supported on this platform"
    case "store_unavailable":
      return "Credential storage is unavailable"
    case "operation_failed":
      return "Credential storage operation failed"
    case "invalid_data":
      return "Credential storage returned invalid data"
    case "timeout":
      return "Credential storage operation timed out"
  }
}

class ProcessRunnerError extends Error {
  constructor(readonly reason: "timeout" | "unavailable" | "failed") {
    super("Process runner failed")
  }
}

const bunProcessRunner: ProcessRunner = {
  async run(request) {
    let process: Bun.Subprocess<"pipe", "pipe", "ignore">
    try {
      process = Bun.spawn([request.executable, ...request.args], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "ignore",
        env: request.env,
      })
    } catch {
      throw new ProcessRunnerError("unavailable")
    }

    const reader = process.stdout.getReader()
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = () => {
      timedOut = true
      try {
        process.stdin.end()
      } catch {
        // The child may already have closed stdin.
      }
      void reader.cancel().catch(() => {})
      try {
        process.kill("SIGKILL")
      } catch {
        // The child may have exited between cancellation and the kill.
      }
    }
    const onAbort = () => stop()
    request.signal?.addEventListener("abort", onAbort, { once: true })

    try {
      const operation = (async () => {
        if (request.stdin) process.stdin.write(request.stdin)
        process.stdin.end()

        const chunks: Uint8Array[] = []
        let size = 0
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > request.maxStdoutBytes) {
            try {
              process.kill("SIGKILL")
            } catch {
              // The child may already have exited.
            }
            throw new CredentialStoreError("invalid_data")
          }
          chunks.push(value)
        }

        const exitCode = await process.exited
        if (timedOut) throw new ProcessRunnerError("timeout")
        const stdout = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) {
          stdout.set(chunk, offset)
          offset += chunk.byteLength
        }
        return { exitCode, stdout }
      })()
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          stop()
          reject(new ProcessRunnerError("timeout"))
        }, request.timeoutMs)
      })

      return await Promise.race([operation, timeout])
    } catch (error) {
      if (error instanceof CredentialStoreError) throw error
      if (timedOut) throw new ProcessRunnerError("timeout")
      throw new ProcessRunnerError("failed")
    } finally {
      if (timer) clearTimeout(timer)
      request.signal?.removeEventListener("abort", onAbort)
    }
  },
}
