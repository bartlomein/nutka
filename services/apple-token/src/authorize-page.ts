export const AUTHORIZE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize Apple Music</title>
  <link rel="stylesheet" href="/authorize.css">
  <script src="https://js-cdn.music.apple.com/musickit/v3/musickit.js"></script>
  <script src="/authorize.js" defer></script>
</head>
<body>
  <main>
    <h1>Authorize Apple Music</h1>
    <p>Connect this browser, then approve access with Apple Music.</p>
    <button id="authorize" type="button" hidden>Authorize Apple Music</button>
    <p id="message" role="status">Connecting to the local authorization service...</p>
  </main>
</body>
</html>`

export const AUTHORIZE_JS = `(() => {
  "use strict";
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const browserToken = fragment.get("browserToken");
  history.replaceState(null, "", window.location.pathname + window.location.search);

  const button = document.querySelector("#authorize");
  const message = document.querySelector("#message");
  let csrfToken;

  function trace(event, code) {
    void fetch("/v1/apple/auth/browser/event", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(code ? { event, code } : { event })
    }).catch(() => {});
  }

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

  async function connect() {
    if (!browserToken) {
      message.textContent = "This authorization link is invalid. Return to Nuta and start again.";
      return;
    }
    message.textContent = "Connecting to the local authorization service...";
    try {
      const response = await fetch("/v1/apple/auth/browser/claim", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ browserToken })
      });
      if (!response.ok) {
        message.textContent = [401, 409, 410].includes(response.status)
          ? "This authorization link is invalid, expired, or already used. Return to Nuta and start again."
          : "The local authorization service is unavailable. Return to Nuta and try again.";
        return;
      }
      const claim = await response.json();
      csrfToken = claim.csrfToken;
      message.textContent = "Configuring Apple Music...";
      try {
        await MusicKit.configure({ developerToken: claim.developerToken, app: { name: "Nuta", build: "1" } });
      } catch {
        message.textContent = "Apple Music could not be configured. Return to Nuta, cancel, and start again.";
        return;
      }
      trace("musickit_configured");
      button.hidden = false;
      message.textContent = "Connected. Click Authorize Apple Music to continue.";
    } catch {
      message.textContent = "Could not connect to the local authorization service. Return to Nuta and try again.";
    }
  }

  button.addEventListener("click", async () => {
    button.disabled = true;
    message.textContent = "Waiting for Apple Music approval...";
    trace("apple_approval_started");
    let musicUserToken;
    try {
      musicUserToken = await MusicKit.getInstance().authorize();
    } catch (error) {
      const code = safeErrorCode(error);
      trace("apple_approval_failed", code);
      button.disabled = false;
      message.textContent = "Apple Music approval failed (" + code + "). You can try again or return to Nuta.";
      return;
    }

    message.textContent = "Sending authorization completion to Nuta...";
    trace("completion_send_started");
    try {
      const response = await fetch("/v1/apple/auth/browser/complete", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csrfToken, musicUserToken })
      });
      if (!response.ok) {
        if (response.status === 409) {
          button.hidden = true;
          message.textContent = "Authorization may already be complete. Return to Nuta and check the terminal.";
          return;
        }
        if ([401, 410].includes(response.status)) {
          button.hidden = true;
          message.textContent = "This session ended. Return to Nuta and start again.";
          return;
        }
        throw new Error();
      }
      button.hidden = true;
      message.textContent = "Authorization sent to Nuta. Return to the terminal and wait for confirmation.";
    } catch {
      trace("completion_send_failed");
      button.disabled = false;
      message.textContent = "Could not send authorization completion. Check the Nuta terminal; if it is still waiting, try again.";
    }
  });

  void connect();
})();`

export const AUTHORIZE_CSS = `
:root {
  color-scheme: light dark;
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  background: #11111b;
  color: #cdd6f4;
}
* { box-sizing: border-box; }
body {
  min-height: 100vh;
  margin: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: radial-gradient(circle at top, #313244 0, #181825 42%, #11111b 100%);
}
main {
  width: min(100%, 520px);
  padding: 36px;
  border: 1px solid #585b70;
  border-radius: 14px;
  background: #1e1e2e;
  box-shadow: 0 24px 80px #0008;
}
h1 { margin: 0 0 12px; color: #89b4fa; font-size: 24px; }
p { color: #a6adc8; line-height: 1.6; }
button {
  padding: 13px 16px;
  border: 0;
  border-radius: 8px;
  background: #89b4fa;
  color: #11111b;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
button:hover { background: #b4befe; }
button:disabled { cursor: wait; opacity: 0.6; }
#authorize { width: 100%; margin-top: 28px; }
#message { min-height: 26px; margin-bottom: 0; color: #f9e2af; }
`
