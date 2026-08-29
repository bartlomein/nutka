export type AppleCatalogErrorCode =
  | "invalid_request"
  | "unavailable"
  | "invalid_response"
  | "aborted"
  | "timeout"

export class AppleCatalogError extends Error {
  constructor(readonly code: AppleCatalogErrorCode) {
    const messages: Record<AppleCatalogErrorCode, string> = {
      invalid_request: "Apple catalog request is invalid",
      unavailable: "Apple catalog is unavailable",
      invalid_response: "Apple catalog returned an invalid response",
      aborted: "Apple catalog search was aborted",
      timeout: "Apple catalog search timed out",
    }
    super(messages[code])
    this.name = "AppleCatalogError"
  }
}
