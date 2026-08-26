#!/usr/bin/env bun

import { createCliRenderer } from "@opentui/core"

import { fakeTracks } from "./data/fake-tracks"
import { requestDeveloperToken } from "./services/token-service"
import { createNutaApp } from "./ui/app"
import { theme } from "./ui/theme"

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  backgroundColor: theme.background,
})

const app = createNutaApp(renderer, {
  tracks: fakeTracks,
  onQuit: () => renderer.destroy(),
})

const tokenServiceUrl = process.env.NUTA_TOKEN_SERVICE_URL

if (tokenServiceUrl) {
  app.setProviderStatus("apple token  ◌ connecting")

  void requestDeveloperToken(tokenServiceUrl)
    .then(({ mode }) => {
      app.setProviderStatus(
        mode === "mock" ? "apple token  ● mock" : "apple token  ● ready",
      )
    })
    .catch(() => {
      app.setProviderStatus("apple token  × unavailable")
    })
}
