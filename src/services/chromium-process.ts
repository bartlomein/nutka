import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const MAX_PACTL_OUTPUT_BYTES = 256 * 1024
const PACTL_TIMEOUT_MS = 3_000

export function playbackBrowserEnvironment(
  environment: NodeJS.ProcessEnv,
): Record<string, string> {
  const allowed = [
    "DBUS_SESSION_BUS_ADDRESS",
    "DISPLAY",
    "HOME",
    "LANG",
    "LC_ALL",
    "PATH",
    "PIPEWIRE_REMOTE",
    "PULSE_SERVER",
    "TZ",
    "WAYLAND_DISPLAY",
    "XAUTHORITY",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_RUNTIME_DIR",
  ]
  return Object.fromEntries(
    allowed.flatMap((name) => environment[name] ? [[name, environment[name]]] : []),
  )
}

export async function detectChromiumAudioSink(browserProcessId: number | null): Promise<boolean> {
  if (process.platform !== "linux" || !browserProcessId) return false
  const child = Bun.spawn({
    cmd: ["/usr/bin/pactl", "-f", "json", "list", "sink-inputs"],
    env: playbackBrowserEnvironment(process.env),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  })
  const result = await readBoundedProcessOutput(
    child,
    MAX_PACTL_OUTPUT_BYTES,
    PACTL_TIMEOUT_MS,
  )
  if (!result || result.exitCode !== 0) return false
  const output = result.output

  let inputs: unknown
  try {
    inputs = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(output))
  } catch {
    return false
  }
  if (!Array.isArray(inputs)) return false
  for (const input of inputs) {
    if (!input || typeof input !== "object") continue
    const properties = (input as { properties?: unknown }).properties
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) continue
    const processId = Number((properties as Record<string, unknown>)["application.process.id"])
    if (Number.isInteger(processId) && await isDescendantProcess(processId, browserProcessId)) {
      return true
    }
  }
  return false
}

export interface BoundedOutputProcess {
  readonly stdout: ReadableStream<Uint8Array>
  readonly exited: Promise<number>
  kill(signal?: number | string): void
}

export async function readBoundedProcessOutput(
  child: BoundedOutputProcess,
  maximumBytes: number,
  timeoutMs: number,
): Promise<{ output: Uint8Array; exitCode: number } | null> {
  const operation = (async () => {
    const output = await readBoundedStream(child.stdout, maximumBytes)
    if (!output) {
      child.kill()
      return null
    }
    return { output, exitCode: await child.exited }
  })().catch(() => null)
  const result = await Promise.race([
    operation,
    Bun.sleep(timeoutMs).then(() => null),
  ])
  if (!result) child.kill()
  return result
}

async function readBoundedStream(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
): Promise<Uint8Array | null> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maximumBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

export function applePlaybackProfilePath(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const stateHome = environment.XDG_STATE_HOME || join(homedir(), ".local", "state")
  return join(stateHome, "nutka", "chromium-profile")
}

export function defaultChromiumExecutablePath(): string {
  return "/usr/bin/chromium"
}

export async function isDescendantProcess(
  processId: number,
  ancestorId: number,
): Promise<boolean> {
  let current = processId
  for (let depth = 0; depth < 32 && current > 1; depth++) {
    if (current === ancestorId) return true
    try {
      const status = await readFile(`/proc/${current}/status`, "utf8")
      const match = status.match(/^PPid:\s+(\d+)$/m)
      if (!match) return false
      current = Number(match[1])
    } catch {
      return false
    }
  }
  return false
}
