/** Returns the URL if it is an absolute http(s) URL, otherwise null. Use for every rendered href/src. */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const u = new URL(value.trim())
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

export function hostnameOf(value: unknown): string | null {
  const safe = safeHttpUrl(value)
  return safe ? new URL(safe).hostname.replace(/^www\./, '') : null
}

/** Comparable form of a recipe URL: no protocol, "www.", query, hash or trailing slash; lower-case host. */
export function sourceUrlKey(value: unknown): string | null {
  const safe = safeHttpUrl(value)
  if (!safe) return null
  const u = new URL(safe)
  let path = u.pathname
  try {
    path = decodeURI(path)
  } catch {
    /* keep the encoded form */
  }
  return `${u.hostname.replace(/^www\./, '').toLowerCase()}${path.replace(/\/+$/, '')}`
}
