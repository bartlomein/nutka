import type { BoxRenderable, TextRenderable } from "@opentui/core"

import type { AppState } from "../../core/state"
import type {
  AppleCatalogPlaylist,
  AppleCatalogStation,
  AppleHomeSection,
  ApplePlaylist,
  AppleLibrarySection,
  AudioSpectrumFrame,
  Station,
  Track,
} from "../../core/types"
import type { AppleAuthStatus } from "../../services/apple-auth"
import type { PlayerPanel, PlayerPanelState } from "../player"
import type { VisualizerSettings } from "../visualizer"
import type { VisualizerSettingsDialog } from "../visualizer/settings-view"
import type { BrowsePage, RadioDisplayRow } from "./browse"
import type { CatalogSearchState } from "./catalog-search-controller"
import type { ContextPickerState, SearchAlbumView } from "./catalog-browse-controller"
import type { Command } from "./commands"
import type { InfoTarget } from "./copy"
import type { PlaylistView } from "./playlist-controller"
import type { LibraryPage } from "./library-controller"
import type { PaletteRow, TrackRow } from "./renderables"

interface LandingState {
  status: "idle" | "loading" | "loadingMore" | "ready" | "error"
  nextCursor: string | null
}

export interface AppViewModel {
  state: AppState
  appleAuthStatus: AppleAuthStatus
  authSuccessVisible: boolean
  baseTracks: readonly Track[]
  visibleTracks: readonly Track[]
  library?: {
    page: LibraryPage
    section: AppleLibrarySection
    nested: boolean
    statusLine: string
    emptyMessage: string
  }
  browsePage?: BrowsePage
  albumView?: SearchAlbumView
  playlistView?: PlaylistView
  homeSections: readonly AppleHomeSection[]
  favoriteStations: readonly AppleCatalogStation[]
  homeItems: readonly (AppleCatalogPlaylist | AppleCatalogStation)[]
  visibleHomeItems: readonly (AppleCatalogPlaylist | AppleCatalogStation)[]
  playlists: readonly ApplePlaylist[]
  visiblePlaylists: readonly ApplePlaylist[]
  landingState: LandingState
  radioRows: readonly RadioDisplayRow[]
  visibleStations: readonly Station[]
  favoriteStationIds: ReadonlySet<string>
  selectedStation?: AppleCatalogStation
  radioStatusLine: string
  radioHasMore: boolean
  radioFavoriteSaveError: boolean
  radioStationLikeError: boolean
  searchState: CatalogSearchState
  searchStatusLine: string
  contextPicker?: ContextPickerState
  infoTarget?: InfoTarget
  visualizerEnabled: boolean
  visualizerSettings: VisualizerSettings
  visualizerSettingsDialog?: VisualizerSettingsDialog
  player: PlayerPanelState
  currentSongLikeError: boolean
  paletteCommands: readonly Command[]
}

export interface AppView {
  render(model: AppViewModel): void
  resize(): void
  resetInfoScroll(): void
  scrollInfo(delta: number): void
  scrollInfoPage(delta: -1 | 1): void
  scrollInfoTo(edge: "start" | "end"): void
  renderAudioAnalysis(frame: AudioSpectrumFrame | null): void
  setVisualizerEnabled(enabled: boolean): void
  setVisualizerSettings(settings: VisualizerSettings): void
  destroy(): void
}

export interface AppRenderables {
  app: BoxRenderable
  header: BoxRenderable
  breadcrumb: TextRenderable
  providerStatus: TextRenderable
  workspace: BoxRenderable
  workspaceHeader: BoxRenderable
  workspaceTitle: TextRenderable
  workspaceCount: TextRenderable
  filterLine: TextRenderable
  tableHeader: TrackRow
  trackRows: readonly TrackRow[]
  player: PlayerPanel
  footer: BoxRenderable
  mode: TextRenderable
  keyHelp: TextRenderable
  destinationHint: TextRenderable
  paletteOverlay: BoxRenderable
  palettePopup: BoxRenderable
  paletteInput: TextRenderable
  paletteSummary: TextRenderable
  paletteRows: readonly PaletteRow[]
  contextOverlay: BoxRenderable
  contextPopup: BoxRenderable
  contextSummary: TextRenderable
  contextRows: readonly PaletteRow[]
  visualizerSettingsOverlay: BoxRenderable
  visualizerSettingsPopup: BoxRenderable
  visualizerSettingsSummary: TextRenderable
  visualizerSettingsRows: readonly PaletteRow[]
  visualizerSettingsPreview: TextRenderable
  helpOverlay: BoxRenderable
  helpPopup: BoxRenderable
  helpLines: readonly (readonly [string, string])[]
  helpTexts: readonly TextRenderable[]
  infoOverlay: BoxRenderable
  infoPopup: BoxRenderable
  infoBody: TextRenderable
  appleAuthOverlay: BoxRenderable
  appleAuthPopup: BoxRenderable
  authInstructions: readonly TextRenderable[]
}
