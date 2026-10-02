import { beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadOfflineSnapshot } from './offline-download'
import { prefetchImages, saveCragOffline, OfflineDBBlockedError } from './offline-storage'
vi.mock('./offline-storage', () => ({ prefetchImages: vi.fn(), saveCragOffline: vi.fn(), isOfflineQuotaError: (error: Error) => error.name === 'QuotaExceededError', OfflineDBBlockedError: class OfflineDBBlockedError extends Error {} }))
const snapshot = { schemaVersion: 2, revision: 'new', crag: { id: 'fixture' }, routes: [{ id: 1, description: '完整描述', setter: '开线者' }], images: [{ sourceUrl: 'https://example.com/a', cacheUrl: 'https://example.com/a?offlineRevision=new' }] }
describe('offline snapshot publication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: true, snapshot })))
    vi.mocked(prefetchImages).mockResolvedValue({ cached: 1, processed: 1, total: 1, failedUrls: [] })
    vi.mocked(saveCragOffline).mockResolvedValue()
  })
  it('publishes complete server data only after verified media', async () => {
    const progress = vi.fn()
    const data = await downloadOfflineSnapshot('fixture', progress)
    expect(prefetchImages).toHaveBeenCalledWith([snapshot.images[0].cacheUrl], progress, expect.any(AbortSignal))
    expect(data.routes[0]).toMatchObject({ description: '完整描述', setter: '开线者' })
    expect(saveCragOffline).toHaveBeenCalledWith(data)
    expect(vi.mocked(prefetchImages).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(saveCragOffline).mock.invocationCallOrder[0])
  })
  it('does not replace a previous snapshot when any image fails', async () => {
    vi.mocked(prefetchImages).mockResolvedValue({ cached: 0, processed: 1, total: 1, failedUrls: ['failed'] })
    await expect(downloadOfflineSnapshot('fixture', vi.fn())).rejects.toMatchObject({ reason: 'images', result: { cached: 0 } })
    expect(saveCragOffline).not.toHaveBeenCalled()
  })
  it('does not report completion on IDB quota or commit failure', async () => {
    vi.mocked(saveCragOffline).mockRejectedValue(new DOMException('full', 'QuotaExceededError'))
    await expect(downloadOfflineSnapshot('fixture', vi.fn())).rejects.toMatchObject({ reason: 'quota' })
  })
  it('reports an upgrade blocked by another tab rather than advertising completion', async () => {
    vi.mocked(saveCragOffline).mockRejectedValue(new OfflineDBBlockedError())
    await expect(downloadOfflineSnapshot('fixture', vi.fn())).rejects.toMatchObject({ reason: 'db-blocked' })
  })
  it.each(['network', 'invalid'])('classifies %s snapshot failure without starting media', async mode => {
    if (mode === 'network') vi.mocked(fetch).mockRejectedValue(new TypeError('offline'))
    else vi.mocked(fetch).mockResolvedValue(Response.json({ success: true, snapshot: { ...snapshot, crag: { id: 'other' } } }))
    await expect(downloadOfflineSnapshot('fixture', vi.fn())).rejects.toMatchObject({ reason: 'snapshot' })
    expect(prefetchImages).not.toHaveBeenCalled()
    expect(saveCragOffline).not.toHaveBeenCalled()
  })
})
