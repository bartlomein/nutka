import { describe, expect, test } from "bun:test"

import {
  decodePlaybackWorkerRequest,
  decodePlaybackWorkerResponse,
  encodePlaybackMessage,
} from "./apple-playback-protocol"

describe("Apple playback worker protocol", () => {
  test("round-trips bounded initialization and snapshot messages", () => {
    const request = {
      type: "initialize" as const,
      requestId: 1,
      executablePath: "/usr/bin/chromium",
      playbackUrl: "http://127.0.0.1:8787/playback",
      profilePath: "/private/profile",
      developerToken: "developer-token",
      musicUserToken: "music-user-token",
    }
    expect(decodePlaybackWorkerRequest(encodePlaybackMessage(request).trim())).toEqual(request)
    expect(decodePlaybackWorkerRequest('{"type":"previous","requestId":2}')).toEqual({
      type: "previous",
      requestId: 2,
    })
    expect(decodePlaybackWorkerRequest('{"type":"next","requestId":3}')).toEqual({
      type: "next",
      requestId: 3,
    })
    expect(decodePlaybackWorkerRequest(
      '{"type":"set-audio-analysis-enabled","requestId":4,"enabled":false}',
    )).toEqual({
      type: "set-audio-analysis-enabled",
      requestId: 4,
      enabled: false,
    })

    const response = {
      type: "snapshot" as const,
      loadId: 2,
      resourceId: "123",
      status: "playing" as const,
      positionSeconds: 4,
      durationSeconds: 180,
      errorCode: null,
      audioQuality: {
        format: "aac" as const,
        bitrateKbps: 256,
        source: "playback" as const,
      },
    }
    expect(decodePlaybackWorkerResponse(encodePlaybackMessage(response).trim())).toEqual(response)
  })

  test("rejects malformed, oversized, and unsafe messages", () => {
    expect(decodePlaybackWorkerRequest("not json")).toBeNull()
    expect(decodePlaybackWorkerRequest(JSON.stringify({
      type: "play",
      requestId: 1,
      loadId: 1,
      tracks: [{ trackId: "track", resourceId: "bad/id" }],
    }))).toBeNull()
    expect(decodePlaybackWorkerResponse(JSON.stringify({
      type: "snapshot",
      loadId: null,
      resourceId: null,
      status: "forged",
      positionSeconds: 0,
      durationSeconds: null,
      errorCode: null,
    }))).toBeNull()
    expect(decodePlaybackWorkerRequest(`{"type":"initialize","padding":"${"x".repeat(70_000)}"}`)).toBeNull()
    expect(decodePlaybackWorkerRequest(
      '{"type":"set-audio-analysis-enabled","requestId":1,"enabled":"false"}',
    )).toBeNull()
  })

  test("accepts only fixed-size bounded spectrum frames", () => {
    const frame = {
      type: "spectrum" as const,
      loadId: 2,
      sequence: 9,
      bands: Array.from({ length: 64 }, (_, index) => index * 4),
      rms: 120,
      peak: 240,
    }
    expect(decodePlaybackWorkerResponse(encodePlaybackMessage(frame).trim())).toEqual(frame)
    expect(decodePlaybackWorkerResponse(JSON.stringify({
      ...frame,
      bands: frame.bands.slice(1),
    }))).toBeNull()
    expect(decodePlaybackWorkerResponse(JSON.stringify({
      ...frame,
      bands: [...frame.bands.slice(0, -1), 256],
    }))).toBeNull()
  })
})
