import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRouteCreation } from './use-route-creation'
import { PUBLISHING_DELAY_MESSAGE } from '@/lib/publishing-feedback'

const toast = vi.hoisted(() => vi.fn())
vi.mock('@bloctop/ui/components/toast', () => ({
  useToast: () => ({ showToast: toast }),
}))
vi.mock('@/lib/route-validation', async () => {
  const actual = await vi.importActual('@/lib/route-validation')
  return actual
})

function setup(overrides = {}) {
  const defaults = {
    selectedCragId: 'test-crag',
    selectedArea: '主墙',
    areas: ['主墙', '副墙'],
    setRoutes: vi.fn(),
    persistedAreas: ['主墙'],
    updateCragAreas: vi.fn().mockResolvedValue(undefined),
    hasUnsavedChanges: vi.fn().mockReturnValue(false),
  }
  return renderHook(() => useRouteCreation({ ...defaults, ...overrides }))
}

describe('useRouteCreation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('初始状态 isCreatingRoute = false', () => {
    const { result } = setup()
    expect(result.current.isCreatingRoute).toBe(false)
  })

  it('有未保存更改时 handleStartCreate 返回 false', () => {
    const { result } = setup({ hasUnsavedChanges: () => true })
    let started: boolean
    act(() => { started = result.current.handleStartCreate() })
    expect(started!).toBe(false)
    expect(result.current.isCreatingRoute).toBe(false)
  })

  it('无未保存更改时 handleStartCreate 开启创建模式', () => {
    const { result } = setup()
    let started: boolean
    act(() => { started = result.current.handleStartCreate() })
    expect(started!).toBe(true)
    expect(result.current.isCreatingRoute).toBe(true)
    expect(result.current.newRoute.area).toBe('主墙')
  })

  it('handleCancelCreate 关闭创建模式', () => {
    const { result } = setup()
    act(() => { result.current.handleStartCreate() })
    act(() => { result.current.handleCancelCreate() })
    expect(result.current.isCreatingRoute).toBe(false)
  })

  it('handleSubmitCreate 校验空名称', async () => {
    const { result } = setup()
    act(() => { result.current.handleStartCreate() })

    let created: unknown
    await act(async () => { created = await result.current.handleSubmitCreate() })
    expect(created).toBeNull()
    expect(result.current.formErrors.name).toBeDefined()
  })

  it('handleSubmitCreate 成功创建线路', async () => {
    const setRoutes = vi.fn()
    const mockCreated = { id: 99, name: '新线路', grade: 'V2', area: '主墙', cragId: 'test-crag' }
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ route: mockCreated }),
    })

    const { result } = setup({ setRoutes })
    act(() => { result.current.handleStartCreate() })
    act(() => {
      result.current.setNewRoute(prev => ({ ...prev, name: '新线路', area: '主墙' }))
    })

    let created: unknown
    await act(async () => { created = await result.current.handleSubmitCreate() })
    expect(created).toEqual(mockCreated)
    expect(setRoutes).toHaveBeenCalled()
    expect(result.current.isCreatingRoute).toBe(false)
  })

  it('通知延迟仍完成创建并加入权威记录，提示延迟且不再次POST', async () => {
    const setRoutes = vi.fn()
    const created = { id: 99, name: '新线路', grade: 'V2', area: '主墙', cragId: 'test-crag' }
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ route: created, refreshPending: true }) })
    const { result } = setup({ setRoutes })
    act(() => result.current.handleStartCreate())
    act(() => result.current.setNewRoute(prev => ({ ...prev, name: '新线路' })))
    await act(async () => { expect(await result.current.handleSubmitCreate()).toEqual(created) })
    expect(setRoutes.mock.calls[0][0]([])).toEqual([created])
    expect(result.current.isCreatingRoute).toBe(false)
    expect(toast).toHaveBeenCalledWith(PUBLISHING_DELAY_MESSAGE, 'info', 8000)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
