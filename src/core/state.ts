import type { PlaybackStatus, Track } from "./types"

export type Destination = "library" | "playlists" | "search" | "queue"

export interface ListState {
  selectedTrackId: string | null
  filter: string
}

export type AppMode =
  | { type: "normal"; pendingKey: "g" | null }
  | {
      type: "filter"
      draft: string
      originalSelectedTrackId: string | null
    }
  | { type: "search"; draft: string }
  | { type: "palette"; query: string; selectedIndex: number }
  | { type: "help" }

export interface PlaybackState {
  currentTrackId: string | null
  status: PlaybackStatus
  queueTrackIds: readonly string[]
  positionSeconds: number
  durationSeconds: number | null
  errorCode: string | null
}

export interface AppState {
  destination: Destination
  mode: AppMode
  lists: Record<Destination, ListState>
  playback: PlaybackState
}

export type AppAction =
  | { type: "navigate"; destination: Destination }
  | {
      type: "move-selection"
      delta: number
      visibleTrackIds: readonly string[]
    }
  | { type: "select-track"; trackId: string | null }
  | { type: "begin-goto" }
  | { type: "goto"; destination: Destination }
  | { type: "open-filter" }
  | {
      type: "edit-filter"
      draft: string
      visibleTrackIds: readonly string[]
    }
  | { type: "submit-filter" }
  | { type: "cancel-filter" }
  | { type: "open-search"; query: string }
  | { type: "edit-search"; draft: string }
  | {
      type: "reset-list"
      destination: Destination
      selectedTrackId: string | null
    }
  | { type: "open-palette" }
  | { type: "edit-palette"; query: string }
  | { type: "move-palette"; delta: number; itemCount: number }
  | { type: "open-help" }
  | { type: "close-mode" }
  | {
      type: "sync-playback"
      currentTrackId: string | null
      status: PlaybackStatus
      queueTrackIds: readonly string[]
      positionSeconds: number
      durationSeconds: number | null
      errorCode: string | null
    }

export function createInitialState(trackIds: readonly string[]): AppState {
  return {
    destination: "library",
    mode: { type: "normal", pendingKey: null },
    lists: {
      library: { selectedTrackId: trackIds[0] ?? null, filter: "" },
      playlists: { selectedTrackId: null, filter: "" },
      search: { selectedTrackId: null, filter: "" },
      queue: { selectedTrackId: null, filter: "" },
    },
    playback: {
      currentTrackId: null,
      status: "idle",
      queueTrackIds: [],
      positionSeconds: 0,
      durationSeconds: null,
      errorCode: null,
    },
  }
}

export function filterTracks(
  tracks: readonly Track[],
  query: string,
): readonly Track[] {
  const normalizedQuery = normalizeSearchText(query)

  if (!normalizedQuery) return tracks
  const terms = normalizedQuery.split(/\s+/)

  return tracks.filter((track) => {
    const fields = [track.title, track.artist, track.album].map(normalizeSearchText)
    return terms.every((term) => fields.some((field) => fuzzyIncludes(field, term)))
  })
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .trim()
    .toLowerCase()
}

function fuzzyIncludes(value: string, query: string): boolean {
  if (value.includes(query)) return true
  let queryIndex = 0
  for (const character of value) {
    if (character === query[queryIndex]) queryIndex++
    if (queryIndex === query.length) return true
  }
  return false
}

function normalMode(): AppMode {
  return { type: "normal", pendingKey: null }
}

function withSelectedTrack(
  state: AppState,
  selectedTrackId: string | null,
): AppState {
  return {
    ...state,
    lists: {
      ...state.lists,
      [state.destination]: {
        ...state.lists[state.destination],
        selectedTrackId,
      },
    },
  }
}

