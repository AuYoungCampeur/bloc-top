import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { closeDB, deleteCragOffline, getAllOfflineCrags, getCragOffline, getMeta, OFFLINE_META_EVENT, saveCragOffline, updateStaleness, getStaleInfo, type OfflineCragData } from './offline-storage'
const first = 'https://img.bouldering.top/cleanup-fixture/a.jpg?offlineRevision=one'
const next = 'https://img.bouldering.top/cleanup-fixture/a.jpg?offlineRevision=two'
const partial = 'https://img.bouldering.top/cleanup-fixture/b.jpg?offlineRevision=failed'
const bodies = new Set<string>()
const cache = { keys: vi.fn(async () => [...bodies].map(url => new Request(url))), delete: vi.fn(async (url: string) => bodies.delete(url)) }
const originalCaches = globalThis.caches
function data(version = 'one'): OfflineCragData {
  return { cragId: 'cleanup-fixture', crag: { id: 'cleanup-fixture', name: 'Fixture', cityId: 'city', location: '', developmentTime: '', description: '', approach: '' }, routes: [], version, schemaVersion: 2, images: [{ sourceUrl: first, cacheUrl: version === 'one' ? first : next }], imageCount: 1, downloadedAt: '2026-01-01' }
}
describe('offline commit, cleanup and same-tab state', () => {
  beforeEach(() => { closeDB(); localStorage.clear(); bodies.clear(); vi.clearAllMocks(); vi.stubGlobal('caches', { open: vi.fn().mockResolvedValue(cache) }) })
  afterEach(() => { closeDB(); globalThis.caches = originalCaches; vi.restoreAllMocks() })
  it('deletes snapshot, complete/partial media and metadata through one entry point', async () => {
    const listener = vi.fn(); window.addEventListener(OFFLINE_META_EVENT, listener)
    bodies.add(first); bodies.add(partial)
    await saveCragOffline(data())
    expect(listener).toHaveBeenCalled()
    await deleteCragOffline('cleanup-fixture')
    expect(await getCragOffline('cleanup-fixture')).toBeNull()
    expect(getMeta().crags['cleanup-fixture']).toBeUndefined()
    expect(bodies.size).toBe(0)
    window.removeEventListener(OFFLINE_META_EVENT, listener)
  })
  it('records failed media cleanup durably and retries it on the next offline read', async () => {
    bodies.add(first)
    await saveCragOffline(data())
    cache.delete.mockRejectedValueOnce(new Error('cache unavailable'))
    await expect(deleteCragOffline('cleanup-fixture')).rejects.toThrow('cache unavailable')
    expect(await getCragOffline('cleanup-fixture')).toBeNull()
    expect(getMeta().crags['cleanup-fixture']).toBeUndefined()
    expect(bodies.has(first)).toBe(true)
    await getAllOfflineCrags()
    expect(bodies.has(first)).toBe(false)
  })
  it('cleans obsolete media after publishing the replacement and detects same-count edits/deletions', async () => {
    bodies.add(first); bodies.add(next)
    await saveCragOffline(data())
    await saveCragOffline(data('two'))
    await getAllOfflineCrags()
    expect(bodies.has(first)).toBe(false)
    expect(bodies.has(next)).toBe(true)
    updateStaleness('cleanup-fixture', 0, 'three')
    expect(getStaleInfo('cleanup-fixture')).toEqual({ isStale: true, newRouteCount: 0 })
    updateStaleness('cleanup-fixture', 0, 'deleted')
    expect(getStaleInfo('cleanup-fixture')?.isStale).toBe(true)
  })
  it('preserves cleanup work appended while a prior delete is waiting, and protects current media', async () => {
    bodies.add(first); bodies.add(next); bodies.add(partial)
    await saveCragOffline(data())
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    let started!: () => void
    const deleting = new Promise<void>(resolve => { started = resolve })
    cache.delete.mockImplementationOnce(async (url: string) => { started(); await pending; return bodies.delete(url) })
    await saveCragOffline(data('two'))
    await deleting
    await saveCragOffline({ ...data('three'), images: [{ sourceUrl: partial, cacheUrl: partial }] })
    release()
    await getAllOfflineCrags()
    expect(bodies.has(first)).toBe(false)
    expect(bodies.has(next)).toBe(false)
    expect(bodies.has(partial)).toBe(true)
    expect((await getCragOffline('cleanup-fixture'))?.version).toBe('three')
  })

  it('rebuilds missing fast metadata from the durable snapshot on reload', async () => {
    await saveCragOffline(data())
    localStorage.clear()
    closeDB()
    expect(getMeta().crags['cleanup-fixture']).toBeUndefined()
    await getAllOfflineCrags()
    expect(getMeta().crags['cleanup-fixture'].revision).toBe('one')
  })

  it('preserves committed availability in this tab if localStorage writes are blocked', async () => {
    await saveCragOffline(data('two'))
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    await saveCragOffline(data())
    expect(getMeta().crags['cleanup-fixture'].revision).toBe('one')
    expect((await getCragOffline('cleanup-fixture'))?.version).toBe('one')
  })
})
