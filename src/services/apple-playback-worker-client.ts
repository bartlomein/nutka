import { join } from "node:path"

import type { PlaybackRepeatMode, PlaybackShuffleMode } from "../core/types"
import {
  MAX_PLAYBACK_MESSAGE_BYTES,
  decodePlaybackWorkerResponse,
  encodePlaybackMessage,
  type PlaybackWorkerResponse,
  type PlaybackWorkerTrack,
} from "./apple-playback-protocol"
import { playbackBrowserEnvironment } from "./chromium-process"

const INITIALIZE_TIMEOUT_MS = 45_000
const PLAY_TIMEOUT_MS = 35_000
const CONTROL_TIMEOUT_MS = 15_000
const SHUTDOWN_TIMEOUT_MS = 2_000

export class ApplePlaybackError extends Error {
  constructor(readonly code: string) {
    super("Apple Music playback is unavailable")
    this.name = "ApplePlaybackError"
  }
}

interface PlaybackWorkerInitialization {
  executablePath: string
  playbackUrl: string
  profilePath: string
  developerToken: string
  musicUserToken: string
}

export interface PlaybackWorkerClient {
  initialize(options: PlaybackWorkerInitialization): Promise<void>
  setAudioAnalysisEnabled(enabled: boolean): Promise<void>
  play(loadId: number, tracks: readonly PlaybackWorkerTrack[]): Promise<void>
  playStation(loadId: number, stationResourceId: string, title: string, isLive: boolean): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  previous(): Promise<void>
  next(): Promise<void>
  setShuffleMode(mode: PlaybackShuffleMode): Promise<void>
  setRepeatMode(mode: PlaybackRepeatMode): Promise<void>
  seek(positionSeconds: number): Promise<void>
  stop(): Promise<void>
  dispose(): Promise<void>
}

export interface PlaybackWorkerProcess {
  stdin: {
    write(value: string): number
    flush(): number | Promise<number>
    end(): void
  }
  stdout: ReadableStream<Uint8Array>
  exited: Promise<number>
  kill(signal?: number | string): void
}

export function createProcessPlaybackWorkerClient(
  onSnapshot: (snapshot: Extract<PlaybackWorkerResponse, { type: "snapshot" }>) => void,
  onExit: (errorCode: string) => void,
  onSpectrum: (frame: Extract<PlaybackWorkerResponse, { type: "spectrum" }>) => void,
  spawnWorker: () => PlaybackWorkerProcess = spawnPlaybackWorker,
): PlaybackWorkerClient {
  return new ProcessPlaybackWorkerClient(
    spawnWorker(),
    onSnapshot,
    onExit,
    onSpectrum,
  )
}

