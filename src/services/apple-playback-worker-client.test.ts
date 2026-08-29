import { expect, test } from "bun:test"

import { encodePlaybackMessage, type PlaybackWorkerResponse } from "./apple-playback-protocol"
import {
  createProcessPlaybackWorkerClient,
  type PlaybackWorkerProcess,
} from "./apple-playback-worker-client"

test("owns worker framing, request correlation, and exit reporting", async () => {
  const output = new TransformStream<Uint8Array>()
  const writer = output.writable.getWriter()
  const encoder = new TextEncoder()
  const requests: Record<string, unknown>[] = []
  const exits: string[] = []
  let resolveExit!: (code: number) => void
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve
  })
  const process: PlaybackWorkerProcess = {
    stdin: {
      write(value) {
        const request = JSON.parse(value) as Record<string, unknown>
        requests.push(request)
        void writer.write(encoder.encode(encodePlaybackMessage({
          type: "result",
          requestId: Number(request.requestId),
          ok: true,
        } satisfies PlaybackWorkerResponse)))
        return value.length
      },
      flush: () => 0,
      end: () => {},
    },
    stdout: output.readable,
    exited,
    kill: () => {},
  }
  const client = createProcessPlaybackWorkerClient(
    () => {},
    (code) => exits.push(code),
    () => {},
    () => process,
  )

  await client.pause()
  expect(requests).toEqual([{ type: "pause", requestId: 1 }])

  resolveExit(1)
  await Bun.sleep(0)
  expect(exits).toEqual(["worker_crashed"])
})
