import { describe, expect, test } from "bun:test"

import {
  isPlaybackDocumentUrl,
  loopbackPlaybackUrl,
} from "./apple-playback-origin"

describe("Apple playback origin", () => {
  test("accepts only the exact loopback HTTP service", () => {
    expect(loopbackPlaybackUrl("http://127.0.0.1:8787")).toBe(
      "http://127.0.0.1:8787/playback",
    )
    expect(loopbackPlaybackUrl("https://127.0.0.1:8787")).toBeNull()
    expect(loopbackPlaybackUrl("http://localhost:8787")).toBeNull()
    expect(loopbackPlaybackUrl("http://user@127.0.0.1:8787")).toBeNull()
    expect(loopbackPlaybackUrl("https://music.example.test")).toBeNull()
  })

  test("rejects a redirected or replaced playback document", () => {
    const expected = "http://127.0.0.1:8787/playback"
    expect(isPlaybackDocumentUrl(expected, expected)).toBe(true)
    expect(isPlaybackDocumentUrl("http://127.0.0.1:8787/authorize", expected)).toBe(false)
    expect(isPlaybackDocumentUrl("https://music.example.test/playback", expected)).toBe(false)
  })
})