export class ProcessPlaybackWorkerClient implements PlaybackWorkerClient {
  private readonly pending = new Map<number, {
    resolve: () => void
    reject: (error: unknown) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private nextRequestId = 1
  private failed = false
  private disposing = false
  private disposePromise?: Promise<void>

  constructor(
    private readonly child: PlaybackWorkerProcess,
    private readonly onSnapshot: (
      snapshot: Extract<PlaybackWorkerResponse, { type: "snapshot" }>,
    ) => void,
    private readonly onExit: (errorCode: string) => void,
    private readonly onSpectrum: (
      frame: Extract<PlaybackWorkerResponse, { type: "spectrum" }>,
    ) => void,
  ) {
    void this.readResponses()
    void this.child.exited.then((exitCode) => {
      if (!this.disposing) this.fail(exitCode === 0 ? "worker_exited" : "worker_crashed")
    })
  }

  initialize(options: PlaybackWorkerInitialization): Promise<void> {
    return this.request({ type: "initialize", ...options }, INITIALIZE_TIMEOUT_MS)
  }

  setAudioAnalysisEnabled(enabled: boolean): Promise<void> {
    return this.request({ type: "set-audio-analysis-enabled", enabled }, CONTROL_TIMEOUT_MS)
  }

  play(loadId: number, tracks: readonly PlaybackWorkerTrack[]): Promise<void> {
    return this.request({ type: "play", loadId, tracks }, PLAY_TIMEOUT_MS)
  }

  playStation(
    loadId: number,
    stationResourceId: string,
    title: string,
    isLive: boolean,
  ): Promise<void> {
    return this.request(
      { type: "play-station", loadId, stationResourceId, title, isLive },
      PLAY_TIMEOUT_MS,
    )
  }

  pause(): Promise<void> {
    return this.request({ type: "pause" }, CONTROL_TIMEOUT_MS)
  }

  resume(): Promise<void> {
    return this.request({ type: "resume" }, CONTROL_TIMEOUT_MS)
  }

  previous(): Promise<void> {
    return this.request({ type: "previous" }, CONTROL_TIMEOUT_MS)
  }

  next(): Promise<void> {
    return this.request({ type: "next" }, CONTROL_TIMEOUT_MS)
  }

  setShuffleMode(mode: PlaybackShuffleMode): Promise<void> {
    return this.request({ type: "set-shuffle-mode", mode }, CONTROL_TIMEOUT_MS)
  }

  setRepeatMode(mode: PlaybackRepeatMode): Promise<void> {
    return this.request({ type: "set-repeat-mode", mode }, CONTROL_TIMEOUT_MS)
  }

  seek(positionSeconds: number): Promise<void> {
    return this.request({ type: "seek", positionSeconds }, CONTROL_TIMEOUT_MS)
  }

  stop(): Promise<void> {
    return this.request({ type: "stop" }, CONTROL_TIMEOUT_MS)
  }

  dispose(): Promise<void> {
    this.disposePromise ??= this.runDispose()
    return this.disposePromise
  }

  private async runDispose(): Promise<void> {
    this.disposing = true
    let acknowledged = false
    try {
      if (!this.failed) {
        await this.request({ type: "shutdown" }, SHUTDOWN_TIMEOUT_MS)
        acknowledged = true
      }
    } catch {
    } finally {
      this.child.stdin.end()
      if (!acknowledged || !(await exitsWithin(this.child, SHUTDOWN_TIMEOUT_MS))) {
        this.child.kill(9)
        await exitsWithin(this.child, SHUTDOWN_TIMEOUT_MS)
      }
      this.rejectPending("worker_disposed")
    }
  }

  private request(request: Record<string, unknown>, timeoutMs: number): Promise<void> {
    if (this.failed) return Promise.reject(new ApplePlaybackError("worker_unavailable"))
    const requestId = this.nextRequestId++
    const encoded = encodePlaybackMessage({ ...request, requestId })
    if (Buffer.byteLength(encoded, "utf8") > MAX_PLAYBACK_MESSAGE_BYTES) {
      return Promise.reject(new ApplePlaybackError("queue_too_large"))
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new ApplePlaybackError("worker_timeout"))
        this.fail("worker_timeout")
      }, timeoutMs)
      this.pending.set(requestId, { resolve, reject, timer })
      try {
        this.child.stdin.write(encoded)
        this.child.stdin.flush()
      } catch {
        clearTimeout(timer)
        this.pending.delete(requestId)
        reject(new ApplePlaybackError("worker_unavailable"))
        this.fail("worker_unavailable")
      }
    })
  }

  private async readResponses(): Promise<void> {
    const decoder = new TextDecoder("utf-8", { fatal: true })
    let buffer = ""
    try {
      for await (const chunk of this.child.stdout) {
        buffer += decoder.decode(chunk, { stream: true })
        if (
          Buffer.byteLength(buffer, "utf8") > MAX_PLAYBACK_MESSAGE_BYTES &&
          !buffer.includes("\n")
        ) throw new Error("message_too_large")
        let newline = buffer.indexOf("\n")
        while (newline >= 0) {
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          if (line) this.handleResponse(line)
          newline = buffer.indexOf("\n")
        }
      }
      if (buffer.trim()) throw new Error("incomplete_message")
    } catch {
      this.fail("worker_protocol_error")
    }
  }

  private handleResponse(line: string): void {
    const response = decodePlaybackWorkerResponse(line)
    if (!response) {
      this.fail("worker_protocol_error")
      return
    }
    if (response.type === "snapshot") {
      this.onSnapshot(response)
      return
    }
    if (response.type === "spectrum") {
      this.onSpectrum(response)
      return
    }
    const pending = this.pending.get(response.requestId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(response.requestId)
    if (response.ok) pending.resolve()
    else pending.reject(new ApplePlaybackError(response.errorCode ?? "control_failed"))
  }

  private fail(errorCode: string): void {
    if (this.failed || this.disposing) return
    this.failed = true
    this.child.kill()
    void exitsWithin(this.child, SHUTDOWN_TIMEOUT_MS).then((exited) => {
      if (!exited) this.child.kill(9)
    })
    this.rejectPending(errorCode)
    this.onExit(errorCode)
  }

  private rejectPending(errorCode: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new ApplePlaybackError(errorCode))
    }
    this.pending.clear()
  }
}

function spawnPlaybackWorker(): PlaybackWorkerProcess {
  return Bun.spawn({
    cmd: [process.execPath, "run", join(import.meta.dir, "apple-playback-worker.ts")],
    env: playbackBrowserEnvironment(process.env),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  }) as unknown as PlaybackWorkerProcess
}

async function exitsWithin(
  child: PlaybackWorkerProcess,
  timeoutMs: number,
): Promise<boolean> {
  return Promise.race([
    child.exited.then(() => true, () => true),
    Bun.sleep(timeoutMs).then(() => false),
  ])
}
