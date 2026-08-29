import type { KeyEvent } from "@opentui/core"

import type { AppAction, AppState, Destination } from "../../core/state"
import type { AppleAuthStatus } from "../../services/apple-auth"
import type { VisualizerSettings } from "../visualizer"
import {
  cycleVisualizerSettings,
  visualizerSettingCount,
  type VisualizerSettingsDialog,
} from "../visualizer/settings-view"
import { getPaletteCommands, type Command } from "./commands"
import { isAppleAuthProgress, type InfoTarget } from "./copy"
import { NormalModeKeyController } from "./normal-mode-keys"

export interface AppInteractionSnapshot {
  readonly authSuccessVisible: boolean
  readonly infoTarget?: InfoTarget
  readonly visualizerEnabled: boolean
  readonly visualizerSettings: VisualizerSettings
  readonly visualizerSettingsDialog?: VisualizerSettingsDialog
}

export interface AppInteractionHost {
  getState(): AppState
  getAppleAuthStatus(): AppleAuthStatus
  hasAppleAuth(): boolean
  hasBrowsePage(): boolean
  hasContextPicker(): boolean
  selectedInfoTarget(): InfoTarget | undefined
  visibleItemIds(): readonly string[]
  filteredItemIds(draft: string): readonly string[]
  canOpenAlbum(): boolean
  canOpenInfo(): boolean
  canBrowseNowPlaying(): boolean
  canStartSongStation(): boolean
  canSetShuffleMode(): boolean
  canSetRepeatMode(): boolean
  canToggleCurrentSongLike(): boolean
  canToggleSelectedStationFavorite(): boolean
  canToggleSelectedStationLike(): boolean
  applyState(action: AppAction): void
  dispatch(action: AppAction): void
  render(): void
  navigate(destination: Destination): void
  touchRadioSelection(): void
  submitRadioSearch(query: string): void
  submitCatalogSearch(query: string): void
  moveContextSelection(delta: number): void
  closeContextPicker(): void
  chooseContextTarget(): void
  openNowPlayingContext(): void
  popBrowsePage(): void
  moveBrowseSelection(delta: number): void
  openSelectedBrowseItem(): void
  loadMoreSelectedBrowseSection(): void
  moveSelection(delta: number): void
  activateSelection(): void
  togglePlayback(): void
  playPrevious(): void
  toggleCurrentSongLike(): void
  toggleSelectedStationFavorite(): void
  toggleSelectedStationLike(): void
  cycleRepeatMode(): void
  toggleShuffleMode(): void
  playRandom(): void
  playNext(): void
  seekBy(seconds: number): void
  openSearchOrFilter(): void
  openSelectedAlbum(): void
  loadMore(): void
  escapeNormalMode(): void
  startCurrentSongStation(): void
  signIn(): void
  signOut(): void
  cancelSignIn(): void
  restoreSignIn(): void
  quit(): void
  resetInfoScroll(): void
  scrollInfo(delta: number): void
  scrollInfoPage(delta: -1 | 1): void
  scrollInfoTo(edge: "start" | "end"): void
  setVisualizerEnabled(enabled: boolean): void
  setAudioAnalysisEnabled(enabled: boolean): void
  setVisualizerSettings(settings: VisualizerSettings): void
  saveVisualizerSettings(settings: VisualizerSettings): void
  resize(): void
}

export class AppInteractionController {
  private authSuccessVisible = false
  private infoTarget: InfoTarget | undefined
  private visualizerEnabled = true
  private visualizerSettingsDialog: VisualizerSettingsDialog | undefined
  private readonly normalKeys: NormalModeKeyController

