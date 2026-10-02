import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFreshCragContent, ONLINE_CONTENT_TIMEOUT_MS } from './online-crag-content'

const crag = (id: string, mediaRevision: string) => ({ id, mediaRevision, name: id })
const route = (cragId: string, topoVersion: number) => ({ id: 1, cragId, topoVersion })
const json = (value: unknown) => ({ ok: true, json: async () => ({ success: true, ...value as object }) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('fresh complete online reading data', () => {
  it('deduplicates the same crag and binds new media and topo in one result', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ crag: crag('a', 'two') }))
      .mockResolvedValueOnce(json({ routes: [route('a', 2)] }))
      .mockResolvedValueOnce(json({ crag: crag('a', 'two') }))
    vi.stubGlobal('fetch', fetcher)
    const first = readFreshCragContent('a')
    expect(readFreshCragContent('a')).toBe(first)
    expect(await first).toMatchObject({ crag: { mediaRevision: 'two' }, routes: [{ topoVersion: 2 }] })
    expect(fetcher).toHaveBeenCalledTimes(3)
    for (const [url, options] of fetcher.mock.calls) {
      expect(url).toContain('?fresh=')
      expect(options.cache).toBe('no-store')
    }
    expect(new Set(fetcher.mock.calls.map(([url]) => url)).size).toBe(3)
  })

  it('retries a revision change during reading without publishing the mismatched routes', async () => {
    const fetcher = vi.fn()
    for (const value of [{ crag: crag('fence', 'one') }, { routes: [route('fence', 1)] }, { crag: crag('fence', 'two') },
      { crag: crag('fence', 'two') }, { routes: [route('fence', 2)] }, { crag: crag('fence', 'two') }]) {
      fetcher.mockResolvedValueOnce(json(value))
    }
    vi.stubGlobal('fetch', fetcher)
    expect(await readFreshCragContent('fence')).toMatchObject({ crag: { mediaRevision: 'two' }, routes: [{ topoVersion: 2 }] })
    expect(fetcher).toHaveBeenCalledTimes(6)
  })

  it('rejects continuously changing metadata', async () => {
    let sequence = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => json(url.includes('/routes')
      ? { routes: [route('moving', 1)] } : { crag: crag('moving', String(sequence++)) })))
    await expect(readFreshCragContent('moving')).rejects.toThrow('changed during reading')
  })

  it('isolates concurrent crags and rejects wrong-crag route data', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const id = url.includes('/isolate-a') ? 'isolate-a' : 'isolate-b'
      return json(url.includes('/routes') ? { routes: [route(id, id === 'isolate-a' ? 1 : 2)] } : { crag: crag(id, id) })
    }))
    const [a, b] = await Promise.all([readFreshCragContent('isolate-a'), readFreshCragContent('isolate-b')])
    expect(a.crag.mediaRevision).toBe('isolate-a'); expect(b.routes[0].topoVersion).toBe(2)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => json(url.includes('/routes')
      ? { routes: [route('another', 3)] } : { crag: crag('wrong', 'one') })))
    await expect(readFreshCragContent('wrong')).rejects.toThrow('another crag')
  })

  it('bounds a stalled JSON body and releases the in-flight request for retry', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) })
    vi.stubGlobal('fetch', fetcher)
    const operation = readFreshCragContent('timeout')
    const rejection = expect(operation).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(ONLINE_CONTENT_TIMEOUT_MS)
    await rejection
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
    fetcher.mockImplementation(async (url: string) => json(url.includes('/routes')
      ? { routes: [route('timeout', 2)] } : { crag: crag('timeout', 'two') }))
    expect((await readFreshCragContent('timeout')).crag.mediaRevision).toBe('two')
  })

  it('does not require a media change to read a new Topo version', async () => {
    let version = 1
    vi.stubGlobal('fetch', vi.fn(async (url: string) => json(url.includes('/routes')
      ? { routes: [route('topo', version)] } : { crag: crag('topo', 'same') })))
    expect((await readFreshCragContent('topo')).routes[0].topoVersion).toBe(1)
    version = 2
    expect((await readFreshCragContent('topo')).routes[0].topoVersion).toBe(2)
  })

  it('newer SSR data can supersede a read that began earlier without being joined to its stale promise', async () => {
    let release!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    let calls = 0
    const fetcher = vi.fn(async (url: string) => {
      const call = ++calls
      if (call === 3) return { ok: true, json: async () => { await blocked; return { success: true, crag: crag('supersede', 'two') } } }
      return json(url.includes('/routes') ? { routes: [route('supersede', call <= 3 ? 2 : 3)] }
        : { crag: crag('supersede', call <= 3 ? 'two' : 'three') })
    })
    vi.stubGlobal('fetch', fetcher)
    const old = readFreshCragContent('supersede')
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    const fresh = readFreshCragContent('supersede', true)
    expect(fresh).not.toBe(old)
    expect(readFreshCragContent('supersede')).toBe(fresh)
    expect((await fresh).crag.mediaRevision).toBe('three')
    release()
    expect((await old).crag.mediaRevision).toBe('two')
  })
})
