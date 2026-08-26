import { chmod, mkdir } from "node:fs/promises"

import puppeteer, { type Browser } from "puppeteer-core"

import { AppleAuthManager } from "../src/services/apple-auth"
import {
  applePlaybackProfilePath,
  playbackBrowserEnvironment,
} from "../src/services/apple-playback-probe"
import { createCredentialStore } from "../src/services/credentials"

const serviceUrl = process.env.NUTA_TOKEN_SERVICE_URL ?? "http://127.0.0.1:8787"
const executablePath = process.env.NUTA_CHROMIUM_PATH ?? "/usr/bin/chromium"
const profilePath = applePlaybackProfilePath()
let browser: Browser | undefined

const auth = new AppleAuthManager({
  serviceUrl,
  credentialStore: createCredentialStore(),
  openBrowser: async (url) => {
    await mkdir(profilePath, { recursive: true })
    await chmod(profilePath, 0o700)
    browser = await puppeteer.launch({
      executablePath,
      headless: false,
      pipe: true,
      userDataDir: profilePath,
      ignoreDefaultArgs: ["--mute-audio"],
      env: playbackBrowserEnvironment(process.env),
    })
    const page = await browser.newPage()
    page.on("console", () => {})
    page.on("pageerror", () => {})
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10_000 })
  },
})

try {
  console.log("Opening Nuta's dedicated Chromium profile...")
  console.log("Complete Apple Music approval in the browser window.")
  await auth.signIn()
  if (auth.status.state !== "signedIn") throw new Error()
  console.log("PASS: dedicated Chromium profile authorized")
} catch {
  console.error("FAIL: playback_profile_authorization_failed")
  process.exitCode = 1
} finally {
  await browser?.close().catch(() => {})
  await auth.dispose()
}
