import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCragRoutes } from './use-crag-routes'

const navigation = vi.hoisted(() => ({ query: '', replace: vi.fn() }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.query),
  usePathname: () => '/routes',
  useRouter: () => ({ replace: navigation.replace }),
}))
const crags = [{ id: 'crag-a', name: 'A' }, { id: 'crag-b', name: 'B' }]
const response = (data: unknown, ok = true) => ({ ok, json: async () => data }) as Response

beforeEach(() => {
  vi.clearAllMocks()
  navigation.query = 'cragId=crag-b'
  navigation.replace.mockImplementation((url: string) => { navigation.query = url.split('?')[1] || '' })
  globalThis.fetch = vi.fn(async input => {
    if (input === '/api/editor/crags') return response({ crags, role: 'admin', canCreate: true })
    const id = String(input).includes('crag-a') ? 'crag-a' : 'crag-b'
    return response({ success: true, routes: [{ id: id === 'crag-a' ? 1 : 2, cragId: id, name: id, grade: 'V3', area: '主墙' }] })
  })
})

describe('管理页深链接岩场上下文', () => {
  it('按合法深链接选择 B，重建 hook/刷新仍选择 B，不选列表第一项', async () => {
    const first = renderHook(() => useCragRoutes({ editorMode: true }))
    await waitFor(() => expect(first.result.current.routes[0]?.cragId).toBe('crag-b'))
    expect(first.result.current.selectedCragId).toBe('crag-b')
    expect(fetch).not.toHaveBeenCalledWith('/api/crags/crag-a/routes')
    first.unmount()
    const second = renderHook(() => useCragRoutes({ editorMode: true }))
    await waitFor(() => expect(second.result.current.routes[0]?.cragId).toBe('crag-b'))
  })

  it('无权限/不存在的参数明确错误且零线路请求，不偷偷回退 A', async () => {
    navigation.query = 'cragId=forbidden'
    const { result } = renderHook(() => useCragRoutes({ editorMode: true }))
    await waitFor(() => expect(result.current.cragSelectionError).toContain('无权'))
    expect(result.current.selectedCragId).toBeNull()
    expect(result.current.routes).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('手动切换更新 URL、保留其他 query，拒绝未知岩场', async () => {
    navigation.query = 'cragId=crag-b&tab=beta'
    const { result, rerender } = renderHook(() => useCragRoutes({ editorMode: true }))
    await waitFor(() => expect(result.current.selectedCragId).toBe('crag-b'))
    act(() => result.current.setSelectedCragId('crag-a'))
    rerender()
    await waitFor(() => expect(result.current.routes[0]?.cragId).toBe('crag-a'))
    expect(navigation.replace).toHaveBeenCalledWith('/routes?cragId=crag-a&tab=beta', { scroll: false })
    act(() => result.current.setSelectedCragId('forbidden'))
    expect(result.current.selectedCragId).toBe('crag-a')
    expect(navigation.replace).toHaveBeenCalledTimes(1)
  })

  it('切换过程中立即隐藏旧记录，A 的迟到请求不能进入 B', async () => {
    navigation.query = 'cragId=crag-a'
    let resolveA!: (response: Response) => void
    vi.mocked(fetch).mockImplementation(async input => {
      if (input === '/api/editor/crags') return response({ crags })
      if (input === '/api/crags/crag-a/routes') return new Promise(resolve => { resolveA = resolve })
      return response({ success: true, routes: [{ id: 2, cragId: 'crag-b', name: 'B', grade: 'V3', area: '主墙' }] })
    })
    const { result, rerender } = renderHook(() => useCragRoutes({ editorMode: true }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/crags/crag-a/routes'))
    navigation.query = 'cragId=crag-b'
    rerender()
    await waitFor(() => expect(result.current.routes[0]?.cragId).toBe('crag-b'))
    await act(async () => resolveA(response({ routes: [{ id: 1, cragId: 'crag-a' }] })))
    expect(result.current.routes.map(route => route.cragId)).toEqual(['crag-b'])
  })

  it('岩场加载错误与缺权限区分，并可重新加载恢复深链接', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ error: '岩场服务暂不可用' }, false))
    const { result } = renderHook(() => useCragRoutes({ editorMode: true }))
    await waitFor(() => expect(result.current.cragSelectionError).toBe('岩场服务暂不可用'))
    expect(result.current.selectedCragId).toBeNull()
    act(() => result.current.reloadCrags())
    await waitFor(() => expect(result.current.routes[0]?.cragId).toBe('crag-b'))
    expect(result.current.cragSelectionError).toBeNull()
  })
})
