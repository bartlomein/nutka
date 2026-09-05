import type { KeyEvent } from "@opentui/core"

import type { Destination } from "../../core/state"
import type { AppleLibrarySection } from "../../core/types"

export interface NormalModeKeyHost {
  pendingKey(): string | null
  hasBrowsePage(): boolean
  beginGoto(): void
  closeMode(): void
  navigate(destination: Destination): void
  openNowPlayingContext(): void
  openPalette(): void
  popBrowsePage(): void
  openVisualizerSettings(): void
  moveBrowseSelection(delta: number): void
  openSelectedBrowseItem(): void
  loadMoreSelectedBrowseSection(): void
  openSelectedInfo(): void
  moveSelection(delta: number): void
  activateSelection(): void
  togglePlayback(): void
  playPrevious(): void
  toggleLike(): void
  toggleFavorite(): void
  cycleRepeat(): void
  playRandom(): void
  playNext(): void
  toggleVisualizer(): void
  seekBy(seconds: number): void
  openSearchOrFilter(): void
  openSelectedAlbum(): void
  loadMore(): void
  switchLibrarySection?(section: AppleLibrarySection): void
  refreshLibrary?(): void
  openHelp(): void
  escape(): void
  quit(): void
}

export class NormalModeKeyController {
  constructor(private readonly host: NormalModeKeyHost) {}

  handle(key: KeyEvent): void {
    if (this.host.pendingKey() === "g") {
      const target = gotoTarget(key)
      if (target === "now-playing") {
        this.host.closeMode()
        this.host.openNowPlayingContext()
      } else if (target) {
        this.host.navigate(target)
      } else {
        this.host.closeMode()
      }
      return
    }
    if (key.ctrl && (key.name === "p" || key.sequence === "p")) {
      this.host.openPalette()
      return
    }
    if (key.ctrl && (key.name === "o" || key.sequence === "o")) {
      this.host.popBrowsePage()
      return
    }
    if (isShiftKey(key, "v")) {
      this.host.openVisualizerSettings()
      return
    }
    if (this.host.hasBrowsePage()) {
      if (isPlainKey(key, "j") || key.name === "down") {
        this.host.moveBrowseSelection(1)
        return
      }
      if (isPlainKey(key, "k") || key.name === "up") {
        this.host.moveBrowseSelection(-1)
        return
      }
      if (key.name === "return" || key.name === "enter") {
        this.host.openSelectedBrowseItem()
        return
      }
      if (isPlainKey(key, "m")) {
        this.host.loadMoreSelectedBrowseSection()
        return
      }
      if (isPlainKey(key, "i") || isPlainKey(key, "/")) return
      if (key.name === "escape") {
        this.host.popBrowsePage()
        return
      }
    }
    if (isPlainKey(key, "1")) this.host.switchLibrarySection?.("songs")
    else if (isPlainKey(key, "2")) this.host.switchLibrarySection?.("albums")
    else if (isPlainKey(key, "3")) this.host.switchLibrarySection?.("artists")
    else if (isShiftKey(key, "r")) this.host.refreshLibrary?.()
    else if (isPlainKey(key, "i")) this.host.openSelectedInfo()
    else if (isPlainKey(key, "j") || key.name === "down") this.host.moveSelection(1)
    else if (isPlainKey(key, "k") || key.name === "up") this.host.moveSelection(-1)
    else if (key.name === "return" || key.name === "enter") this.host.activateSelection()
    else if (key.name === "space" || key.sequence === " ") this.host.togglePlayback()
    else if (isPlainKey(key, "b")) this.host.playPrevious()
    else if (isPlainKey(key, "l")) this.host.toggleLike()
    else if (isPlainKey(key, "f")) this.host.toggleFavorite()
    else if (isPlainKey(key, "r")) this.host.cycleRepeat()
    else if (isPlainKey(key, "s")) this.host.playRandom()
    else if (isPlainKey(key, "n")) this.host.playNext()
    else if (isPlainKey(key, "v")) this.host.toggleVisualizer()
    else if (
      !key.ctrl && !key.meta && !key.option &&
      (key.name === "left" || key.name === "right")
    ) {
      const delta = key.shift ? 15 : 5
      this.host.seekBy(key.name === "left" ? -delta : delta)
    } else if (isPlainKey(key, "/")) this.host.openSearchOrFilter()
    else if (isPlainKey(key, "a")) this.host.openSelectedAlbum()
    else if (isPlainKey(key, "m")) this.host.loadMore()
    else if (isPlainKey(key, "?")) this.host.openHelp()
    else if (isPlainKey(key, "g")) this.host.beginGoto()
    else if (key.name === "escape") this.host.escape()
    else if (isPlainKey(key, "q")) this.host.quit()
  }
}

function gotoTarget(key: KeyEvent): Destination | "now-playing" | null {
  if (key.ctrl || key.meta || key.option) return null
  switch (key.sequence) {
    case "n": return "now-playing"
    case "h": return "home"
    case "l": return "library"
    case "p": return "playlists"
    case "r": return "radio"
    case "s": return "search"
    case "q": return "queue"
    default: return null
  }
}

function isPlainKey(key: KeyEvent, value: string): boolean {
  return !key.ctrl && !key.meta && !key.option && !key.shift &&
    (key.name === value || key.sequence === value)
}

function isShiftKey(key: KeyEvent, value: string): boolean {
  return !key.ctrl && !key.meta && !key.option &&
    ((key.shift && (key.name === value || key.sequence.toLowerCase() === value)) ||
      key.sequence === value.toUpperCase())
}
