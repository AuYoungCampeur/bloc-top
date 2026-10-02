/** Service Worker API caching is opt-in; new endpoints use the network by default. */
const PUBLIC_API_PATHS = new Set([
  '/api/weather',
  '/api/cities',
  '/api/prefectures',
  '/api/crags',
  '/api/mobile/sync',
])

const LEGACY_API_CACHE_NAMES = new Set(['api-data', 'apis'])

interface ApiRequestContext {
  url: URL
  request: Request
  sameOrigin: boolean
}

export type ApiCachePolicy = 'public' | 'network-only' | 'not-api'

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/')
}

function isPublicApiPath(pathname: string): boolean {
  return PUBLIC_API_PATHS.has(pathname)
    || /^\/api\/crags\/[^/]+(?:\/(?:routes|version))?$/.test(pathname)
    || /^\/api\/routes\/\d+$/.test(pathname)
}

export function getApiCachePolicy({ url, request, sameOrigin }: ApiRequestContext): ApiCachePolicy {
  if (!isApiPath(url.pathname)) return 'not-api'

  if (sameOrigin
    && request.method === 'GET'
    && request.cache !== 'no-store'
    && request.cache !== 'no-cache'
    && !request.headers.has('Authorization')
    && isPublicApiPath(url.pathname)) {
    return 'public'
  }

  // Includes auth, editor, user data, permissions, geo, Beta and unknown APIs.
  return 'network-only'
}

/** Respect response privacy/freshness directives even on an allowlisted endpoint. */
export function isCacheablePublicApiResponse(response: Response): boolean {
  if (response.status !== 200) return false

  const directives = (response.headers.get('Cache-Control') ?? '')
    .split(',')
    .map(value => value.trim().split('=')[0].toLowerCase())
  if (directives.some(value => ['no-store', 'no-cache', 'private'].includes(value))) return false

  const vary = (response.headers.get('Vary') ?? '')
    .split(',')
    .map(value => value.trim().toLowerCase())
  return !vary.some(value => ['*', 'cookie', 'authorization'].includes(value))
}

/** Remove old broad API caches and API entries captured by other runtime rules. */
export async function cleanupLegacyApiCaches(
  cacheStorage: Pick<CacheStorage, 'keys' | 'delete' | 'open'>,
  publicCacheName: string,
  origin: string,
): Promise<void> {
  const names = await cacheStorage.keys()
  await Promise.all(names.map(async name => {
    if (LEGACY_API_CACHE_NAMES.has(name)) {
      await cacheStorage.delete(name)
      return
    }

    const cache = await cacheStorage.open(name)
    const requests = await cache.keys()
    await Promise.all(requests.map(async request => {
      const url = new URL(request.url)
      if (!isApiPath(url.pathname)) return

      // Only the new public cache may retain explicitly public API entries.
      const isPublic = name === publicCacheName
        && getApiCachePolicy({ url, request, sameOrigin: url.origin === origin }) === 'public'
      if (!isPublic) await cache.delete(request)
    }))
  }))
}
