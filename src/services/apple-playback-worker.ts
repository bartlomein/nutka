import {
  MAX_PLAYBACK_MESSAGE_BYTES,
  decodePlaybackWorkerRequest,
  encodePlaybackMessage,
  type PlaybackWorkerRequest,
  type PlaybackWorkerResponse,
} from "./apple-playback-protocol"
import {
  launchPuppeteerPlaybackBrowser,
  type PlaybackProbeBrowser,
  type PlaybackProbeSnapshot,
} from "./apple-playback-probe"

const START_TIMEOUT_MS = 30_000
const CONTROL_TIMEOUT_MS = 10_000
const POLL_INTERVAL_MS = 500
const BROWSER_CLOSE_TIMEOUT_MS = 1_500

let browser: PlaybackProbeBrowser | undefined
let activeLoadId: number | null = null
let activeResourceIds: readonly string[] = []
let confirmedStatus: "idle" | "playing" | "paused" = "idle"
let commandRunning = false
let shuttingDown = false

const poll = setInterval(() => {
  if (!browser || commandRunning || shuttingDown) return
  void emitSnapshot().catch(() => void fatalShutdown())
}, POLL_INTERVAL_MS)

process.once("SIGINT", () => void shutdown())
process.once("SIGTERM", () => void shutdown())

void readRequests().catch(() => void fatalShutdown())

async function readRequests(): Promise<void> {
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let buffer = ""
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
        await handleRequest(request)
      }
      newline = buffer.indexOf("\n")
    }
  }
  if (buffer.trim()) throw new Error("incomplete_message")
  await shutdown()
}

async function handleRequest(request: PlaybackWorkerRequest): Promise<void> {
  if (shuttingDown) return
  commandRunning = true
  try {
    switch (request.type) {
      case "initialize":
        if (browser) throw new Error("already_initialized")
        browser = await launchPuppeteerPlaybackBrowser(
          request.executablePath,
          request.playbackUrl,
          request.profilePath,
        )
        await browser.initialize(request.developerToken, request.musicUserToken)
        await emitSnapshot()
        send({ type: "result", requestId: request.requestId, ok: true })
        return

      case "play": {
        const activeBrowser = requireBrowser()
        const previousLoadId = activeLoadId
        const previousResourceIds = activeResourceIds
        const previousStatus = confirmedStatus
        activeLoadId = request.loadId
        activeResourceIds = request.tracks.map((track) => track.resourceId)
        confirmedStatus = "idle"
        try {
          await activeBrowser.setQueue(request.tracks.map((track) => track.resourceId))
          await clickAndWait("play", START_TIMEOUT_MS)
          await waitForSnapshot(
            (snapshot) =>
              snapshot.isPlaying === true &&
              snapshot.resourceId === request.tracks[0]!.resourceId,
            START_TIMEOUT_MS,
          )
          confirmedStatus = "playing"
          await emitSnapshot()
          send({ type: "result", requestId: request.requestId, ok: true })
          return
        } catch (error) {
          const snapshot = await activeBrowser.snapshot().catch(() => undefined)
          if (!snapshot) return fatalShutdown()
          const snapshotState = snapshot.playbackState ?? -1
          const mediaMayContinue = snapshot.isPlaying === true ||
            ![0, 4, 10].includes(snapshotState)
          const previousTrackRemains = Boolean(
            previousLoadId !== null &&
            snapshot.resourceId &&
            previousResourceIds.includes(snapshot.resourceId) &&
            mediaMayContinue,
          )
          if (previousTrackRemains) {
            activeLoadId = previousLoadId
            activeResourceIds = previousResourceIds
            confirmedStatus = snapshot.isPlaying === true
              ? "playing"
              : snapshot.playbackState === 3
                ? "paused"
                : previousStatus
          } else {
            if (mediaMayContinue) {
              try {
                await clickAndWait("stop", CONTROL_TIMEOUT_MS)
                await waitForSnapshot(
                  (stopped) => stopped.isPlaying === false,
                  CONTROL_TIMEOUT_MS,
                )
              } catch {
                await fatalShutdown()
              }
            }
            activeLoadId = null
            activeResourceIds = []
            confirmedStatus = "idle"
          }
          await emitSnapshot().catch(() => {})
          throw error
        }
      }

      case "pause":
        await clickAndWait("pause", CONTROL_TIMEOUT_MS)
        await waitForSnapshot((snapshot) => snapshot.isPlaying === false, CONTROL_TIMEOUT_MS)
        confirmedStatus = "paused"
        await emitSnapshot()
        send({ type: "result", requestId: request.requestId, ok: true })
        return

      case "resume":
        await clickAndWait("resume", CONTROL_TIMEOUT_MS)
        await waitForSnapshot((snapshot) => snapshot.isPlaying === true, CONTROL_TIMEOUT_MS)
        confirmedStatus = "playing"
        await emitSnapshot()
        send({ type: "result", requestId: request.requestId, ok: true })
        return

      case "seek":
        await requireBrowser().seek(request.positionSeconds)
        await waitForSnapshot(
          (snapshot) => Math.abs((snapshot.positionSeconds ?? 0) - request.positionSeconds) < 2,
          CONTROL_TIMEOUT_MS,
        )
        await emitSnapshot()
        send({ type: "result", requestId: request.requestId, ok: true })
        return

      case "stop":
        await clickAndWait("stop", CONTROL_TIMEOUT_MS)
        await waitForSnapshot((snapshot) => snapshot.isPlaying === false, CONTROL_TIMEOUT_MS)
        confirmedStatus = "idle"
        activeLoadId = null
        activeResourceIds = []
        await emitSnapshot()
        send({ type: "result", requestId: request.requestId, ok: true })
        return

      case "shutdown":
        send({ type: "result", requestId: request.requestId, ok: true })
        await shutdown()
    }
  } catch (error) {
    send({
      type: "result",
      requestId: request.requestId,
      ok: false,
      errorCode: await commandErrorCode(error),
    })
  } finally {
    commandRunning = false
  }
}

