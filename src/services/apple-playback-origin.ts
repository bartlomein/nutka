export function loopbackPlaybackUrl(serviceUrl: string): string | null {
  let url: URL
  try {
    url = new URL(serviceUrl)
  } catch {
    return null
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password
  ) {
    return null
  }
  return new URL("/playback", url.origin).href
}

export function isPlaybackDocumentUrl(actualUrl: string, expectedUrl: string): boolean {
  try {
    return new URL(actualUrl).href === new URL(expectedUrl).href
  } catch {
    return false
  }
}
