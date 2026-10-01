import { describe, expect, it, vi } from 'vitest'
import { cleanupLegacyApiCaches, getApiCachePolicy, isCacheablePublicApiResponse } from './sw-cache-policy'

const origin = 'https://www.bouldering.top'

function policy(path: string, init?: RequestInit, sameOrigin = true) {
  const request = new Request(new URL(path, origin), init)
  return getApiCachePolicy({ request, url: new URL(request.url), sameOrigin })
}

describe('Service Worker API cache policy', () => {
  it.each([
    '/api/weather?adcode=350123',
    '/api/cities',
    '/api/prefectures',
    '/api/crags?cityId=luoyuan',
    '/api/crags/luoyuan',
    '/api/crags/luoyuan/routes',
    '/api/crags/luoyuan/version',
    '/api/routes/39',
    '/api/mobile/sync',
  ])('allows reviewed public GET endpoint %s', path => {
    expect(policy(path)).toBe('public')
  })

  it.each([
    '/api/auth/get-session',
    '/api/auth/magic-link/verify?token=secret',
    '/api/auth/set-password',
    '/api/editor/crags',
    '/api/user/avatar',
    '/api/user/avatar/user-id',
    '/api/crag-permissions',
    '/api/faces?cragId=luoyuan',
    '/api/geo',
    '/api/beta?routeId=39',
    '/api/crags/luoyuan/permissions',
    '/api/crags/luoyuan/version/extra',
    '/api/routes/39/private',
    '/api/new-endpoint',
    '/api',
  ])('always sends private, fresh or unknown API %s to the network', path => {
    expect(policy(path)).toBe('network-only')
  })

  it('does not cache another origin, mutations, authorization headers or explicit fresh requests', () => {
    expect(policy('/api/weather', undefined, false)).toBe('network-only')
    expect(policy('/api/cities', { method: 'POST' })).toBe('network-only')
    expect(policy('/api/cities', { headers: { Authorization: 'Bearer test' } })).toBe('network-only')
    expect(policy('/api/weather', { cache: 'no-store' })).toBe('network-only')
    expect(policy('/api/weather', { cache: 'no-cache' })).toBe('network-only')
  })

  it('leaves documents and assets to their existing strategies', () => {
    expect(policy('/zh/route')).toBe('not-api')
    expect(policy('/_next/static/app.js')).toBe('not-api')
    expect(policy('/apiary')).toBe('not-api')
  })
})

describe('public API response cacheability', () => {
  it('caches only successful public responses', () => {
    expect(isCacheablePublicApiResponse(new Response('{}'))).toBe(true)
    expect(isCacheablePublicApiResponse(new Response('{}', {
      headers: { 'Cache-Control': 'public, max-age=300' },
    }))).toBe(true)
    expect(isCacheablePublicApiResponse(new Response('{}', { status: 401 }))).toBe(false)
    expect(isCacheablePublicApiResponse(new Response('{}', { status: 500 }))).toBe(false)
  })

  it.each([
    ['Cache-Control', 'private, max-age=0'],
    ['Cache-Control', 'public, NO-STORE'],
    ['Cache-Control', 'no-cache="Set-Cookie"'],
    ['Vary', 'Accept-Encoding, Cookie'],
    ['Vary', 'Authorization'],
    ['Vary', '*'],
  ])('respects private/freshness response header %s: %s', (name, value) => {
    expect(isCacheablePublicApiResponse(new Response('{}', { headers: { [name]: value } }))).toBe(false)
  })
})

describe('Service Worker activation migration', () => {
  it('removes old API caches and stray private responses while preserving public and offline content', async () => {
    const entries = new Map<string, Set<string>>([
      ['api-data', new Set([`${origin}/api/auth/get-session`])],
      ['apis', new Set([`${origin}/api/beta?routeId=39`])],
      ['public-api-v1', new Set([`${origin}/api/weather`, `${origin}/api/crag-permissions`])],
      ['html-pages', new Set([`${origin}/api/auth/get-session`, `${origin}/zh/route`])],
      ['static-image-assets', new Set([`${origin}/api/user/avatar/u1`, `${origin}/logo.png`])],
      ['offline-crag-images', new Set(['https://img.bouldering.top/luoyuan/face.jpg'])],
    ])
    const cacheStorage = {
      keys: vi.fn(async () => [...entries.keys()]),
      delete: vi.fn(async (name: string) => entries.delete(name)),
      open: vi.fn(async (name: string) => ({
        keys: async () => [...entries.get(name)!].map(url => new Request(url)),
        delete: async (request: Request) => entries.get(name)!.delete(request.url),
      } as unknown as Cache)),
    }

    await cleanupLegacyApiCaches(cacheStorage, 'public-api-v1', origin)

    expect([...entries.keys()]).not.toContain('api-data')
    expect([...entries.keys()]).not.toContain('apis')
    expect([...entries.get('public-api-v1')!]).toEqual([`${origin}/api/weather`])
    expect([...entries.get('html-pages')!]).toEqual([`${origin}/zh/route`])
    expect([...entries.get('static-image-assets')!]).toEqual([`${origin}/logo.png`])
    expect([...entries.get('offline-crag-images')!]).toEqual(['https://img.bouldering.top/luoyuan/face.jpg'])

    await cleanupLegacyApiCaches(cacheStorage, 'public-api-v1', origin)
    expect(cacheStorage.delete).toHaveBeenCalledTimes(2)
  })
})
