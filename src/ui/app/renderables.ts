import {
  BoxRenderable,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core"

import { theme } from "../theme"

export const maxTrackRows = 30
export const maxPaletteRows = 7
export const maxContextRows = 8
export const maxQueueRows = 8

export interface TrackRowContent {
  title: string
  artist: string
  album: string
  year?: string
  time: string
}

export interface TrackRow {
  box: BoxRenderable
  title: TextRenderable
  artist: TextRenderable
  album: TextRenderable
  year: TextRenderable
  time: TextRenderable
}

export interface PaletteRow {
  box: BoxRenderable
  title: TextRenderable
  shortcut: TextRenderable
}

export interface NavigationRow {
  box: BoxRenderable
  label: TextRenderable
  shortcut: TextRenderable
}

export interface QueueRow {
  box: BoxRenderable
  number: TextRenderable
  title: TextRenderable
  detail: TextRenderable
  duration: TextRenderable
}

export function text(
  renderer: CliRenderer,
  id: string,
  content: string,
  fg: string,
  bg?: string,
): TextRenderable {
  return new TextRenderable(renderer, {
    id,
    content,
    fg,
    bg,
    height: 1,
    truncate: true,
  })
}

export function createOverlay(
  renderer: CliRenderer,
  id: string,
  zIndex: number,
): BoxRenderable {
  return new BoxRenderable(renderer, {
    id,
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    zIndex,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.overlay.length === 7 ? `${theme.overlay}D9` : theme.overlay,
    visible: false,
  })
}

export function createTrackRow(
  renderer: CliRenderer,
  id: string,
  backgroundColor: string,
): TrackRow {
  const box = new BoxRenderable(renderer, {
    id,
    width: "100%",
    height: 1,
    flexDirection: "row",
    columnGap: 2,
    backgroundColor,
  })
  const title = text(renderer, `${id}-title`, "", theme.text)
  const artist = text(renderer, `${id}-artist`, "", theme.text)
  const album = text(renderer, `${id}-album`, "", theme.text)
  const year = text(renderer, `${id}-year`, "", theme.text)
  const time = text(renderer, `${id}-time`, "", theme.text)

  title.width = "32%"
  artist.width = "24%"
  album.flexGrow = 1
  year.width = 6
  year.visible = false
  time.width = 6
  box.add(title)
  box.add(artist)
  box.add(album)
  box.add(year)
  box.add(time)
  return { box, title, artist, album, year, time }
}

export function createNavigationRow(
  renderer: CliRenderer,
  id: string,
): NavigationRow {
  const box = new BoxRenderable(renderer, {
    id,
    width: "100%",
    height: 1,
    flexDirection: "row",
    columnGap: 1,
    backgroundColor: theme.background,
  })
  const label = text(renderer, `${id}-label`, "", theme.text)
  const shortcut = text(renderer, `${id}-shortcut`, "", theme.muted)
  label.flexGrow = 1
  shortcut.width = 6
  box.add(label)
  box.add(shortcut)
  return { box, label, shortcut }
}

export function createQueueRow(
  renderer: CliRenderer,
  id: string,
): QueueRow {
  const box = new BoxRenderable(renderer, {
    id,
    width: "100%",
    height: 2,
    flexDirection: "row",
    columnGap: 1,
    backgroundColor: theme.background,
  })
  const number = text(renderer, `${id}-number`, "", theme.muted)
  const title = text(renderer, `${id}-title`, "", theme.text)
  const detail = text(renderer, `${id}-detail`, "", theme.muted)
  const duration = text(renderer, `${id}-duration`, "", theme.muted)
  const body = new BoxRenderable(renderer, {
    id: `${id}-body`,
    width: "100%",
    height: 2,
    flexDirection: "column",
  })
  const titleLine = new BoxRenderable(renderer, {
    id: `${id}-title-line`,
    width: "100%",
    height: 1,
    flexDirection: "row",
    columnGap: 1,
  })
  number.width = 3
  title.flexGrow = 1
  duration.width = 6
  detail.width = "100%"
  titleLine.add(title)
  titleLine.add(duration)
  body.add(titleLine)
  body.add(detail)
  box.add(number)
  box.add(body)
  return { box, number, title, detail, duration }
}

export function setTrackRowContent(row: TrackRow, content: TrackRowContent): void {
  row.title.content = content.title
  row.artist.content = content.artist
  row.album.content = content.album
  row.year.content = content.year ?? ""
  row.time.content = content.time
}

export function setTrackRowColor(row: TrackRow, color: string): void {
  row.title.fg = color
  row.artist.fg = color
  row.album.fg = color
  row.year.fg = color
  row.time.fg = color
}
