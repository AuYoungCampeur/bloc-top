const LOCALES = ['zh', 'en', 'fr'] as const
const TIMEOUT_MS = 3000

export type RevalidationResult = { ok: true } | {
  ok: false
  reason: 'not-configured' | 'http' | 'timeout' | 'network'
  status?: number
}

/** Await this bounded notification before completing a mutation response. */
export async function revalidatePwa(options: { paths?: string[]; tags?: string[] }): Promise<RevalidationResult> {
  const configuredUrl = process.env.NEXT_PUBLIC_PWA_URL
  const secret = process.env.REVALIDATE_SECRET
  if (!configuredUrl || !secret) {
    console.warn('[revalidate-pwa] Notification not configured')
    return { ok: false, reason: 'not-configured' }
  }
  const paths = options.paths?.flatMap(path => LOCALES.map(locale => `/${locale}${path}`)) ?? []
  try {
    const endpoint = new URL('/api/revalidate', configuredUrl)
    // The verified production apex redirects to www. Fetch would remove the
    // Bearer header across origins; send directly to the canonical host.
    if (endpoint.protocol === 'https:' && endpoint.hostname === 'bouldering.top' && !endpoint.port) {
      endpoint.hostname = 'www.bouldering.top'
    }
    const response = await fetch(endpoint, {
      method: 'POST', redirect: 'manual', cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ paths, tags: options.tags }),
    })
    if (!response.ok) {
      console.error('[revalidate-pwa] Notification rejected:', response.status)
      return { ok: false, reason: 'http', status: response.status }
    }
    return { ok: true }
  } catch (error) {
    const name = error !== null && typeof error === 'object' && 'name' in error ? error.name : undefined
    const reason = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network'
    console.error('[revalidate-pwa] Notification failed:', reason)
    return { ok: false, reason }
  }
}

export function revalidateCragPages(cragId: string) {
  return revalidatePwa({ paths: [`/crag/${cragId}`, '', '/route'] })
}

export function revalidateHomePage() {
  return revalidatePwa({ paths: [''] })
}
