import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { randomBytes } from "node:crypto"
import { basename, dirname, isAbsolute, join } from "node:path"

const FILE_NAME = "apple-station-favorites.json"
const MAX_FILE_BYTES = 64 * 1024
const MAX_IDS = 25
const MAX_STOREFRONTS = 256

export interface FavoriteStationStore {
  load(storefront: string): readonly string[]
  set(storefront: string, id: string, favorite: boolean): void
}

export interface CreateFavoriteStationStoreOptions {
  path?: string
  environment?: NodeJS.ProcessEnv
}

export type FavoriteStationStoreErrorCode = "invalid_data" | "operation_failed"

export class FavoriteStationStoreError extends Error {
  constructor(readonly code: FavoriteStationStoreErrorCode) {
    super(
      code === "invalid_data"
        ? "Favorite station data is invalid"
        : "Favorite station storage operation failed",
    )
    this.name = "FavoriteStationStoreError"
  }
}

interface FavoriteDocument {
  version: 1
  storefronts: Record<string, string[]>
}

export function favoriteStationStorePath(
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (environment.NUTKA_FAVORITES_PATH) return environment.NUTKA_FAVORITES_PATH
  if (environment.XDG_DATA_HOME && isAbsolute(environment.XDG_DATA_HOME)) {
    return join(environment.XDG_DATA_HOME, "nutka", FILE_NAME)
  }
  if (environment.HOME && isAbsolute(environment.HOME)) {
    return join(environment.HOME, ".local", "share", "nutka", FILE_NAME)
  }
  return undefined
}

export function createFavoriteStationStore(
  options: CreateFavoriteStationStoreOptions = {},
): FavoriteStationStore {
  const path = options.path !== undefined
    ? options.path || undefined
    : favoriteStationStorePath(options.environment ?? process.env)

  return {
    load(storefront) {
      requireStorefront(storefront)
      if (!path) return []
      return [...readDocument(path).storefronts[storefront] ?? []]
    },

    set(storefront, id, favorite) {
      requireStorefront(storefront)
      requireResourceId(id)
      if (typeof favorite !== "boolean") invalid()
      if (!path) return

      const document = readDocument(path)
      const current = document.storefronts[storefront] ?? []
      const present = current.includes(id)
      if (present === favorite) return

      if (favorite) {
        if (current.length >= MAX_IDS) invalid()
        if (!(storefront in document.storefronts) &&
          Object.keys(document.storefronts).length >= MAX_STOREFRONTS) invalid()
        document.storefronts[storefront] = [...current, id]
      } else {
        const next = current.filter((value) => value !== id)
        if (next.length === 0) delete document.storefronts[storefront]
        else document.storefronts[storefront] = next
      }

      writeDocument(path, document)
    },
  }
}

function readDocument(path: string): FavoriteDocument {
  let bytes: Uint8Array
  try {
    const stat = statSync(path)
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) invalid()
    bytes = readFileSync(path)
  } catch (error) {
    if (error instanceof FavoriteStationStoreError) throw error
    if (isMissing(error)) return { version: 1, storefronts: {} }
    failed()
  }
  if (bytes!.byteLength > MAX_FILE_BYTES) invalid()

  let value: unknown
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes!))
  } catch {
    invalid()
  }
  if (!isPlainRecord(value) ||
    !hasExactKeys(value, ["version", "storefronts"]) ||
    value.version !== 1 ||
    !isPlainRecord(value.storefronts)) invalid()

  const entries = Object.entries(value.storefronts)
  if (entries.length > MAX_STOREFRONTS) invalid()
  for (const [storefront, ids] of entries) {
    if (!isStorefront(storefront) || !Array.isArray(ids) || ids.length > MAX_IDS) invalid()
    if (!ids.every(isResourceId) || new Set(ids).size !== ids.length) invalid()
  }
  return value as unknown as FavoriteDocument
}

function writeDocument(path: string, document: FavoriteDocument): void {
  const bytes = new TextEncoder().encode(`${JSON.stringify(document)}\n`)
  if (bytes.byteLength > MAX_FILE_BYTES) invalid()

  const parent = dirname(path)
  let temporary: string | undefined
  let descriptor: number | undefined
  try {
    mkdirSync(parent, { recursive: true, mode: 0o700 })
    temporary = join(
      parent,
      `.${basename(path)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
    )
    descriptor = openSync(temporary, "wx", 0o600)
    writeFileSync(descriptor, bytes)
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    chmodSync(temporary, 0o600)
    renameSync(temporary, path)
    temporary = undefined
    try {
      const parentDescriptor = openSync(parent, "r")
      try { fsyncSync(parentDescriptor) } finally { closeSync(parentDescriptor) }
    } catch {}
  } catch (error) {
    if (error instanceof FavoriteStationStoreError) throw error
    failed()
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor) } catch {}
    }
    if (temporary) {
      try { rmSync(temporary, { force: true }) } catch {}
    }
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every((key) => keys.includes(key))
}

function isStorefront(value: string): boolean {
  return /^[a-z]{2}$/.test(value)
}

function isResourceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(value)
}

function requireStorefront(value: string): void {
  if (!isStorefront(value)) invalid()
}

function requireResourceId(value: string): void {
  if (!isResourceId(value)) invalid()
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === "ENOENT"
}

function invalid(): never {
  throw new FavoriteStationStoreError("invalid_data")
}

function failed(): never {
  throw new FavoriteStationStoreError("operation_failed")
}
