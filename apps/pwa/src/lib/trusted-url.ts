/** Use the same trusted origins as the authentication server for every login method. */
export function isTrustedCallbackURL(url: string, trustedOrigins: readonly string[]): boolean {
  if (!url || typeof url !== 'string' || /[\u0000-\u0020\u007f]/.test(url)) return false
  try {
    // Relative callbacks must remain relative after browser URL normalization.
    if (url.startsWith('/')) {
      const base = 'https://callback.invalid'
      return !url.startsWith('//') && new URL(url, base).origin === base
    }
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol)
      && !parsed.username && !parsed.password
      && trustedOrigins.includes(parsed.origin)
  } catch {
    return false
  }
}
