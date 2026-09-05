import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core"

import { createPlayerPanel } from "../player"
import { theme } from "../theme"
import type { VisualizerSettings } from "../visualizer"
import { visualizerSettingCount } from "../visualizer/settings-view"
import {
  createAppPresenter,
  type AppRenderables,
  type AppView,
  type AppViewModel,
} from "./app-presenter"
import {
  createOverlay,
  createTrackRow,
  maxContextRows,
  maxPaletteRows,
  maxTrackRows,
  setTrackRowColor,
  setTrackRowContent,
  text,
  type PaletteRow,
} from "./renderables"

export type { AppView, AppViewModel } from "./app-presenter"

export function createAppView(
  renderer: CliRenderer,
  options: {
    onSeek(positionSeconds: number): void
    visualizerSettings: VisualizerSettings
  },
  ): AppView {
  const app = new BoxRenderable(renderer, {
    id: "app",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: theme.background,
  })

  const header = new BoxRenderable(renderer, {
    id: "header",
    width: "100%",
    height: 3,
    paddingX: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    border: ["bottom"],
    borderColor: theme.border,
    backgroundColor: theme.surface,
  })
  const breadcrumb = text(renderer, "breadcrumb", "nutka  /  home", theme.text)
  const providerStatus = text(
    renderer,
    "provider-status",
    "apple music  ○ signed out",
    theme.muted,
  )
  header.add(breadcrumb)
  header.add(providerStatus)

  const workspace = new BoxRenderable(renderer, {
    id: "workspace",
    width: "100%",
    flexGrow: 1,
    padding: 1,
    flexDirection: "column",
    overflow: "hidden",
  })
  const workspaceHeader = new BoxRenderable(renderer, {
    id: "workspace-header",
    width: "100%",
    height: 2,
    flexDirection: "row",
    justifyContent: "space-between",
  })
  const workspaceTitle = text(renderer, "workspace-title", "Home", theme.text)
  const workspaceCount = text(renderer, "workspace-count", "", theme.muted)
  workspaceHeader.add(workspaceTitle)
  workspaceHeader.add(workspaceCount)
  workspace.add(workspaceHeader)

  const filterLine = text(renderer, "filter-line", "", theme.text)
  filterLine.height = 2
  filterLine.visible = false
  workspace.add(filterLine)

  const tableHeader = createTrackRow(renderer, "table-header", theme.background)
  setTrackRowContent(tableHeader, {
    title: "track",
    artist: "artist",
    album: "album",
    time: "time",
  })
  setTrackRowColor(tableHeader, theme.muted)
  workspace.add(tableHeader.box)
  const trackRows = Array.from({ length: maxTrackRows }, (_, index) => {
    const row = createTrackRow(renderer, `track-${index}`, theme.background)
    workspace.add(row.box)
    return row
  })

  const player = createPlayerPanel(renderer, {
    onSeek: options.onSeek,
    visualizer: options.visualizerSettings,
  })
  const footer = new BoxRenderable(renderer, {
    id: "footer",
    width: "100%",
    height: 3,
    paddingX: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    border: ["top"],
    borderColor: theme.border,
    backgroundColor: theme.surfaceRaised,
  })
  const mode = text(renderer, "mode", "NORMAL", theme.background, theme.accent)
  mode.width = 9
  const keyHelp = text(
    renderer,
    "key-help",
    "j/k move   / fuzzy filter   ctrl+p commands   ? help",
    theme.muted,
  )
  const destinationHint = text(renderer, "destination-hint", "g n/h/l/p/r/s/q", theme.amber)
  keyHelp.flexGrow = 1
  destinationHint.width = 15
  footer.add(mode)
  footer.add(keyHelp)
  footer.add(destinationHint)
  app.add(header)
  app.add(workspace)
  app.add(player.root)
  app.add(footer)

  const paletteOverlay = createOverlay(renderer, "palette-overlay", 20)
  const palettePopup = new BoxRenderable(renderer, {
    id: "palette-popup",
    width: 72,
    maxWidth: "94%",
    height: 14,
    paddingX: 1,
    flexDirection: "column",
    border: true,
    borderColor: theme.border,
    backgroundColor: theme.surfaceRaised,
    title: " commands ",
    titleColor: theme.accent,
    bottomTitle: " esc close ",
    bottomTitleAlignment: "right",
  })
  const paletteInput = text(renderer, "palette-input", "›  _", theme.text)
  paletteInput.height = 2
  const paletteSummary = text(
    renderer,
    "palette-summary",
    "go anywhere or run a command",
    theme.muted,
  )
  palettePopup.add(paletteInput)
  palettePopup.add(paletteSummary)
  const paletteRows: PaletteRow[] = Array.from({ length: maxPaletteRows }, (_, index) => {
    const row = new BoxRenderable(renderer, {
      id: `palette-row-${index}`,
      width: "100%",
      height: 1,
      flexDirection: "row",
      justifyContent: "space-between",
      columnGap: 1,
    })
    const title = text(renderer, `palette-row-${index}-title`, "", theme.text)
    const shortcut = text(renderer, `palette-row-${index}-shortcut`, "", theme.muted)
    title.flexGrow = 1
    shortcut.width = 9
    row.add(title)
    row.add(shortcut)
    palettePopup.add(row)
    return { box: row, title, shortcut }
  })
  const paletteHelp = text(
    renderer,
    "palette-help",
    "↑/↓ navigate   enter run   ctrl+n/p navigate",
    theme.muted,
  )
  palettePopup.add(paletteHelp)
  paletteOverlay.add(palettePopup)
  app.add(paletteOverlay)

  const contextOverlay = createOverlay(renderer, "context-overlay", 25)
  const contextPopup = new BoxRenderable(renderer, {
    id: "context-popup",
    width: 72,
    maxWidth: "94%",
    height: 8,
    paddingX: 1,
    flexDirection: "column",
    border: true,
    borderColor: theme.border,
    backgroundColor: theme.surfaceRaised,
    title: " browse now playing ",
    titleColor: theme.accent,
    bottomTitle: " esc cancel ",
    bottomTitleAlignment: "right",
  })
  const contextSummary = text(
    renderer,
    "context-summary",
    "loading album and artists...",
    theme.muted,
  )
  contextSummary.height = 2
  contextPopup.add(contextSummary)
  const contextRows: PaletteRow[] = Array.from({ length: maxContextRows }, (_, index) => {
    const row = new BoxRenderable(renderer, {
      id: `context-row-${index}`,
      width: "100%",
      height: 1,
      flexDirection: "row",
      justifyContent: "space-between",
      columnGap: 1,
    })
    const title = text(renderer, `context-row-${index}-title`, "", theme.text)
    const shortcut = text(renderer, `context-row-${index}-kind`, "", theme.muted)
    title.flexGrow = 1
    shortcut.width = 9
    row.add(title)
    row.add(shortcut)
    contextPopup.add(row)
    return { box: row, title, shortcut }
  })
  contextOverlay.add(contextPopup)
  app.add(contextOverlay)

  const visualizerSettingsOverlay = createOverlay(renderer, "visualizer-settings-overlay", 30)
  const visualizerSettingsPopup = new BoxRenderable(renderer, {
    id: "visualizer-settings-popup",
    width: 64,
    maxWidth: "94%",
    height: 12,
    paddingX: 2,
    paddingY: 1,
    flexDirection: "column",
    border: true,
    borderColor: theme.border,
    backgroundColor: theme.surfaceRaised,
    title: " visualizer settings ",
    titleColor: theme.accent,
    bottomTitle: " enter apply  esc cancel ",
    bottomTitleAlignment: "right",
  })
  const visualizerSettingsSummary = text(
    renderer,
    "visualizer-settings-summary",
    "←/→ change · preview updates immediately",
    theme.muted,
  )
  visualizerSettingsPopup.add(visualizerSettingsSummary)
  const visualizerSettingsRows: PaletteRow[] = Array.from(
    { length: visualizerSettingCount },
    (_, index) => {
      const row = new BoxRenderable(renderer, {
        id: `visualizer-setting-${index}`,
        width: "100%",
        height: 1,
        flexDirection: "row",
        justifyContent: "space-between",
        columnGap: 1,
      })
      const title = text(renderer, `visualizer-setting-${index}-title`, "", theme.text)
      const shortcut = text(renderer, `visualizer-setting-${index}-value`, "", theme.accent)
      title.flexGrow = 1
      shortcut.width = 22
      row.add(title)
      row.add(shortcut)
      visualizerSettingsPopup.add(row)
      return { box: row, title, shortcut }
    },
  )
  const visualizerSettingsPreview = new TextRenderable(renderer, {
    id: "visualizer-settings-preview",
    content: "",
    width: "100%",
    height: options.visualizerSettings.height,
    truncate: true,
  })
  visualizerSettingsPopup.add(visualizerSettingsPreview)
  visualizerSettingsOverlay.add(visualizerSettingsPopup)
  app.add(visualizerSettingsOverlay)

  const helpOverlay = createOverlay(renderer, "help-overlay", 30)
  const helpPopup = new BoxRenderable(renderer, {
    id: "help-popup",
    width: 72,
    maxWidth: "94%",
    height: 17,
    paddingX: 2,
    flexDirection: "column",
    border: true,
    borderColor: theme.border,
    backgroundColor: theme.surfaceRaised,
    title: " keyboard help ",
    titleColor: theme.accent,
    bottomTitle: " ? or esc close ",
    bottomTitleAlignment: "right",
  })
  const helpLines = [
    ["GLOBAL", theme.accent],
    ["g n now playing   g h home   g l library", theme.text],
    ["Library: 1 songs  2 albums  3 artists  R refresh", theme.text],
    ["g p playlists   g r radio   g s search   g q queue", theme.text],
    ["ctrl+p commands   v visualizer   V settings   ? help   q quit", theme.text],
    ["", theme.text],
    ["LISTS", theme.accent],
    ["j/k or ↑/↓  move      enter  play or open", theme.text],
    ["b/s/n       previous / shuffle / next      r repeat   l like", theme.text],
    ["i item info   f station favorite   / filter or Radio search", theme.text],
    ["←/→         seek 5s   shift+←/→  seek 15s", theme.text],
    ["esc         back or cancel pending g", theme.text],
    ["", theme.text],
    ["FILTER", theme.accent],
    ["type to narrow        ↑/↓  choose        enter  apply", theme.text],
    ["backspace edit        esc  cancel        ctrl+n/p  choose", theme.text],
  ] as const
  const helpTexts = helpLines.map(([content, color], index) => {
    const line = text(renderer, `help-${index}`, content, color)
    helpPopup.add(line)
    return line
  })
  helpOverlay.add(helpPopup)
  app.add(helpOverlay)

  const infoOverlay = createOverlay(renderer, "info-overlay", 35)
  const infoPopup = new BoxRenderable(renderer, {
    id: "info-popup",
    width: 80,
    maxWidth: "94%",
    height: 22,
    paddingX: 2,
    paddingY: 1,
    flexDirection: "column",
    overflow: "hidden",
    border: true,
    borderColor: theme.border,
    backgroundColor: theme.surfaceRaised,
    title: " item info ",
    titleColor: theme.accent,
    bottomTitle: " i/esc close  j/k scroll ",
    bottomTitleAlignment: "right",
  })
  const infoBody = new TextRenderable(renderer, {
    id: "info-body",
    content: "",
    width: "100%",
    flexGrow: 1,
    fg: theme.text,
    bg: theme.surfaceRaised,
    wrapMode: "word",
    truncate: false,
    selectable: true,
  })
  infoPopup.add(infoBody)
  infoOverlay.add(infoPopup)
  app.add(infoOverlay)

  const appleAuthOverlay = createOverlay(renderer, "apple-auth-overlay", 40)
  const appleAuthPopup = new BoxRenderable(renderer, {
    id: "apple-auth-popup",
    width: 64,
    maxWidth: "94%",
    height: 12,
    paddingX: 2,
    flexDirection: "column",
    border: true,
    borderColor: theme.border,
    backgroundColor: theme.surfaceRaised,
    title: " apple music login ",
    titleColor: theme.accent,
    bottomTitle: " esc cancel ",
    bottomTitleAlignment: "right",
  })
  const authInstructions = [
    text(renderer, "auth-step-1", "", theme.text),
    text(renderer, "auth-step-2", "", theme.muted),
    text(renderer, "auth-step-3", "", theme.accent),
    text(renderer, "auth-step-4", "", theme.text),
    text(renderer, "auth-step-5", "", theme.muted),
    text(renderer, "auth-step-6", "", theme.amber),
  ]
  authInstructions[0]!.height = 2
  authInstructions[2]!.height = 2
  for (const line of authInstructions) appleAuthPopup.add(line)
  appleAuthOverlay.add(appleAuthPopup)
  app.add(appleAuthOverlay)
  renderer.root.add(app)

  const renderables: AppRenderables = {
    app,
    header,
    breadcrumb,
    providerStatus,
    workspace,
    workspaceHeader,
    workspaceTitle,
    workspaceCount,
    filterLine,
    tableHeader,
    trackRows,
    player,
    footer,
    mode,
    keyHelp,
    destinationHint,
    paletteOverlay,
    palettePopup,
    paletteInput,
    paletteSummary,
    paletteRows,
    contextOverlay,
    contextPopup,
    contextSummary,
    contextRows,
    visualizerSettingsOverlay,
    visualizerSettingsPopup,
    visualizerSettingsSummary,
    visualizerSettingsRows,
    visualizerSettingsPreview,
    helpOverlay,
    helpPopup,
    helpLines,
    helpTexts,
    infoOverlay,
    infoPopup,
    infoBody,
    appleAuthOverlay,
    appleAuthPopup,
    authInstructions,
  }
  return createAppPresenter(renderer, renderables)
}
