import { describe, expect, test } from "bun:test"

import {
  CredentialStoreError,
  createCredentialStore,
  type ProcessRequest,
  type ProcessResult,
  type ProcessRunner,
} from "./credentials"

const encoder = new TextEncoder()
const empty = new Uint8Array()

class FakeRunner implements ProcessRunner {
  readonly requests: ProcessRequest[] = []

  constructor(
    private readonly handler: (
      request: ProcessRequest,
    ) => ProcessResult | Promise<ProcessResult>,
  ) {}

  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.requests.push(request)
    return this.handler(request)
  }
}

function result(exitCode = 0, stdout = ""): ProcessResult {
  return { exitCode, stdout: encoder.encode(stdout) }
}

function stdin(request: ProcessRequest): string | undefined {
  return request.stdin && new TextDecoder().decode(request.stdin)
}

describe("Linux credential store", () => {
  test("uses fixed lookup attributes and loads private stdout", async () => {
    const runner = new FakeRunner(() => result(0, "user-token\n"))
    const store = createCredentialStore({ platform: "linux", runner })

    expect(await store.load()).toBe("user-token")
    expect(runner.requests).toEqual([
      {
        executable: "/usr/bin/secret-tool",
        args: [
          "lookup",
          "application",
          "nutka",
          "credential",
          "apple-music-user-token",
          "version",
          "1",
        ],
        timeoutMs: 5_000,
        maxStdoutBytes: 16_386,
        env: expect.any(Object),
        signal: expect.any(AbortSignal),
      },
    ])
  })

  test("migrates a legacy Nuta token without putting it in argv", async () => {
    const runner = new FakeRunner((request) => {
      if (request.args[0] === "lookup" && request.args.includes("nutka")) {
        return result(1)
      }
      if (request.args[0] === "lookup") return result(0, "legacy-token\n")
      return result()
    })
    const store = createCredentialStore({ platform: "linux", runner })

    expect(await store.load()).toBe("legacy-token")
    expect(runner.requests.map(({ args }) => args)).toEqual([
      [
        "lookup",
        "application",
        "nutka",
        "credential",
        "apple-music-user-token",
        "version",
        "1",
      ],
      [
        "lookup",
        "application",
        "nuta",
        "credential",
        "apple-music-user-token",
        "version",
        "1",
      ],
      [
        "store",
        "--label=Nutka Apple Music",
        "application",
        "nutka",
        "credential",
        "apple-music-user-token",
        "version",
        "1",
      ],
      [
        "clear",
        "application",
        "nuta",
        "credential",
        "apple-music-user-token",
        "version",
        "1",
      ],
    ])
    expect(stdin(runner.requests[2]!)).toBe("legacy-token")
    expect(runner.requests.flatMap(({ args }) => args)).not.toContain("legacy-token")
  })

  test("saves the token only on stdin without a newline", async () => {
    const token = "private.token-value"
    const runner = new FakeRunner(() => result())
    const store = createCredentialStore({ platform: "linux", runner })

    await store.save(token)

    expect(runner.requests[0]?.args).toEqual([
      "store",
      "--label=Nutka Apple Music",
      "application",
      "nutka",
      "credential",
      "apple-music-user-token",
      "version",
      "1",
    ])
    expect(stdin(runner.requests[0]!)).toBe(token)
    expect(runner.requests[0]?.args.join(" ")).not.toContain(token)
    expect(stdin(runner.requests[0]!)).not.toEndWith("\n")
  })

  test("returns null for a missing item", async () => {
    const store = createCredentialStore({
      platform: "linux",
      runner: new FakeRunner(() => result(1, "ignored diagnostic")),
    })
    expect(await store.load()).toBeNull()
  })

  test("clears with fixed attributes and treats a missing item as success", async () => {
    const runner = new FakeRunner(() => result(1))
    const store = createCredentialStore({ platform: "linux", runner })
    await expect(store.delete()).resolves.toBeUndefined()
    expect(runner.requests.map(({ args }) => args)).toEqual([
      [
        "clear",
        "application",
        "nutka",
        "credential",
        "apple-music-user-token",
        "version",
        "1",
      ],
      [
        "clear",
        "application",
        "nuta",
        "credential",
        "apple-music-user-token",
        "version",
        "1",
      ],
    ])
  })
})