  constructor(
    private readonly host: AppInteractionHost,
    private visualizerSettings: VisualizerSettings,
  ) {
    this.normalKeys = new NormalModeKeyController({
      pendingKey: () => {
        const mode = this.host.getState().mode
        return mode.type === "normal" ? mode.pendingKey : null
      },
      hasBrowsePage: () => this.host.hasBrowsePage(),
      beginGoto: () => this.host.dispatch({ type: "begin-goto" }),
      closeMode: () => this.host.dispatch({ type: "close-mode" }),
      navigate: (destination) => this.host.navigate(destination),
      openNowPlayingContext: () => this.host.openNowPlayingContext(),
      openPalette: () => this.host.dispatch({ type: "open-palette" }),
      popBrowsePage: () => this.host.popBrowsePage(),
      openVisualizerSettings: () => this.openVisualizerSettings(),
      moveBrowseSelection: (delta) => this.host.moveBrowseSelection(delta),
      openSelectedBrowseItem: () => this.host.openSelectedBrowseItem(),
      loadMoreSelectedBrowseSection: () => this.host.loadMoreSelectedBrowseSection(),
      openSelectedInfo: () => this.openSelectedInfo(),
      moveSelection: (delta) => this.host.moveSelection(delta),
      activateSelection: () => this.host.activateSelection(),
      togglePlayback: () => this.host.togglePlayback(),
      playPrevious: () => this.host.playPrevious(),
      toggleLike: () => this.host.toggleCurrentSongLike(),
      toggleFavorite: () => this.host.toggleSelectedStationFavorite(),
      cycleRepeat: () => this.host.cycleRepeatMode(),
      playRandom: () => this.host.playRandom(),
      playNext: () => this.host.playNext(),
      toggleVisualizer: () => this.toggleVisualizer(),
      seekBy: (seconds) => this.host.seekBy(seconds),
      openSearchOrFilter: () => this.host.openSearchOrFilter(),
      openSelectedAlbum: () => this.host.openSelectedAlbum(),
      loadMore: () => this.host.loadMore(),
      openHelp: () => this.host.dispatch({ type: "open-help" }),
      escape: () => this.host.escapeNormalMode(),
      quit: () => this.host.quit(),
    })
  }

  snapshot(): AppInteractionSnapshot {
    return {
      authSuccessVisible: this.authSuccessVisible,
      ...(this.infoTarget ? { infoTarget: this.infoTarget } : {}),
      visualizerEnabled: this.visualizerEnabled,
      visualizerSettings: this.visualizerSettings,
      ...(this.visualizerSettingsDialog
        ? { visualizerSettingsDialog: this.visualizerSettingsDialog }
        : {}),
    }
  }

  paletteCommands(query = this.paletteQuery()): readonly Command[] {
    return getPaletteCommands(query, {
      appleAuthStatus: this.host.getAppleAuthStatus(),
      canAppleAuth: this.host.hasAppleAuth(),
      canOpenAlbum: this.host.canOpenAlbum(),
      canOpenInfo: this.host.canOpenInfo(),
      canBrowseNowPlaying: this.host.canBrowseNowPlaying(),
      canStartSongStation: this.host.canStartSongStation(),
      canFilter: !this.host.hasBrowsePage(),
      canSetShuffleMode: this.host.canSetShuffleMode(),
      canSetRepeatMode: this.host.canSetRepeatMode(),
      canToggleCurrentSongLike: this.host.canToggleCurrentSongLike(),
      canToggleSelectedStationFavorite: this.host.canToggleSelectedStationFavorite(),
      canToggleSelectedStationLike: this.host.canToggleSelectedStationLike(),
    })
  }

  authenticationChanged(previous: AppleAuthStatus, next: AppleAuthStatus): void {
    this.authSuccessVisible = next.state === "signedIn" &&
      ["authorizing", "validating", "saving"].includes(previous.state)
  }

  resetForAuthenticationChange(): void {
    this.infoTarget = undefined
    this.host.resetInfoScroll()
  }

  handleKey(key: KeyEvent): void {
    if (key.eventType === "release") return
    if (this.authSuccessVisible) {
      if (key.name === "escape" || key.name === "return" || key.name === "enter") {
        this.authSuccessVisible = false
        this.host.render()
      }
      return
    }
    if (isAppleAuthProgress(this.host.getAppleAuthStatus())) {
      if (key.name === "escape") this.host.cancelSignIn()
      return
    }
    if (this.visualizerSettingsDialog) return this.handleVisualizerSettingsKey(key)
    if (this.host.hasContextPicker()) return this.handleContextPickerKey(key)
    if (this.infoTarget) return this.handleInfoKey(key)

    const mode = this.host.getState().mode
    if (mode.type === "palette") return this.handlePaletteKey(key)
    if (mode.type === "search") return this.handleSearchKey(key)
    if (mode.type === "filter") return this.handleFilterKey(key)
    if (mode.type === "help") return this.handleHelpKey(key)
    this.normalKeys.handle(key)
  }

