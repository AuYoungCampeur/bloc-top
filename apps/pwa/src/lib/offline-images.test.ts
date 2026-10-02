import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prefetchImages } from './offline-storage'
const bodies = new Map<string, Response>()
const image = () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } })
const cache = { match: vi.fn(async (url: string) => bodies.get(url)?.clone()), put: vi.fn(async (url: string, response: Response) => { bodies.set(url, response.clone()) }) }
const originalFetch = globalThis.fetch
const originalCaches = globalThis.caches
const originalBitmap = globalThis.createImageBitmap
describe('verified image downloads', () => {
  beforeEach(() => {
    bodies.clear(); vi.clearAllMocks()
    vi.stubGlobal('caches', { open: vi.fn().mockResolvedValue(cache) })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(image()))
    // Unit tests model the browser decoder; actual PNG decode is covered by the SW fixture browser check.
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 2, height: 2, close: vi.fn() }))
  })
  afterEach(() => { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; globalThis.createImageBitmap = originalBitmap })
  it('counts failures accurately, retains successes and retries only missing images', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(image()).mockRejectedValueOnce(new TypeError('network'))
    const progress = vi.fn()
    expect(await prefetchImages(['a', 'b'], progress)).toMatchObject({ cached: 1, processed: 2, total: 2, failedUrls: ['b'] })
    expect(progress.mock.lastCall?.[0].cached).toBe(1)
    vi.mocked(fetch).mockClear().mockResolvedValue(image())
    expect(await prefetchImages(['a', 'b', 'b'])).toMatchObject({ cached: 2, total: 2, failedUrls: [] })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('b', { mode: 'cors', credentials: 'omit', cache: 'no-store', signal: expect.any(AbortSignal) })
  })
  it.each(['opaque', '404', 'html', 'corrupt', 'quota'])('never counts %s as verified offline media', async mode => {
    const response = mode === '404' ? new Response('missing', { status: 404 }) : mode === 'html' ? new Response('oops', { headers: { 'Content-Type': 'text/html' } }) : image()
    if (mode === 'opaque') Object.defineProperty(response, 'type', { value: 'opaque' })
    if (mode === 'corrupt') vi.mocked(createImageBitmap).mockRejectedValue(new Error('decode'))
    if (mode === 'quota') cache.put.mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'))
    vi.mocked(fetch).mockResolvedValue(response)
    expect(await prefetchImages(['a'])).toMatchObject({ cached: 0, processed: 1, failedUrls: ['a'] })
  })
  it('replaces an unreadable old cached body rather than trapping every retry', async () => {
    bodies.set('a', image())
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('old corrupt body')).mockResolvedValue({ width: 2, height: 2, close: vi.fn() } as unknown as ImageBitmap)
    expect(await prefetchImages(['a'])).toMatchObject({ cached: 1, failedUrls: [] })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
