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

describe("macOS credential store", () => {
  test("loads and decodes base64url with fixed service and account", async () => {
    const runner = new FakeRunner(() => result(0, "dXNlci10b2tlbg\n"))
    const store = createCredentialStore({ platform: "darwin", runner })

    expect(await store.load()).toBe("user-token")
    expect(runner.requests[0]?.args).toEqual([
      "find-generic-password",
      "-s",
      "dev.nutka.cli",
      "-a",
      "apple-music-user-token.v1",
      "-w",
    ])
    expect(runner.requests[0]?.executable).toBe("/usr/bin/security")
  })

  test("migrates a legacy Nuta keychain item through encoded stdin", async () => {
    const runner = new FakeRunner((request) => {
      if (request.args[0] === "find-generic-password") {
        return request.args.includes("dev.nutka.cli")
          ? result(44)
          : result(0, "bGVnYWN5LXRva2Vu\n")
      }
      return result()
    })
    const store = createCredentialStore({ platform: "darwin", runner })

    expect(await store.load()).toBe("legacy-token")
    expect(runner.requests[0]?.args).toContain("dev.nutka.cli")
    expect(runner.requests[1]?.args).toContain("dev.nuta.cli")
    expect(runner.requests[2]?.args).toEqual(["-q", "-i"])
    expect(stdin(runner.requests[2]!)).toContain(
      "-s dev.nutka.cli -a apple-music-user-token.v1 -w bGVnYWN5LXRva2Vu",
    )
    expect(runner.requests[3]?.args).toContain("dev.nuta.cli")
    expect(runner.requests.flatMap(({ args }) => args)).not.toContain("legacy-token")
  })

  test("saves through quiet interactive stdin with no secret in argv", async () => {
    const token = "sensitive token"
    const runner = new FakeRunner(() => result())
    const store = createCredentialStore({ platform: "darwin", runner })

    await store.save(token)

    expect(runner.requests[0]?.args).toEqual(["-q", "-i"])
    expect(runner.requests[0]?.args.join(" ")).not.toContain(token)
    expect(stdin(runner.requests[0]!)).toBe(
      "add-generic-password -U -s dev.nutka.cli -a apple-music-user-token.v1 -w c2Vuc2l0aXZlIHRva2Vu\n",
    )
    expect(stdin(runner.requests[0]!)).not.toContain(token)
  })

  test("returns null for security's item-not-found status", async () => {
    const store = createCredentialStore({
      platform: "darwin",
      runner: new FakeRunner(() => result(44)),
    })
    expect(await store.load()).toBeNull()
  })

  test("deletes fixed item and treats item-not-found as success", async () => {
    const runner = new FakeRunner(() => result(44))
    const store = createCredentialStore({ platform: "darwin", runner })
    await expect(store.delete()).resolves.toBeUndefined()
    expect(runner.requests[0]?.args).toEqual([
      "delete-generic-password",
      "-s",
      "dev.nutka.cli",
      "-a",
      "apple-music-user-token.v1",
    ])
  })

  test("rejects padded, malformed, and non-canonical base64url", async () => {
    for (const value of ["dG9rZW4=\n", "not valid\n", "AB\n"]) {
      const store = createCredentialStore({
        platform: "darwin",
        runner: new FakeRunner(() => result(0, value)),
      })
      await expect(store.load()).rejects.toMatchObject({ code: "invalid_data" })
    }
  })
})

describe("credential store failures", () => {
  test("rejects unsupported platforms with a typed sanitized error", () => {
    expect(() =>
      createCredentialStore({ platform: "win32" }),
    ).toThrow(CredentialStoreError)
    try {
      createCredentialStore({ platform: "win32" })
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
    const macRunner = new FakeRunner(() => result(44))

    await createCredentialStore({
      platform: "linux",
      runner: linuxRunner,
      environment: source,
    }).load()
    await createCredentialStore({
      platform: "darwin",
      runner: macRunner,
      environment: source,
    }).load()

    expect(linuxRunner.requests[0]?.env).toEqual({
      HOME: "/home/test",
      XDG_RUNTIME_DIR: "/run/user/1",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1/bus",
      DISPLAY: ":0",
      WAYLAND_DISPLAY: "wayland-1",
    })
    expect(macRunner.requests[0]?.env).toEqual({
      HOME: "/home/test",
      USER: "tester",
      LOGNAME: "tester",
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