  executeCommand(command: Command | undefined): void {
    if (!command) return
    switch (command.id) {
      case "home":
      case "library":
      case "playlists":
      case "radio":
      case "search":
      case "queue":
        this.host.navigate(command.id)
        return
      case "filter":
        this.host.dispatch({ type: "open-filter" })
        return
      case "favorite-station":
        this.closeModeWithoutRender()
        this.host.toggleSelectedStationFavorite()
        return
      case "like-station":
        this.closeModeWithoutRender()
        this.host.toggleSelectedStationLike()
        return
      case "info":
        this.closeModeWithoutRender()
        this.openSelectedInfo()
        return
      case "album":
        this.host.openSelectedAlbum()
        return
      case "browse-now-playing":
        this.host.openNowPlayingContext()
        return
      case "station-from-song":
        this.closeModeWithoutRender()
        this.host.startCurrentSongStation()
        return
      case "apple-sign-in":
        this.host.dispatch({ type: "close-mode" })
        this.host.signIn()
        return
      case "apple-sign-out":
      case "apple-cleanup":
        this.host.dispatch({ type: "close-mode" })
        this.host.signOut()
        return
      case "apple-retry-restore":
        this.host.dispatch({ type: "close-mode" })
        this.host.restoreSignIn()
        return
      case "shuffle":
        this.closeModeWithoutRender()
        this.host.toggleShuffleMode()
        return
      case "repeat":
        this.closeModeWithoutRender()
        this.host.cycleRepeatMode()
        return
      case "like":
        this.closeModeWithoutRender()
        this.host.toggleCurrentSongLike()
        return
      case "visualizer":
        this.closeModeWithoutRender()
        this.toggleVisualizer()
        return
      case "visualizer-settings":
        this.closeModeWithoutRender()
        this.openVisualizerSettings()
        return
      case "help":
        this.host.dispatch({ type: "open-help" })
        return
      case "quit":
        this.host.dispatch({ type: "close-mode" })
        this.host.quit()
    }
  }

  private paletteQuery(): string {
    const mode = this.host.getState().mode
    return mode.type === "palette" ? mode.query : ""
  }

  private closeModeWithoutRender(): void {
    this.host.applyState({ type: "close-mode" })
  }

  private openSelectedInfo(): void {
    const target = this.host.selectedInfoTarget()
    if (!target) return
    this.infoTarget = target
    this.host.resetInfoScroll()
    this.host.render()
  }

  private closeInfo(): void {
    if (!this.infoTarget) return
    this.infoTarget = undefined
    this.host.resetInfoScroll()
    this.host.render()
  }

  private handleFilterKey(key: KeyEvent): void {
    const state = this.host.getState()
    if (state.mode.type !== "filter") return
    const visibleItemIds = this.host.visibleItemIds()

    if (key.name === "escape") return this.host.dispatch({ type: "cancel-filter" })
    if (key.name === "return" || key.name === "enter") {
      return this.host.dispatch({ type: "submit-filter" })
    }
    if (key.name === "backspace") return this.editFilter(state.mode.draft.slice(0, -1))
    if (key.name === "down" || (key.ctrl && (key.name === "n" || key.sequence === "n"))) {
      this.moveFilteredSelection(1, visibleItemIds)
      return
    }
    if (key.name === "up" || (key.ctrl && (key.name === "p" || key.sequence === "p"))) {
      this.moveFilteredSelection(-1, visibleItemIds)
      return
    }
    if (isPrintable(key)) this.editFilter(state.mode.draft + key.sequence)
  }

  private editFilter(draft: string): void {
    this.host.dispatch({
      type: "edit-filter",
      draft,
      visibleTrackIds: this.host.filteredItemIds(draft),
    })
  }

  private moveFilteredSelection(delta: number, visibleItemIds: readonly string[]): void {
    if (this.host.getState().destination === "radio" && visibleItemIds.length > 0) {
      this.host.touchRadioSelection()
    }
    this.host.dispatch({ type: "move-selection", delta, visibleTrackIds: visibleItemIds })
  }

  private handleSearchKey(key: KeyEvent): void {
    const state = this.host.getState()
    if (state.mode.type !== "search") return
    if (key.name === "escape") return this.host.dispatch({ type: "close-mode" })
    if (key.name === "return" || key.name === "enter") {
      if (state.destination === "radio") this.host.submitRadioSearch(state.mode.draft)
      else this.host.submitCatalogSearch(state.mode.draft)
      return
    }
    if (key.name === "backspace") {
      this.host.dispatch({ type: "edit-search", draft: state.mode.draft.slice(0, -1) })
      return
    }
    if (isPrintable(key)) {
      this.host.dispatch({ type: "edit-search", draft: state.mode.draft + key.sequence })
    }
  }

  private handlePaletteKey(key: KeyEvent): void {
    const state = this.host.getState()
    if (state.mode.type !== "palette") return
    const commands = this.paletteCommands(state.mode.query)

    if (key.name === "escape") return this.host.dispatch({ type: "close-mode" })
    if (key.name === "return" || key.name === "enter") {
      this.executeCommand(commands[state.mode.selectedIndex])
      return
    }
    if (key.name === "backspace") {
      this.host.dispatch({ type: "edit-palette", query: state.mode.query.slice(0, -1) })
      return
    }
    if (key.name === "down" || (key.ctrl && (key.name === "n" || key.sequence === "n"))) {
      this.host.dispatch({ type: "move-palette", delta: 1, itemCount: commands.length })
      return
    }
    if (key.name === "up" || (key.ctrl && (key.name === "p" || key.sequence === "p"))) {
      this.host.dispatch({ type: "move-palette", delta: -1, itemCount: commands.length })
      return
    }
    if (isPrintable(key)) {
      this.host.dispatch({ type: "edit-palette", query: state.mode.query + key.sequence })
    }
  }

