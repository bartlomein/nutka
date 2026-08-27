import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import {
  defaultVisualizerSettings,
  loadVisualizerSettings,
  saveVisualizerSettings,
  visualizerConfigPath,
} from "./preferences"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(
    (directory) => rm(directory, { recursive: true, force: true }),
  ))
})

describe("visualizer preferences", () => {
  test("loads defaults and resolves the XDG configuration path", async () => {
    const configHome = await mkdtemp(join(tmpdir(), "nutka-config-test-"))
    directories.push(configHome)
    const environment = { XDG_CONFIG_HOME: configHome }

    expect(visualizerConfigPath(environment)).toBe(join(configHome, "nutka", "config.toml"))
    expect(loadVisualizerSettings(environment)).toEqual(defaultVisualizerSettings)
  })

  test("saves preferences atomically while preserving other configuration", async () => {
    const configHome = await mkdtemp(join(tmpdir(), "nutka-config-test-"))
    directories.push(configHome)
    const environment = { XDG_CONFIG_HOME: configHome }
    const path = join(configHome, "nutka", "config.toml")
    await mkdir(join(configHome, "nutka"))
    await writeFile(path, '# keep this comment\n[account]\nstorefront = "us"\n')

    saveVisualizerSettings({
      kind: "spectrum",
      style: "wide",
      palette: "cool",
      height: 4,
    }, environment)

    expect(loadVisualizerSettings(environment)).toEqual({
      kind: "spectrum",
      style: "wide",
      palette: "cool",
      height: 4,
    })
    const saved = await readFile(path, "utf8")
    expect(saved).toContain("# keep this comment")
    expect(saved).toContain("storefront = \"us\"")
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  test("does not change permissions on a custom path parent", async () => {
    const root = await mkdtemp(join(tmpdir(), "nutka-config-test-"))
    directories.push(root)
    const parent = join(root, "shared")
    await mkdir(parent)
    await chmod(parent, 0o755)

    saveVisualizerSettings(defaultVisualizerSettings, {
      NUTKA_CONFIG_PATH: join(parent, "nutka.toml"),
    })

    expect((await stat(parent)).mode & 0o777).toBe(0o755)
  })

  test("falls back field by field for invalid preferences", async () => {
    const configHome = await mkdtemp(join(tmpdir(), "nutka-config-test-"))
    directories.push(configHome)
    const path = join(configHome, "nutka", "config.toml")
    await mkdir(join(configHome, "nutka"))
    await writeFile(path, `
      [visualizer]
      kind = "unknown"
      style = "spaced"
      palette = "nope"
      height = "4"
    `)

    expect(loadVisualizerSettings({ XDG_CONFIG_HOME: configHome })).toEqual({
      ...defaultVisualizerSettings,
      style: "spaced",
    })
  })

  test("does not corrupt alternate TOML representations of visualizer settings", async () => {
    const configHome = await mkdtemp(join(tmpdir(), "nutka-config-test-"))
    directories.push(configHome)
    const path = join(configHome, "nutka", "config.toml")
    await mkdir(join(configHome, "nutka"))
    const source = 'visualizer.style = "dense"\n'
    await writeFile(path, source)

    expect(() => saveVisualizerSettings(defaultVisualizerSettings, {
      XDG_CONFIG_HOME: configHome,
    })).toThrow("must use a [visualizer] table")
    expect(await readFile(path, "utf8")).toBe(source)
  })
})
