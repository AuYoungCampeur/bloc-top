import { afterEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { downloadOfflineSnapshot } from './offline-download'
import { closeDB, deleteCragOffline, getCragOffline, getMeta, saveCragOffline, type OfflineCragData } from './offline-storage'
import { withOfflineRequest } from './offline-lifecycle'
const originalFetch = globalThis.fetch
const originalCaches = globalThis.caches
const fixture: OfflineCragData = { cragId: 'lifecycle-fixture', crag: { id: 'lifecycle-fixture', name: 'Fixture', cityId: 'city', location: '', developmentTime: '', description: '', approach: '' }, routes: [], images: [], schemaVersion: 2, imageCount: 0, version: 'old', downloadedAt: '2026-01-01' }
afterEach(() => { closeDB(); globalThis.fetch = originalFetch; globalThis.caches = originalCaches; vi.useRealTimers() })
describe('same-tab download/delete lifecycle', () => {
  it('cancels pending real download service on delete, even if fetch ignores abort, and a late response cannot resurrect data', async () => {
    localStorage.clear(); closeDB()
    vi.stubGlobal('caches', { open: async () => ({ keys: async () => [], delete: async () => true }) })
    await saveCragOffline(fixture)
    let deliver!: (response: Response) => void
    let started!: () => void
    const fetching = new Promise<void>(resolve => { started = resolve })
    vi.stubGlobal('fetch', vi.fn(() => { started(); return new Promise<Response>(resolve => { deliver = resolve }) }))
    const download = downloadOfflineSnapshot(fixture.cragId, vi.fn())
    const failure = expect(download).rejects.toMatchObject({ reason: 'cancelled' })
    await fetching
    await deleteCragOffline(fixture.cragId)
    await failure
    expect(await getCragOffline(fixture.cragId)).toBeNull()
    deliver(Response.json({ success: true, snapshot: { schemaVersion: 2, revision: 'late', crag: fixture.crag, routes: [], images: [] } }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(await getCragOffline(fixture.cragId)).toBeNull()
    expect(getMeta().crags[fixture.cragId]).toBeUndefined()
  })
  it('bounds response/body wait even if the pending operation ignores the abort signal', async () => {
    vi.useFakeTimers()
    const request = withOfflineRequest(() => new Promise<never>(() => {}), undefined, 20)
    const failure = expect(request).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(20)
    await failure
  })
})
