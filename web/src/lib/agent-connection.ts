function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "")
}


export function normalizeAgentHttpBaseUrl(
  value: string | null | undefined
): string | null {
  const raw = value?.trim()
  if (!raw) return null

  try {
    const url = new URL(raw)
    if (!["http:", "https:"].includes(url.protocol)) {
      return null
    }
    url.pathname = trimTrailingSlash(url.pathname)
    url.search = ""
    url.hash = ""
    return trimTrailingSlash(url.toString())
  } catch {
    return null
  }
}


export function normalizeAgentWebSocketBaseUrl(
  value: string | null | undefined
): string | null {
  const raw = value?.trim()
  if (!raw) return null

  try {
    const url = new URL(raw)
    if (url.protocol === "http:") {
      url.protocol = "ws:"
    } else if (url.protocol === "https:") {
      url.protocol = "wss:"
    } else if (!["ws:", "wss:"].includes(url.protocol)) {
      return null
    }

    url.pathname = trimTrailingSlash(url.pathname)
    url.search = ""
    url.hash = ""
    return trimTrailingSlash(url.toString())
  } catch {
    return null
  }
}
