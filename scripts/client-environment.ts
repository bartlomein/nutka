const CLIENT_ENVIRONMENT_NAMES = [
  "COLORTERM",
  "DBUS_SESSION_BUS_ADDRESS",
  "DISPLAY",
  "HOME",
  "LANG",
  "NO_COLOR",
  "NUTA_AUTH_LOG",
  "NUTA_CHROMIUM_PATH",
  "NUTA_THEME_PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "USER",
  "WAYLAND_DISPLAY",
  "XAUTHORITY",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_CURRENT_DESKTOP",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
  "XDG_SESSION_TYPE",
  "XDG_STATE_HOME",
] as const

export function createClientEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const environment: Record<string, string> = {
    PATH: "/usr/local/bin:/usr/bin:/bin",
  }
  for (const name of CLIENT_ENVIRONMENT_NAMES) {
    const value = source[name]
    if (value) environment[name] = value
  }
  for (const [name, value] of Object.entries(source)) {
    if (name.startsWith("LC_") && value) environment[name] = value
  }
  return environment
}