describe("credential store failures", () => {
  test("rejects unsupported platforms with a typed sanitized error", () => {
    expect(() =>
      createCredentialStore({ platform: "darwin" }),
    ).toThrow(CredentialStoreError)
    try {
      createCredentialStore({ platform: "darwin" })
    } catch (error) {
      expect(error).toMatchObject({ code: "unsupported_platform" })
    }
  })

  test("sanitizes runner failures without exposing token or stdout", async () => {
    const secret = "do-not-leak"
    const runner = new FakeRunner(() => {
      throw new Error(`${secret}: private stdout`)
    })
    const store = createCredentialStore({ platform: "linux", runner })

    for (const operation of [store.load(), store.save(secret), store.delete()]) {
      try {
        await operation
        throw new Error("expected rejection")
      } catch (error) {
        expect(error).toBeInstanceOf(CredentialStoreError)
        expect(String(error)).not.toContain(secret)
        expect(String(error)).not.toContain("private stdout")
      }
    }
  })

  test("sanitizes nonzero process failures", async () => {
    const store = createCredentialStore({
      platform: "linux",
      runner: new FakeRunner(() => result(2, "sensitive tool output")),
    })
    try {
      await store.load()
      throw new Error("expected rejection")
    } catch (error) {
      expect(error).toMatchObject({ code: "operation_failed" })
      expect(String(error)).not.toContain("sensitive tool output")
    }
  })

  test("rejects empty, malformed UTF-8, multiline, and oversized load data", async () => {
    const invalidValues = [
      empty,
      Uint8Array.of(0xff),
      encoder.encode("one\ntwo\n"),
      new Uint8Array(16_387).fill(65),
    ]
    for (const stdout of invalidValues) {
      const store = createCredentialStore({
        platform: "linux",
        runner: new FakeRunner(() => ({ exitCode: 0, stdout })),
      })
      await expect(store.load()).rejects.toMatchObject({ code: "invalid_data" })
    }
  })

  test("rejects empty, multiline, and oversized tokens before spawning", async () => {
    for (const token of ["", "one\ntwo", "x".repeat(16_385)]) {
      const runner = new FakeRunner(() => result())
      const store = createCredentialStore({ platform: "linux", runner })
      await expect(store.save(token)).rejects.toMatchObject({
        code: "invalid_data",
      })
      expect(runner.requests).toHaveLength(0)
    }
  })

  test("passes a bounded timeout and output limit to every process", async () => {
    const runner = new FakeRunner(() => result(1))
    const store = createCredentialStore({
      platform: "linux",
      runner,
      timeoutMs: 123,
    })
    await store.load()
    await store.delete()
    expect(runner.requests.every((request) => request.timeoutMs === 123)).toBeTrue()
    expect(
      runner.requests.every((request) => request.maxStdoutBytes > 0),
    ).toBeTrue()
  })

  test("passes only necessary platform environment variables", async () => {
    const source = {
      HOME: "/home/test",
      USER: "tester",
      LOGNAME: "tester",
      XDG_RUNTIME_DIR: "/run/user/1",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1/bus",
      DISPLAY: ":0",
      WAYLAND_DISPLAY: "wayland-1",
      APPLE_MUSIC_USER_TOKEN: "must-not-leak",
      AWS_SECRET_ACCESS_KEY: "must-not-leak",
      PATH: "/untrusted/bin",
    }
    const linuxRunner = new FakeRunner(() => result(1))

    await createCredentialStore({
      platform: "linux",
      runner: linuxRunner,
      environment: source,
    }).load()

    expect(linuxRunner.requests[0]?.env).toEqual({
      HOME: "/home/test",
      XDG_RUNTIME_DIR: "/run/user/1",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1/bus",
      DISPLAY: ":0",
      WAYLAND_DISPLAY: "wayland-1",
    })
  })

  test("hard-bounds a runner that ignores cancellation", async () => {
    const runner = new FakeRunner(
      () => new Promise<ProcessResult>(() => undefined),
    )
    const store = createCredentialStore({
      platform: "linux",
      runner,
      timeoutMs: 10,
    })

    await expect(store.load()).rejects.toMatchObject({ code: "timeout" })
    expect(runner.requests[0]?.signal?.aborted).toBeTrue()
  })
})
