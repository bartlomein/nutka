import { describe, expect, test } from "bun:test"

import { defaultChromiumExecutablePath } from "./chromium-process"

describe("default Chromium executable path", () => {
  test("uses the standard Google Chrome app path on macOS", () => {
    expect(defaultChromiumExecutablePath("darwin")).toBe(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    )
  })

  test("uses the Linux Chromium path otherwise", () => {
    expect(defaultChromiumExecutablePath("linux")).toBe("/usr/bin/chromium")
    expect(defaultChromiumExecutablePath("win32")).toBe("/usr/bin/chromium")
  })
})
