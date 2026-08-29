import {
  MAX_PLAYBACK_MESSAGE_BYTES,
  decodePlaybackWorkerRequest,
  encodePlaybackMessage,
} from "./apple-playback-protocol"
import { launchPuppeteerPlaybackBrowser } from "./apple-playback-probe"
import { PipeWireSpectrumSource } from "./pipewire-audio-analysis"
import { ApplePlaybackWorkerRuntime } from "./apple-playback-worker-runtime"

const POLL_INTERVAL_MS = 500

export async function runPlaybackWorker(): Promise<number> {
  const runtime = new ApplePlaybackWorkerRuntime({
    launchBrowser: launchPuppeteerPlaybackBrowser,
    createSpectrumSource: (options) => new PipeWireSpectrumSource(options),
    write: (message) => {
      process.stdout.write(encodePlaybackMessage(message))
    },
    drain: () => new Promise<void>((resolve) => {
      process.stdout.write("", () => resolve())
    }),
    sleep: Bun.sleep,
    now: Date.now,
    kill: (processId, signal) => process.kill(processId, signal),
  })
  const poll = setInterval(() => void runtime.pollOnce(), POLL_INTERVAL_MS)
  const onSignal = () => void runtime.shutdown()
  process.once("SIGINT", onSignal)
  process.once("SIGTERM", onSignal)
  void readRequests(runtime).catch(() => runtime.shutdown(true))

  await runtime.whenShutdown
  clearInterval(poll)
  process.removeListener("SIGINT", onSignal)
  process.removeListener("SIGTERM", onSignal)
  return runtime.exitCode
}

async function readRequests(runtime: ApplePlaybackWorkerRuntime): Promise<void> {
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let buffer = ""
  let lastRequest: Promise<void> = Promise.resolve()
  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk, { stream: true })
    if (Buffer.byteLength(buffer, "utf8") > MAX_PLAYBACK_MESSAGE_BYTES && !buffer.includes("\n")) {
      throw new Error("message_too_large")
    }
    let newline = buffer.indexOf("\n")
    while (newline >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line) {
        const request = decodePlaybackWorkerRequest(line)
        if (!request) throw new Error("invalid_message")
        lastRequest = runtime.enqueue(request)
      }
      newline = buffer.indexOf("\n")
    }
  }
  if (buffer.trim()) throw new Error("incomplete_message")
  await lastRequest
  await runtime.shutdown()
}

if (import.meta.main) {
  void runPlaybackWorker().then(
    (exitCode) => process.exit(exitCode),
    () => process.exit(1),
  )
}
