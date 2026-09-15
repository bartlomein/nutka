import type { AppleAuthStatus } from "./types"

export interface StartupAppleAuth {
  readonly status: AppleAuthStatus
  restore(): Promise<void>
  signIn(): Promise<void>
}

export async function restoreAppleAuthOnStartup(
  auth: StartupAppleAuth,
): Promise<void> {
  await auth.restore()
  if (auth.status.state === "signedOut") await auth.signIn()
}
