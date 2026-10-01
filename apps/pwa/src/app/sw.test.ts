import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeCaching } from 'serwist'

const state = vi.hoisted(() => ({ runtimeCaching: [] as RuntimeCaching[] }))

vi.mock('@serwist/next/worker', () => ({
  defaultCache: [{
    matcher: () => true,
    handler: { name: 'default-cache' },
  }],
}))

vi.mock('serwist', () => {
  class Strategy {
    constructor(public options: unknown) {}
  }
  class NetworkFirst extends Strategy {}
  class NetworkOnly extends Strategy {}
  class CacheFirst extends Strategy {}
  class ExpirationPlugin extends Strategy {}
  class Serwist {
    constructor(options: { runtimeCaching: RuntimeCaching[] }) {
      state.runtimeCaching = options.runtimeCaching
    }
    addEventListeners() {}
  }
  return { Strategy, NetworkFirst, NetworkOnly, CacheFirst, ExpirationPlugin, Serwist }
})

describe('Service Worker runtime wiring', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('private APIs and Beta cannot fall through to HTML or Serwist default caches', async () => {
    vi.stubGlobal('self', {
      location: { origin: 'https://www.bouldering.top' },
      addEventListener: vi.fn(),
    })
    await import('./sw')

    for (const path of ['/api/auth/get-session', '/api/editor/crags', '/api/user/avatar/u1', '/api/crag-permissions', '/api/beta?routeId=39', '/api/future']) {
      // Even a document navigation to an API must avoid the HTML cache.
      const request = new Request(`https://www.bouldering.top${path}`)
      Object.defineProperty(request, 'destination', { value: 'document' })
      const context = { url: new URL(request.url), request, sameOrigin: true, event: {} as ExtendableEvent }
      const rule = state.runtimeCaching.find(rule => typeof rule.matcher === 'function' && rule.matcher(context))
      expect(rule?.handler.constructor.name).toBe('NetworkOnly')
      expect((rule?.handler as unknown as { options: RequestInit }).options).toEqual({ fetchOptions: { cache: 'no-store' } })
    }

    const request = new Request('https://www.bouldering.top/api/weather?adcode=350123')
    const context = { url: new URL(request.url), request, sameOrigin: true, event: {} as ExtendableEvent }
    const rule = state.runtimeCaching.find(rule => typeof rule.matcher === 'function' && rule.matcher(context))
    expect(rule?.handler.constructor.name).toBe('NetworkFirst')
  })

  it('waits for old API caches to be removed during activation', async () => {
    const listeners = new Map<string, (event: { waitUntil: (promise: Promise<void>) => void }) => void>()
    vi.stubGlobal('self', {
      location: { origin: 'https://www.bouldering.top' },
      addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
    })
    const cacheStorage = {
      keys: vi.fn(async () => ['api-data', 'apis']),
      delete: vi.fn(async () => true),
      open: vi.fn(),
    }
    vi.stubGlobal('caches', cacheStorage)
    await import('./sw')

    const waitUntil = vi.fn()
    listeners.get('activate')!({ waitUntil })
    expect(waitUntil).toHaveBeenCalledOnce()
    await waitUntil.mock.calls[0][0]
    expect(cacheStorage.delete).toHaveBeenCalledWith('api-data')
    expect(cacheStorage.delete).toHaveBeenCalledWith('apis')
    expect(cacheStorage.open).not.toHaveBeenCalled()
  })
})
