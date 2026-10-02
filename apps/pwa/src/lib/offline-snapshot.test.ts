import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCragById, getRoutesByCragId } from '@/lib/db'
import { readOfflineSnapshot } from './offline-snapshot'
import type { Crag, Route } from '@/types'
vi.mock('@/lib/db', () => ({ getCragById: vi.fn(), getRoutesByCragId: vi.fn() }))
const crag: Crag = { id: 'fixture', name: 'Fixture', cityId: 'city', location: '', developmentTime: '', description: '介绍', approach: '接近', mediaRevision: 'one' }
const routes: Route[] = [{ id: 2, name: '二', grade: 'V2', cragId: 'fixture', area: '', description: '完整描述', setter: '开线者', betaLinks: [{ id: 'beta', platform: 'xiaohongshu', noteId: 'note', url: 'https://example.com' }] }, { id: 1, name: '一', grade: 'V1', cragId: 'fixture', area: '' }]
describe('complete offline snapshot revision', () => {
  beforeEach(() => { vi.mocked(getCragById).mockResolvedValue(crag); vi.mocked(getRoutesByCragId).mockResolvedValue(routes) })
  it('preserves full route data, excludes Beta and has stable ordering', async () => {
    const first = await readOfflineSnapshot('fixture')
    expect(first?.routes[1]).toMatchObject({ description: '完整描述', setter: '开线者' })
    expect(first?.routes[1]).not.toHaveProperty('betaLinks')
    vi.mocked(getRoutesByCragId).mockResolvedValue([...routes].reverse())
    expect((await readOfflineSnapshot('fixture'))?.revision).toBe(first?.revision)
  })
  it('detects edits, deletions and media-only changes', async () => {
    const initial = (await readOfflineSnapshot('fixture'))!.revision
    vi.mocked(getRoutesByCragId).mockResolvedValue(routes.map(route => ({ ...route, description: 'edited' })))
    expect((await readOfflineSnapshot('fixture'))?.revision).not.toBe(initial)
    vi.mocked(getRoutesByCragId).mockResolvedValue([routes[0]])
    expect((await readOfflineSnapshot('fixture'))?.revision).not.toBe(initial)
    vi.mocked(getRoutesByCragId).mockResolvedValue(routes)
    vi.mocked(getCragById).mockResolvedValue({ ...crag, mediaRevision: 'two' })
    expect((await readOfflineSnapshot('fixture'))?.revision).not.toBe(initial)
  })
  it('returns missing crag rather than publishing an empty success', async () => {
    vi.mocked(getCragById).mockResolvedValue(null)
    expect(await readOfflineSnapshot('missing')).toBeNull()
  })
})
