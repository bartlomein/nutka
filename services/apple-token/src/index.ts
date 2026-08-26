import { loadTokenServiceConfig } from "./config"
import { createRequestHandler } from "./server"
import { createDeveloperTokenIssuer } from "./token"

const config = await loadTokenServiceConfig()
const issuer = createDeveloperTokenIssuer(config)
const handleRequest = createRequestHandler(config, issuer)

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  fetch(request, server) {
    const clientId = server.requestIP(request)?.address ?? "unknown"
    return handleRequest(request, clientId)
  },
})

console.log(
  `Nuta Apple token service (${config.mode}) listening on ${server.url.origin}`,
)