export function reduceAppState(
  state: AppState,
  action: AppAction,
): AppState {
  switch (action.type) {
    case "navigate":
      return {
        ...state,
        destination: action.destination,
        mode: normalMode(),
      }

    case "move-selection": {
      if (action.visibleTrackIds.length === 0) {
        return withSelectedTrack(state, null)
      }

      const selectedTrackId = state.lists[state.destination].selectedTrackId
      const selectedIndex = action.visibleTrackIds.indexOf(selectedTrackId ?? "")
      const nextIndex =
        selectedIndex < 0
          ? action.delta < 0
            ? action.visibleTrackIds.length - 1
            : 0
          : Math.min(
              action.visibleTrackIds.length - 1,
              Math.max(0, selectedIndex + action.delta),
            )

      return withSelectedTrack(state, action.visibleTrackIds[nextIndex] ?? null)
    }

    case "select-track":
      return withSelectedTrack(state, action.trackId)

    case "begin-goto":
      if (state.mode.type !== "normal") return state
      return { ...state, mode: { type: "normal", pendingKey: "g" } }

    case "goto":
      if (state.mode.type !== "normal" || state.mode.pendingKey !== "g") {
        return state
      }
      return {
        ...state,
        destination: action.destination,
        mode: normalMode(),
      }

    case "open-filter": {
      const list = state.lists[state.destination]
      return {
        ...state,
        mode: {
          type: "filter",
          draft: list.filter,
          originalSelectedTrackId: list.selectedTrackId,
        },
      }
    }

    case "edit-filter": {
      if (state.mode.type !== "filter") return state
      const selectedTrackId = state.lists[state.destination].selectedTrackId
      return {
        ...withSelectedTrack(
          state,
          selectedTrackId && action.visibleTrackIds.includes(selectedTrackId)
            ? selectedTrackId
            : (action.visibleTrackIds[0] ?? null),
        ),
        mode: { ...state.mode, draft: action.draft },
      }
    }

    case "submit-filter":
      if (state.mode.type !== "filter") return state
      return {
        ...state,
        mode: normalMode(),
        lists: {
          ...state.lists,
          [state.destination]: {
            ...state.lists[state.destination],
            filter: state.mode.draft,
          },
        },
      }

    case "cancel-filter":
      if (state.mode.type !== "filter") return state
      return {
        ...withSelectedTrack(state, state.mode.originalSelectedTrackId),
        mode: normalMode(),
      }

    case "open-search":
      return { ...state, mode: { type: "search", draft: action.query } }

    case "edit-search":
      if (state.mode.type !== "search") return state
      return { ...state, mode: { type: "search", draft: action.draft } }

    case "reset-list":
      return {
        ...state,
        lists: {
          ...state.lists,
          [action.destination]: {
            selectedTrackId: action.selectedTrackId,
            filter: "",
          },
        },
      }

    case "open-palette":
      return {
        ...state,
        mode: { type: "palette", query: "", selectedIndex: 0 },
      }

    case "edit-palette":
      if (state.mode.type !== "palette") return state
      return {
        ...state,
        mode: { type: "palette", query: action.query, selectedIndex: 0 },
      }

    case "move-palette": {
      if (state.mode.type !== "palette") return state
      const lastIndex = Math.max(0, action.itemCount - 1)
      return {
        ...state,
        mode: {
          ...state.mode,
          selectedIndex: Math.min(
            lastIndex,
            Math.max(0, state.mode.selectedIndex + action.delta),
          ),
        },
      }
    }

    case "open-help":
      return { ...state, mode: { type: "help" } }

    case "close-mode":
      if (state.mode.type === "normal") {
        if (state.mode.pendingKey === null) return state
        return { ...state, mode: normalMode() }
      }
      if (state.mode.type === "filter") {
        return {
          ...withSelectedTrack(state, state.mode.originalSelectedTrackId),
          mode: normalMode(),
        }
      }
      return { ...state, mode: normalMode() }

    case "sync-playback": {
      const queueChanged = !sameTrackIds(
        state.playback.queueTrackIds,
        action.queueTrackIds,
      )
      const selectedQueueTrackId = state.lists.queue.selectedTrackId
      const advancedWithinQueue = Boolean(
        action.currentTrackId &&
        state.playback.queueTrackIds[0] === action.currentTrackId,
      )
      return {
        ...state,
        lists: {
          ...state.lists,
          queue: queueChanged
            ? {
                selectedTrackId:
                  selectedQueueTrackId && action.queueTrackIds.includes(selectedQueueTrackId)
                    ? selectedQueueTrackId
                    : (action.queueTrackIds[0] ?? null),
                filter: advancedWithinQueue ? state.lists.queue.filter : "",
              }
            : state.lists.queue,
        },
        playback: {
          currentTrackId: action.currentTrackId,
          status: action.status,
          queueTrackIds: [...action.queueTrackIds],
          positionSeconds: action.positionSeconds,
          durationSeconds: action.durationSeconds,
          errorCode: action.errorCode,
        },
      }
    }
  }
}

function sameTrackIds(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((id, index) => id === right[index])
  )
}
