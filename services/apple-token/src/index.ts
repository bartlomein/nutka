import { loadTokenServiceConfig } from "./config"
import { AuthorizationBroker } from "./authorization-broker"
import { createRequestHandler } from "./server"
import { createDeveloperTokenIssuer } from "./token"
import { createAuthLogger } from "../../../src/services/auth-log"

const config = await loadTokenServiceConfig()
const issuer = createDeveloperTokenIssuer(config)
const broker = new AuthorizationBroker(
  `http://127.0.0.1:${config.port}/authorize`,
)
const logger = createAuthLogger("service")
const handleRequest = createRequestHandler(config, issuer, undefined, broker, logger)
logger.log("service_started")

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  fetch(request, server) {
    const clientId = server.requestIP(request)?.address ?? "unknown"
    return handleRequest(request, clientId)
  },
})

console.log(
  `Nutka Apple token service (${config.mode}) listening on ${server.url.origin}`,
)
