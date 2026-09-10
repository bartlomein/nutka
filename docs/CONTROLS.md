# Keyboard controls

- `j`/`k` or arrow keys: move through tracks, playlists, stations, or radio genres
- `Enter`: play the selected Apple Music song and queue the visible songs after it,
  or start the selected Radio station
- `i`: inspect the selected track, playlist, or its loaded album/playlist context;
  use `j`/`k` or arrows to scroll and `i`/`Escape` to close
- `Space`: pause or resume confirmed playback
- `b`, `s`, `n`: play the previous track, toggle shuffle, or play the next track;
  when nothing is playing, `s` shuffle-plays the current source
- `r`: cycle repeat through all songs, the current song, and off
- `f`: favorite or unfavorite the selected station in Nutka
- The now-playing panel shows confirmed `SHUFFLE ON/OFF` and
  `REPEAT OFF/ALL/1` states; compact layouts retain active `S` and `R` badges
- `v`: toggle the visualizer and suspend or resume PipeWire audio analysis
- `Shift+V`: configure the visualizer with a live preview
- `Ctrl+P`: open commands and navigation
- `g n`: open actions for the confirmed now-playing song's album, artists, and
  song or artist stations; if a new song starts, the open page remains pinned
- `g h`, `g l`, `g p`, `g r`, `g s`, `g q`: go to Home, Library, Playlists,
  Radio, Search, or Queue
- Radio: browse favorite, personal, live, and recently played stations, plus
  Apple's station genres; press `Enter` on a genre to open its stations
- Radio: press `/` to search Apple's station catalog by name, for example `NPR`;
  press `m` to load more search or genre results
- Artist pages: browse top songs, latest release, albums, singles and EPs, and
  similar artists; press `Enter` to play or open and `m` to load more
- `Escape` or `Ctrl+O`: return through now-playing artist and album pages
- Home: browse favorite stations and Apple's titled playlist or station
  recommendations; press `m` to load more sections when available
- Playlists: browse playlists saved in Your Library
- Library: press `1`, `2`, or `3` to browse saved songs, albums, or artists.
  Press `Enter` on an artist to open their saved albums, or on an album to open
  its saved tracks. `Escape` or `Ctrl+O` returns to the previous list and restores
  its selection and filter.
- Library: each list loads all pages automatically and shows items as they arrive.
  `/` fuzzy-filters the loaded items; `m` retries a failed request, and `Shift+R` refreshes the current list. Press `Enter` on a song to
  play it and queue the loaded, filtered songs after it. Songs without a usable
  Apple catalog ID remain visible as `[unavailable]` and are skipped in playback.
- Home and Playlists: press `Enter` to open a playlist, press `s` to
  shuffle-play it without opening it, turn shuffle mode on, and press `Escape`
  to return
- Playlist tracks: press `Enter` to play the selected song and queue the visible
  songs after it; press `m` to load the next page when available
- Search: type a query and press `Enter` to search Apple Music songs
- `/`: fuzzy-filter the current list, except in Radio where it searches Apple's
  station catalog; the command palette still exposes local Radio filtering
- Search results: press `s` for a new search and `m` to load the next page
- Search results: press `a` to open the selected song's album; press `Escape` to return
- Filter: type to narrow, use arrows or `Ctrl+N`/`Ctrl+P` to navigate,
  `Enter` to apply, and `Escape` to cancel
- `?`: show keyboard help
- `q`: exit

Station favorites are local to Nutka and scoped by Apple storefront. They are
stored in `$XDG_DATA_HOME/nutka/apple-station-favorites.json` or
`~/.local/share/nutka/apple-station-favorites.json`; set `NUTKA_FAVORITES_PATH`
to use another file. Favoriting does not add a station to the Apple Music
library. The command palette exposes a separate station-like action that affects
Apple Music recommendations. Each storefront can hold up to 25 local favorites.
