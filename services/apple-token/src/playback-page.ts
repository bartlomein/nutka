export const PLAYBACK_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Nutka Playback Worker</title>
  <script src="https://js-cdn.music.apple.com/musickit/v3/musickit.js"></script>
  <script src="/playback.js" defer></script>
</head>
<body>
  <button id="play" type="button">Play</button>
  <button id="pause" type="button">Pause</button>
  <button id="resume" type="button">Resume</button>
  <button id="previous" type="button">Previous</button>
  <button id="next" type="button">Next</button>
  <button id="stop" type="button">Stop</button>
</body>
</html>`

export const PLAYBACK_JS = `(() => {
  "use strict";
  let music;
  let songResourceIds;
  let lastErrorCode;
  let commandSequence = 0;
  let completedCommandSequence = 0;

  function safeErrorCode(error) {
    if (!error || typeof error !== "object") return "unknown";
    for (const key of ["code", "errorCode", "status", "name"]) {
      const value = error[key];
      if ((typeof value === "string" || typeof value === "number") && /^[a-z0-9_.:-]{1,64}$/i.test(String(value))) {
        return String(value);
      }
    }
    return "unknown";
  }

  async function run(action) {
    lastErrorCode = undefined;
    try {
      await action();
    } catch (error) {
      lastErrorCode = safeErrorCode(error);
      throw new Error("playback_command_failed");
    }
  }

  async function initialize(developerToken, musicUserToken) {
    if (music) throw new Error("already_initialized");
    await MusicKit.configure({ developerToken, app: { name: "Nutka", build: "1" } });
    music = MusicKit.getInstance();
    music.musicUserToken = musicUserToken;
    music.addEventListener("playbackError", (event) => {
      lastErrorCode = safeErrorCode(event);
    });
    return { authorized: music.isAuthorized === true };
  }

  function setQueue(resourceIds) {
    if (!music) throw new Error("not_initialized");
    if (!Array.isArray(resourceIds) || resourceIds.length === 0 || resourceIds.length > 500 ||
        resourceIds.some((resourceId) => typeof resourceId !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(resourceId))) {
      throw new Error("invalid_queue");
    }
    songResourceIds = [...resourceIds];
  }

  async function play() {
    if (!music || !songResourceIds) throw new Error("not_ready");
    await run(async () => {
      await music.setQueue(songResourceIds.length === 1
        ? { song: songResourceIds[0] }
        : { songs: songResourceIds });
      await music.play();
    });
  }

  function snapshot() {
    if (!music) return { initialized: false };
    const item = music.nowPlayingItem;
    return {
      initialized: true,
      authorized: music.isAuthorized === true,
      isPlaying: music.isPlaying === true,
      playbackState: Number.isFinite(music.playbackState) ? music.playbackState : null,
      positionSeconds: Number.isFinite(music.currentPlaybackTime) ? music.currentPlaybackTime : 0,
      durationSeconds: Number.isFinite(music.currentPlaybackDuration) ? music.currentPlaybackDuration : null,
      resourceId: typeof item?.id === "string" ? item.id : null,
      title: typeof item?.attributes?.name === "string" ? item.attributes.name : null,
      artist: typeof item?.attributes?.artistName === "string" ? item.attributes.artistName : null,
      lastErrorCode: lastErrorCode ?? null,
      commandSequence,
      completedCommandSequence
    };
  }

  function trigger(action) {
    const sequence = ++commandSequence;
    lastErrorCode = undefined;
    void Promise.resolve()
      .then(action)
      .catch((error) => {
        lastErrorCode ??= safeErrorCode(error);
      })
      .finally(() => {
        completedCommandSequence = sequence;
      });
  }

  document.querySelector("#play").addEventListener("click", () => trigger(play));
  document.querySelector("#pause").addEventListener("click", () => trigger(() => {
    if (!music) throw new Error("not_initialized");
    return run(() => music.pause());
  }));
  document.querySelector("#resume").addEventListener("click", () => trigger(() => {
    if (!music) throw new Error("not_initialized");
    return run(() => music.play());
  }));
  document.querySelector("#previous").addEventListener("click", () => trigger(() => {
    if (!music) throw new Error("not_initialized");
    return run(() => music.skipToPreviousItem());
  }));
  document.querySelector("#next").addEventListener("click", () => trigger(() => {
    if (!music) throw new Error("not_initialized");
    return run(() => music.skipToNextItem());
  }));
  document.querySelector("#stop").addEventListener("click", () => trigger(() => {
    if (!music) throw new Error("not_initialized");
    return run(() => music.stop());
  }));

  window.__nutkaPlayback = {
    initialize,
    setQueue,
    snapshot,
    seek: (positionSeconds) => {
      if (!music || !Number.isFinite(positionSeconds) || positionSeconds < 0) {
        throw new Error("invalid_seek");
      }
      return run(() => music.seekToTime(positionSeconds));
    }
  };
})();`