  private handleInfoKey(key: KeyEvent): void {
    if (key.name === "escape" || isPlainKey(key, "i")) return this.closeInfo()
    if (isPlainKey(key, "j") || key.name === "down") return this.host.scrollInfo(1)
    if (isPlainKey(key, "k") || key.name === "up") return this.host.scrollInfo(-1)
    if (key.name === "pagedown") return this.host.scrollInfoPage(1)
    if (key.name === "pageup") return this.host.scrollInfoPage(-1)
    if (key.name === "home") return this.host.scrollInfoTo("start")
    if (key.name === "end") this.host.scrollInfoTo("end")
  }

  private handleContextPickerKey(key: KeyEvent): void {
    if (key.name === "escape" || (key.ctrl && (key.name === "o" || key.sequence === "o"))) {
      this.host.closeContextPicker()
      return
    }
    if (key.name === "return" || key.name === "enter") return this.host.chooseContextTarget()
    if (isPlainKey(key, "j") || key.name === "down") {
      this.host.moveContextSelection(1)
      return
    }
    if (isPlainKey(key, "k") || key.name === "up") this.host.moveContextSelection(-1)
  }

  private handleHelpKey(key: KeyEvent): void {
    if (key.ctrl && (key.name === "p" || key.sequence === "p")) {
      this.host.dispatch({ type: "open-palette" })
    } else if (
      key.name === "escape" || key.name === "return" || key.name === "enter" ||
      key.name === "?"
    ) {
      this.host.dispatch({ type: "close-mode" })
    }
  }

  private toggleVisualizer(): void {
    this.visualizerEnabled = !this.visualizerEnabled
    this.host.setVisualizerEnabled(this.visualizerEnabled)
    this.host.setAudioAnalysisEnabled(this.visualizerEnabled)
    this.host.resize()
    this.host.render()
  }

  private openVisualizerSettings(): void {
    this.host.applyState({ type: "close-mode" })
    this.visualizerSettingsDialog = {
      original: { ...this.visualizerSettings },
      draft: { ...this.visualizerSettings },
      selectedIndex: 0,
    }
    this.host.render()
  }

  private handleVisualizerSettingsKey(key: KeyEvent): void {
    const dialog = this.visualizerSettingsDialog
    if (!dialog) return
    if (key.name === "escape") return this.closeVisualizerSettings(false)
    if (key.name === "return" || key.name === "enter") {
      return this.closeVisualizerSettings(true)
    }
    if (isPlainKey(key, "j") || key.name === "down") {
      dialog.selectedIndex = Math.min(visualizerSettingCount - 1, dialog.selectedIndex + 1)
      this.host.render()
      return
    }
    if (isPlainKey(key, "k") || key.name === "up") {
      dialog.selectedIndex = Math.max(0, dialog.selectedIndex - 1)
      this.host.render()
      return
    }
    if (key.name === "left" || key.name === "right") {
      this.cycleVisualizerSetting(key.name === "left" ? -1 : 1)
    }
  }

  private closeVisualizerSettings(apply: boolean): void {
    const dialog = this.visualizerSettingsDialog
    if (!dialog) return
    if (!apply) {
      this.host.setVisualizerSettings(dialog.original)
      this.visualizerSettingsDialog = undefined
      this.host.resize()
      this.host.render()
      return
    }
    try {
      this.host.saveVisualizerSettings(dialog.draft)
      this.visualizerSettings = { ...dialog.draft }
      this.visualizerSettingsDialog = undefined
      this.host.resize()
      this.host.render()
    } catch {
      dialog.error = "Could not save visualizer settings"
      this.host.render()
    }
  }

  private cycleVisualizerSetting(delta: number): void {
    const dialog = this.visualizerSettingsDialog
    if (!dialog) return
    const draft = cycleVisualizerSettings(dialog.draft, dialog.selectedIndex, delta)
    if (!draft) return
    dialog.draft = draft
    dialog.error = undefined
    this.host.setVisualizerSettings(draft)
    this.host.resize()
    this.host.render()
  }
}

function isPrintable(key: KeyEvent): boolean {
  return key.sequence.length === 1 && !key.ctrl && !key.meta && key.sequence >= " "
}

function isPlainKey(key: KeyEvent, name: string): boolean {
  return !key.ctrl && !key.meta && !key.shift &&
    (key.name === name || key.sequence === name)
}
