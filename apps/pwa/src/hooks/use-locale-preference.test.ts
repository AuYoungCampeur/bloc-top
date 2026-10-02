import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useLocalePreference } from './use-locale-preference'
const state = vi.hoisted(() => ({ replace: vi.fn(), pathname: '/route' }))
const replace = state.replace
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ replace }), usePathname: () => state.pathname }))
const originalFetch = globalThis.fetch
describe('locale navigation preserves deep-link context', () => {
  beforeEach(() => {
    localStorage.clear(); sessionStorage.clear(); replace.mockClear(); state.pathname = '/route'
    window.history.replaceState(null, '', '/zh/route?crag=yuan-tong-si&city=xiamen#topo')
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ province: '福建' })))
  })
  afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks() })
  it('retains query/hash when the user changes language', () => {
    sessionStorage.setItem('locale-detected', 'true')
    const { result } = renderHook(() => useLocalePreference())
    act(() => result.current.switchLocale('fr'))
    expect(replace).toHaveBeenCalledWith('/route?crag=yuan-tong-si&city=xiamen#topo', { locale: 'fr' })
  })
  it('retains query/hash when applying a stored language', () => {
    localStorage.setItem('preferred-locale', 'fr')
    renderHook(() => useLocalePreference())
    expect(replace).toHaveBeenCalledWith('/route?crag=yuan-tong-si&city=xiamen#topo', { locale: 'fr' })
  })
  it('retains query/hash when online location detection changes language', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({}))
    renderHook(() => useLocalePreference())
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/route?crag=yuan-tong-si&city=xiamen#topo', { locale: 'en' }))
  })
  it('does not fetch geo or redirect an offline cold start even if cached preference differs', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    localStorage.setItem('preferred-locale', 'fr')
    renderHook(() => useLocalePreference())
    expect(fetch).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })
  it('ignores a late geo response after navigation and starts detection for the new pathname', async () => {
    let finishOld!: (response: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve })).mockResolvedValueOnce(Response.json({}))
    const { rerender } = renderHook(() => useLocalePreference())
    state.pathname = '/other'
    window.history.replaceState(null, '', '/zh/other?crag=other#new')
    rerender()
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/other?crag=other#new', { locale: 'en' }))
    await act(async () => finishOld(Response.json({})))
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(replace).toHaveBeenCalledTimes(1)
  })
  it('ignores geo resolution after unmount', async () => {
    let finish!: (response: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const { unmount } = renderHook(() => useLocalePreference())
    unmount()
    await act(async () => finish(Response.json({})))
    expect(replace).not.toHaveBeenCalled()
    expect(localStorage.getItem('preferred-locale')).toBeNull()
  })
  it('continues detection/navigation when preference storage is blocked', async () => {
    for (const storage of [localStorage, sessionStorage]) {
      vi.spyOn(storage, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
      vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
    }
    vi.mocked(fetch).mockResolvedValue(Response.json({}))
    renderHook(() => useLocalePreference())
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/route?crag=yuan-tong-si&city=xiamen#topo', { locale: 'en' }))
  })

})
