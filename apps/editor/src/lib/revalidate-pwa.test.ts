import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { revalidateCragPages, revalidateHomePage, revalidatePwa } from './revalidate-pwa'

const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_PWA_URL', 'http://localhost:4100')
  vi.stubEnv('REVALIDATE_SECRET', 'local-fixture-secret')
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset().mockResolvedValue(new Response('{}', { status: 200 }))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('bounded publication notification', () => {
  it('reports missing configuration without a request', async () => {
    vi.stubEnv('REVALIDATE_SECRET', '')
    expect(await revalidateHomePage()).toEqual({ ok: false, reason: 'not-configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('invalidates all locale home, crag and route pages before returning', async () => {
    let complete!: (response: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    let settled = false
    const pending = revalidateCragPages('fixture').then(result => { settled = true; return result })
    await Promise.resolve()
    expect(settled).toBe(false)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://localhost:4100/api/revalidate')
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual', cache: 'no-store' })
    expect(JSON.parse(String(init?.body)).paths).toEqual([
      '/zh/crag/fixture', '/en/crag/fixture', '/fr/crag/fixture',
      '/zh', '/en', '/fr', '/zh/route', '/en/route', '/fr/route',
    ])
    complete(new Response('{}', { status: 200 }))
    expect(await pending).toEqual({ ok: true })
  })

  it('uses the verified production canonical host and does not follow bearer redirects', async () => {
    vi.stubEnv('NEXT_PUBLIC_PWA_URL', 'https://bouldering.top')
    expect(await revalidateHomePage()).toEqual({ ok: true })
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://www.bouldering.top/api/revalidate')
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe('manual')
  })

  it.each([307, 401, 503])('reports HTTP %i without throwing away the committed save', async status => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status }))
    expect(await revalidateHomePage()).toEqual({ ok: false, reason: 'http', status })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports network failure as delayed publication', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network unavailable'))
    expect(await revalidateHomePage()).toEqual({ ok: false, reason: 'network' })
  })

  it('passes the three-second abort signal and reports expiry', async () => {
    const controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    fetchMock.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    const pending = revalidatePwa({ paths: [''] })
    expect(timeout).toHaveBeenCalledWith(3000)
    controller.abort(new DOMException('Fixture timeout', 'TimeoutError'))
    expect(await pending).toEqual({ ok: false, reason: 'timeout' })
  })
})
