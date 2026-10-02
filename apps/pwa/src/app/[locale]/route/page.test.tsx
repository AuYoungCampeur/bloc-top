import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cookies } from 'next/headers'
import * as db from '@/lib/db'
import RouteListPage from './page'
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
vi.mock('@/lib/db', () => ({ getAllCities: vi.fn(), getAllPrefectures: vi.fn(), getCragById: vi.fn(), getCragsByCityId: vi.fn(), getRoutesByCityId: vi.fn(), getCragsByPrefectureId: vi.fn(), getRoutesByPrefectureId: vi.fn() }))
vi.mock('./route-client', () => ({ default: () => null }))
describe('route deep-link data scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: 'luoyuan' }) } as unknown as Awaited<ReturnType<typeof cookies>>)
    vi.mocked(db.getAllCities).mockResolvedValue([{ id: 'luoyuan' }, { id: 'xiamen' }] as Awaited<ReturnType<typeof db.getAllCities>>)
    vi.mocked(db.getAllPrefectures).mockResolvedValue([])
    vi.mocked(db.getCragById).mockResolvedValue({ id: 'yuan-tong-si', cityId: 'xiamen' } as Awaited<ReturnType<typeof db.getCragById>>)
    vi.mocked(db.getCragsByCityId).mockResolvedValue([])
    vi.mocked(db.getRoutesByCityId).mockResolvedValue([])
  })
  it('uses valid crag city before URL city and cookie, and retains context on filter changes', async () => {
    const result = await RouteListPage({ searchParams: Promise.resolve({ crag: 'yuan-tong-si', city: 'luoyuan' }) })
    expect(db.getRoutesByCityId).toHaveBeenCalledWith('xiamen')
    expect(result.props.contextCityId).toBe('xiamen')
  })
  it('uses explicit city before cookie', async () => {
    await RouteListPage({ searchParams: Promise.resolve({ city: 'xiamen' }) })
    expect(db.getCragsByCityId).toHaveBeenCalledWith('xiamen')
  })
  it('uses cookie when no deep-link context is supplied', async () => {
    await RouteListPage({ searchParams: Promise.resolve({}) })
    expect(db.getRoutesByCityId).toHaveBeenCalledWith('luoyuan')
  })
  it('rejects missing crags and invalid cities instead of silently displaying zero routes', async () => {
    vi.mocked(db.getCragById).mockResolvedValue(null)
    await expect(RouteListPage({ searchParams: Promise.resolve({ crag: 'missing' }) })).rejects.toThrow('NOT_FOUND')
    await expect(RouteListPage({ searchParams: Promise.resolve({ city: 'missing' }) })).rejects.toThrow('NOT_FOUND')
    expect(db.getRoutesByCityId).not.toHaveBeenCalled()
  })
})