async function waitForSnapshot(
  accept: (snapshot: PlaybackProbeSnapshot) => boolean,
  timeoutMs: number,
): Promise<PlaybackProbeSnapshot> {
  const activeBrowser = requireBrowser()
  const deadline = Date.now() + timeoutMs
  let snapshot = await activeBrowser.snapshot()
  while (true) {
    if (snapshot.lastErrorCode) throw new Error(snapshot.lastErrorCode)
    if (accept(snapshot)) return snapshot
    if (Date.now() >= deadline) throw new Error("playback_timeout")
    await Bun.sleep(250)
    snapshot = await activeBrowser.snapshot()
  }
}

async function clickAndWait(
  control: "play" | "pause" | "resume" | "stop",
  timeoutMs: number,
): Promise<PlaybackProbeSnapshot> {
  const activeBrowser = requireBrowser()
  const before = (await activeBrowser.snapshot()).completedCommandSequence ?? 0
  await activeBrowser.click(control)
  return waitForSnapshot(
    (snapshot) => (snapshot.completedCommandSequence ?? 0) > before,
    timeoutMs,
  )
}

async function emitSnapshot(): Promise<void> {
  const snapshot = await requireBrowser().snapshot()
  reconcilePlaybackState(snapshot)
  send({
    type: "snapshot",
    loadId: activeLoadId,
    resourceId: safeResourceId(snapshot.resourceId),
    status: confirmedStatus,
    positionSeconds: finiteNonNegative(snapshot.positionSeconds) ?? 0,
    durationSeconds: finiteNonNegative(snapshot.durationSeconds),
    errorCode: safeCode(snapshot.lastErrorCode),
    audioQuality: snapshot.audioQuality ?? null,
  })
}

function reconcilePlaybackState(snapshot: PlaybackProbeSnapshot): void {
  if (commandRunning) return
  if (snapshot.isPlaying === true) {
    confirmedStatus = "playing"
    return
  }
  if ([0, 4, 10].includes(snapshot.playbackState ?? -1)) {
    confirmedStatus = "idle"
    activeLoadId = null
    activeResourceIds = []
    return
  }
  if (snapshot.playbackState === 3) confirmedStatus = "paused"
}

async function commandErrorCode(error: unknown): Promise<string> {
  try {
    const snapshot = await browser?.snapshot()
    const code = safeCode(snapshot?.lastErrorCode)
    if (code) return code
  } catch {}
  return error instanceof Error && safeCode(error.message) ? error.message : "control_failed"
}

function requireBrowser(): PlaybackProbeBrowser {
  if (!browser) throw new Error("not_initialized")
  return browser
}

function send(message: PlaybackWorkerResponse): void {
  process.stdout.write(encodePlaybackMessage(message))
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  clearInterval(poll)
  await closeBrowser()
  await flushStdout()
  process.exit(0)
}

async function fatalShutdown(): Promise<never> {
  if (shuttingDown) process.exit(1)
  shuttingDown = true
  clearInterval(poll)
  await closeBrowser()
  await flushStdout()
  process.exit(1)
}

function flushStdout(): Promise<void> {
  process.stdout.write("")
  return Bun.sleep(0)
}

async function closeBrowser(): Promise<void> {
  const activeBrowser = browser
  if (!activeBrowser) return
  const processId = activeBrowser.processId
  const closed = await Promise.race([
    activeBrowser.close().then(() => true, () => true),
    Bun.sleep(BROWSER_CLOSE_TIMEOUT_MS).then(() => false),
  ])
  if (!closed && processId) {
    try {
      process.kill(processId, "SIGKILL")
    } catch {}
  }
}

function safeResourceId(value: string | null | undefined): string | null {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(value) ? value : null
}

function safeCode(value: string | null | undefined): string | null {
  return typeof value === "string" && /^[a-z0-9_.:-]{1,64}$/i.test(value) ? value : null
}

function finiteNonNegative(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}
