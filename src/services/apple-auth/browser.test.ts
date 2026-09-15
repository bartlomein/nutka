import { describe, expect, test } from "bun:test"

import { browserOpenCommand } from "./browser"

describe("Apple authorization browser opener", () => {
  test("uses macOS open on Darwin", () => {
    expect(browserOpenCommand("https://example.test", "darwin")).toEqual([
      "/usr/bin/open",
      "https://example.test",
    ])
  })

  test("uses xdg-open elsewhere", () => {
    expect(browserOpenCommand("https://example.test", "linux")).toEqual([
      "/usr/bin/xdg-open",
      "https://example.test",
    ])
    expect(browserOpenCommand("https://example.test", "win32")).toEqual([
      "/usr/bin/xdg-open",
      "https://example.test",
    ])
  })
})
