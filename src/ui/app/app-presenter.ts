import type { CliRenderer } from "@opentui/core"

import { appleStationResourceId, browseFooterHelp } from "./browse"
import {
  albumFooterHelp,
  footerHelp,
  homeFooterHelp,
  isAppleAuthProgress,
  playlistDetailFooterHelp,
  playlistFooterHelp,
  radioFooterHelp,
  searchFooterHelp,
} from "./copy"
import { renderOverlays } from "./overlay-presenter"
import type { AppRenderables, AppView, AppViewModel } from "./view-contracts"
import { renderWorkspace } from "./workspace-presenter"

export type { AppRenderables, AppView, AppViewModel } from "./view-contracts"

export function createAppPresenter(
  renderer: CliRenderer,
  view: AppRenderables,
): AppView {
  function render(model: AppViewModel): void {
    const {
      state,
      appleAuthStatus,
      authSuccessVisible,
      browsePage: activeBrowsePage,
      albumView: activeAlbumView,
      playlistView: activePlaylistView,
      contextPicker,
      infoTarget,
      visualizerSettingsDialog,
    } = model
    const homeLanding = !activeBrowsePage && state.destination === "home" && !activePlaylistView
    const playlistLanding = !activeBrowsePage && state.destination === "playlists" && !activePlaylistView
    const radioLanding = !activeBrowsePage && state.destination === "radio"
    const showingAlbum = activeAlbumView !== undefined
    const showingPlaylist = activePlaylistView !== undefined
    const landingState = model.landingState

    renderWorkspace(renderer, view, model)
    view.player.render(model.player)

    renderOverlays(renderer, view, model)

    view.mode.content = visualizerSettingsDialog
      ? "VISUAL"
      : contextPicker
      ? "CONTEXT"
      : infoTarget
      ? "INFO"
      : state.mode.type === "normal" && state.mode.pendingKey === "g"
        ? "GO TO"
        : state.mode.type.toUpperCase()
    view.keyHelp.content = authSuccessVisible
      ? renderer.terminalWidth < 64
        ? "connected  enter continue"
        : "Apple Music connected   enter continue"
      : isAppleAuthProgress(appleAuthStatus)
      ? renderer.terminalWidth < 64
        ? "apple login  esc cancel"
        : "Apple Music authorization in progress   esc cancel"
      : visualizerSettingsDialog
        ? renderer.terminalWidth < 64
          ? "j/k select  ←/→ change  enter apply"
          : "Visualizer settings   j/k select   ←/→ change   enter apply   esc cancel"
      : contextPicker
        ? renderer.terminalWidth < 64
          ? "j/k choose  enter open  esc cancel"
          : "Now playing context   j/k or ↑/↓ choose   enter open   esc cancel"
      : infoTarget
        ? renderer.terminalWidth < 64
          ? "j/k scroll  i/esc close"
          : "Item information   j/k or ↑/↓ scroll   i/esc close"
      : state.mode.type === "normal" && model.currentSongLikeError
        ? "Could not update favorite   l retry"
      : state.mode.type === "normal" && model.radioFavoriteSaveError
        ? "Could not update station favorite   f retry"
      : state.mode.type === "normal" && model.radioStationLikeError
        ? "Could not update Apple station like   ctrl+p retry"
      : activeBrowsePage && state.mode.type === "normal"
        ? browseFooterHelp(activeBrowsePage, renderer.terminalWidth)
      : model.library && state.mode.type === "normal"
        ? renderer.terminalWidth < 50
          ? "1/2/3 views  m retry  ? help"
        : renderer.terminalWidth < 100
          ? "1 songs 2 albums 3 artists  / filter  m retry"
          : "1 songs 2 albums 3 artists  enter open/play  / filter  m retry  R refresh  esc back"
      : showingPlaylist && state.mode.type === "normal"
        ? playlistDetailFooterHelp(activePlaylistView?.nextCursor !== null, renderer.terminalWidth)
      : homeLanding && state.mode.type === "normal"
        ? homeFooterHelp(
            landingState.nextCursor !== null,
            Boolean(model.selectedStation),
            Boolean(
              appleStationResourceId(model.selectedStation) &&
              model.favoriteStationIds.has(appleStationResourceId(model.selectedStation) ?? ""),
            ),
            model.selectedStation?.apple.externalLiveStream === true,
            renderer.terminalWidth,
          )
      : playlistLanding && state.mode.type === "normal"
        ? playlistFooterHelp(landingState.nextCursor !== null, renderer.terminalWidth, state.destination)
      : showingAlbum && state.mode.type === "normal"
        ? albumFooterHelp(renderer.terminalWidth)
      : radioLanding && state.mode.type === "normal"
        ? radioFooterHelp(
            model.radioHasMore,
            Boolean(model.selectedStation),
            Boolean(
              appleStationResourceId(model.selectedStation) &&
              model.favoriteStationIds.has(appleStationResourceId(model.selectedStation) ?? ""),
            ),
            model.selectedStation?.apple.externalLiveStream === true,
            renderer.terminalWidth,
          )
      : state.destination === "search" && state.mode.type === "normal"
        ? searchFooterHelp(model.searchState.nextCursor !== null, renderer.terminalWidth)
        : footerHelp(state, renderer.terminalWidth)
  }

  function resize(): void {
    const width = renderer.terminalWidth
    const compactHeight = renderer.terminalHeight < 21
    const compactAuth = renderer.terminalHeight < 14
    const showRail = !compactHeight && width >= 120
    const showQueueRail = showRail && width >= 120
    view.header.height = compactHeight ? 2 : 3
    view.header.paddingX = compactHeight ? 1 : 2
    view.workspace.padding = compactHeight ? 0 : 1
    view.workspaceHeader.height = compactHeight ? 1 : 2
    view.footer.height = compactHeight ? 2 : 3
    view.footer.paddingX = compactHeight ? 1 : 2
    view.providerStatus.visible = width >= 40
    view.destinationHint.visible = width >= 100
    view.rail.visible = showRail
    view.rail.width = showQueueRail ? 32 : 24
    view.navigationPanel.visible = showRail
    view.queuePanel.visible = showQueueRail
    const mainColumnWidth = showRail
      ? Math.max(40, width - (showQueueRail ? 32 : 24) - 2)
      : width
    view.player.applyResponsiveLayout(mainColumnWidth, compactHeight)
    view.palettePopup.width = width >= 80 ? 72 : "94%"
    view.contextPopup.width = width >= 80 ? 72 : "94%"
    view.visualizerSettingsPopup.width = width >= 72 ? 64 : "94%"
    view.visualizerSettingsPopup.paddingY = renderer.terminalHeight >= 9 ? 1 : 0
    const visualizerValueWidth = Math.max(4, Math.min(22, Math.floor((width - 8) / 2)))
    for (const row of view.visualizerSettingsRows) row.shortcut.width = visualizerValueWidth
    view.helpPopup.width = width >= 80 ? 72 : "94%"
    view.infoPopup.width = width >= 90 ? 80 : "94%"
    view.infoPopup.height = Math.max(7, Math.min(22, renderer.terminalHeight - 1))
    view.appleAuthPopup.width = width >= 72 ? 64 : "94%"
    view.appleAuthPopup.height = compactAuth ? Math.max(7, renderer.terminalHeight - 1) : 12
    view.authInstructions[0]!.height = compactAuth ? 1 : 2
    view.authInstructions[2]!.height = compactAuth ? 1 : 2

    for (const row of [view.tableHeader, ...view.trackRows]) {
      if (width < 64) {
        row.title.flexGrow = 1
        row.title.width = "auto"
        row.artist.visible = false
        row.album.visible = false
      } else if (width < 100) {
        row.title.flexGrow = 0
        row.title.width = "44%"
        row.artist.visible = true
        row.artist.flexGrow = 1
        row.artist.width = "auto"
        row.album.visible = false
      } else {
        row.title.flexGrow = 0
        row.title.width = "32%"
        row.artist.visible = true
        row.artist.flexGrow = 0
        row.artist.width = "24%"
        row.album.visible = true
        row.album.flexGrow = 1
      }
    }
  }

  return {
    render,
    resize,
    resetInfoScroll: () => {
      view.infoBody.scrollY = 0
    },
    scrollInfo: (delta) => {
      view.infoBody.scrollY = Math.max(
        0,
        Math.min(view.infoBody.maxScrollY, view.infoBody.scrollY + delta),
      )
    },
    scrollInfoPage: (delta) => {
      const pageSize = Math.max(1, Math.min(12, renderer.terminalHeight - 8))
      view.infoBody.scrollY = Math.max(
        0,
        Math.min(view.infoBody.maxScrollY, view.infoBody.scrollY + delta * pageSize),
      )
    },
    scrollInfoTo: (edge) => {
      view.infoBody.scrollY = edge === "start" ? 0 : view.infoBody.maxScrollY
    },
    renderAudioAnalysis: (frame) => view.player.renderAudioAnalysis(frame),
    setVisualizerEnabled: (enabled) => view.player.setVisualizerEnabled(enabled),
    setVisualizerSettings: (settings) => view.player.setVisualizerSettings(settings),
    destroy: () => view.app.destroyRecursively(),
  }
}
