import type { CliRenderer } from "@opentui/core"

import { theme } from "../theme"
import { resolveVisualizerPalette } from "../visualizer/palettes"
import { visualizerPreviewBands, visualizerSettingRows } from "../visualizer/settings-view"
import { formatSpectrumFrame } from "../visualizer/spectrum"
import { getRowStart } from "./browse"
import {
  appleAuthProgressCopy,
  appleAuthStatusLabel,
  appleAuthSuccessCopy,
  compactAppleAuthStatusLabel,
  formatInfoTarget,
  isAppleAuthProgress,
  pluralize,
} from "./copy"
import { maxContextRows, maxPaletteRows } from "./renderables"
import type { AppRenderables, AppViewModel } from "./view-contracts"

export function renderOverlays(
  renderer: CliRenderer,
  view: AppRenderables,
  model: AppViewModel,
): void {
  const {
    state,
    appleAuthStatus,
    authSuccessVisible,
    contextPicker,
    infoTarget,
    visualizerSettingsDialog,
  } = model
  view.paletteOverlay.visible = state.mode.type === "palette"
  const paletteCommands = model.paletteCommands
  const paletteRowCount = Math.max(1, Math.min(maxPaletteRows, renderer.terminalHeight - 7))
  const paletteSelectedIndex = state.mode.type === "palette" ? state.mode.selectedIndex : 0
  const paletteRowStart = getRowStart(
    paletteSelectedIndex,
    paletteCommands.length,
    paletteRowCount,
  )
  view.palettePopup.height = paletteRowCount + 6
  view.paletteInput.content = `›  ${state.mode.type === "palette" ? state.mode.query : ""}_`
  view.paletteSummary.content = `${paletteCommands.length} ${pluralize("command", paletteCommands.length)}`
  view.paletteRows.forEach((row, index) => {
    if (index >= paletteRowCount) {
      row.box.visible = false
      return
    }
    const commandIndex = paletteRowStart + index
    const command = paletteCommands[commandIndex]
    if (!command) {
      row.box.visible = index === 0
      row.title.content = index === 0 ? "  no matching commands" : ""
      row.shortcut.content = ""
      row.box.backgroundColor = theme.surfaceRaised
      row.title.fg = theme.muted
      return
    }
    const selected = state.mode.type === "palette" && commandIndex === state.mode.selectedIndex
    row.box.visible = true
    row.box.backgroundColor = selected ? theme.selection : theme.surfaceRaised
    row.title.content = `${selected ? "›" : " "} ${command.title}${
      renderer.terminalWidth >= 80 ? ` · ${command.description}` : ""
    }`
    row.shortcut.content = command.shortcut
    row.title.fg = selected ? theme.text : theme.muted
    row.shortcut.fg = selected ? theme.accent : theme.muted
  })

  view.contextOverlay.visible = contextPicker !== undefined
  const contextRowCount = Math.max(
    1,
    Math.min(
      maxContextRows,
      contextPicker?.targets.length || 1,
      Math.max(1, renderer.terminalHeight - 6),
    ),
  )
  const contextRowStart = getRowStart(
    contextPicker?.selectedIndex ?? 0,
    contextPicker?.targets.length ?? 0,
    contextRowCount,
  )
  view.contextPopup.height = contextRowCount + 5
  view.contextSummary.content = contextPicker?.status === "loading"
    ? `◌  loading context for ${contextPicker.pinnedTrack.title}...`
    : contextPicker?.status === "error"
      ? "×  now-playing context is unavailable"
      : contextPicker?.targets.length
        ? `${contextPicker.pinnedTrack.title} · choose an action`
        : "No context actions found"
  view.contextSummary.fg = contextPicker?.status === "error" ? theme.amber : theme.muted
  view.contextRows.forEach((row, index) => {
    if (index >= contextRowCount) {
      row.box.visible = false
      return
    }
    const targetIndex = contextRowStart + index
    const target = contextPicker?.targets[targetIndex]
    if (!target) {
      row.box.visible = index === 0
      row.title.content = contextPicker?.status === "loading" ? "  please wait" : "  unavailable"
      row.shortcut.content = ""
      row.box.backgroundColor = theme.surfaceRaised
      row.title.fg = theme.muted
      return
    }
    const selected = targetIndex === contextPicker?.selectedIndex
    row.box.visible = true
    row.title.content = `${selected ? "›" : " "} ${
      target.kind === "album"
        ? target.album.title
        : target.kind === "artist"
          ? target.artist.name
          : target.kind === "station-song"
            ? "Start Station from This Song"
            : `Start Station from ${target.artist.name}`
    }`
    row.shortcut.content = target.kind.startsWith("station-") ? "radio" : target.kind
    row.box.backgroundColor = selected ? theme.selection : theme.surfaceRaised
    row.title.fg = selected ? theme.text : theme.muted
    row.shortcut.fg = selected ? theme.accent : theme.muted
  })

  view.visualizerSettingsOverlay.visible = visualizerSettingsDialog !== undefined
  if (visualizerSettingsDialog) {
    const draft = visualizerSettingsDialog.draft
    const controls = visualizerSettingRows(draft)
    view.visualizerSettingsSummary.content = visualizerSettingsDialog.error ??
      "←/→ change · preview updates immediately"
    view.visualizerSettingsSummary.fg = visualizerSettingsDialog.error ? theme.amber : theme.muted
    view.visualizerSettingsRows.forEach((row, index) => {
      const control = controls[index]!
      const selected = index === visualizerSettingsDialog.selectedIndex
      row.box.backgroundColor = selected ? theme.selection : theme.surfaceRaised
      row.title.content = `${selected ? "›" : " "} ${control.label}`
      row.shortcut.content = renderer.terminalWidth < 36 ? control.value : `‹ ${control.value} ›`
      row.title.fg = selected ? theme.text : theme.muted
      row.shortcut.fg = selected ? theme.accent : theme.muted
    })
    const summaryVisible = renderer.terminalHeight >= 9
    const previewVisible = renderer.terminalHeight >= 15
    const previewWidth = Math.max(8, Math.min(52, renderer.terminalWidth - 12))
    view.visualizerSettingsSummary.visible = summaryVisible
    view.visualizerSettingsPreview.visible = previewVisible
    view.visualizerSettingsPreview.height = draft.height
    view.visualizerSettingsPreview.content = previewVisible
      ? formatSpectrumFrame(
          visualizerPreviewBands,
          previewWidth,
          draft.height,
          resolveVisualizerPalette(draft.palette, theme),
          false,
          draft.style,
        )
      : ""
    view.visualizerSettingsPopup.height = Math.min(
      renderer.terminalHeight - 1,
      previewVisible ? 9 + draft.height : summaryVisible ? 9 : 6,
    )
  }

  view.helpOverlay.visible = state.mode.type === "help"
  const compactHelp = renderer.terminalHeight < view.helpLines.length + 2
  const compactHelpLines = model.library ? [
    "1 songs  2 albums  3 artists",
    "enter open/play  esc back",
    "/ filter  m retry",
    "R refresh  ctrl+o back",
    "space pause  ctrl+p commands",
    "b/s/n prev/shuffle/next",
  ] : [
    "ctrl+p commands · g n now playing",
    "↑/↓ move · i info · f station favorite",
    "b/s/n previous · shuffle · next · r repeat · l like",
    "←/→ seek 5s · shift+←/→ 15s",
    "/ filter or Radio search · g s song search · m more · ? help",
  ]
  view.helpTexts.forEach((line, index) => {
    line.visible = compactHelp ? index < compactHelpLines.length : true
    line.content = compactHelp
      ? (compactHelpLines[index] ?? "")
      : (view.helpLines[index]?.[0] ?? "")
    line.fg = compactHelp
      ? index === 0
        ? theme.accent
        : theme.text
      : (view.helpLines[index]?.[1] ?? theme.text)
  })
  view.helpPopup.height = compactHelp ? 9 : view.helpLines.length + 2

  view.infoOverlay.visible = infoTarget !== undefined
  if (infoTarget) {
    const content = formatInfoTarget(infoTarget)
    if (view.infoBody.plainText !== content) view.infoBody.content = content
    view.infoBody.scrollY = Math.min(view.infoBody.scrollY, view.infoBody.maxScrollY)
    view.infoPopup.title = ` ${infoTarget.kind} info `
  }

  view.appleAuthOverlay.visible = authSuccessVisible || isAppleAuthProgress(appleAuthStatus)
  view.appleAuthPopup.title = authSuccessVisible
    ? " apple music connected "
    : " apple music login "
  view.appleAuthPopup.bottomTitle = authSuccessVisible ? " enter continue " : " esc cancel "
  const authCopy = authSuccessVisible
    ? appleAuthSuccessCopy(appleAuthStatus)
    : appleAuthProgressCopy(appleAuthStatus)
  view.authInstructions.forEach((line, index) => {
    line.content = authCopy[index] ?? ""
    line.visible = Boolean(authCopy[index])
  })
  view.providerStatus.content = renderer.terminalWidth < 64
    ? compactAppleAuthStatusLabel(appleAuthStatus)
    : appleAuthStatusLabel(appleAuthStatus)

}
