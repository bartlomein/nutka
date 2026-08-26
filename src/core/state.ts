import type { PlaybackStatus, Track } from "./types"

export type InputMode = "normal" | "search"

export interface AppState {
  inputMode: InputMode
  query: string
  selectedIndex: number
  currentTrackId: string | null
  playbackStatus: PlaybackStatus
}

export type AppAction =
  | { type: "move"; delta: number; itemCount: number }
  | { type: "begin-search" }
  | { type: "set-query"; query: string }
  | { type: "finish-search" }
  | { type: "play"; trackId: string | null }
  | { type: "toggle-playback"; selectedTrackId: string | null }

export const initialState: AppState = {
  inputMode: "normal",
  query: "",
  selectedIndex: 0,
  currentTrackId: null,
  playbackStatus: "idle",
}

export function filterTracks(
  tracks: readonly Track[],
  query: string,
): readonly Track[] {
  const normalizedQuery = query.trim().toLowerCase()

  if (!normalizedQuery) {
    return tracks
  }

  return tracks.filter((track) =>
    [track.title, track.artist, track.album].some((value) =>
      value.toLowerCase().includes(normalizedQuery),
    ),
  )
}

export function reduceAppState(
  state: AppState,
  action: AppAction,
): AppState {
  switch (action.type) {
    case "move": {
      const lastIndex = Math.max(0, action.itemCount - 1)

      return {
        ...state,
        selectedIndex: Math.min(
          lastIndex,
          Math.max(0, state.selectedIndex + action.delta),
        ),
      }
    }

    case "begin-search":
      return { ...state, inputMode: "search" }

    case "set-query":
      return { ...state, query: action.query, selectedIndex: 0 }

    case "finish-search":
      return { ...state, inputMode: "normal" }

    case "play":
      if (!action.trackId) return state

      return {
        ...state,
        currentTrackId: action.trackId,
        playbackStatus: "playing",
      }

    case "toggle-playback": {
      if (!state.currentTrackId) {
        if (!action.selectedTrackId) return state

        return {
          ...state,
          currentTrackId: action.selectedTrackId,
          playbackStatus: "playing",
        }
      }

      return {
        ...state,
        playbackStatus:
          state.playbackStatus === "playing" ? "paused" : "playing",
      }
    }
  }
}
