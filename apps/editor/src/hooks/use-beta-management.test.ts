import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useState } from 'react'
import type { Route, BetaLink } from '@bloctop/shared/types'
import { useBetaManagement } from './use-beta-management'

const showToast = vi.fn()
vi.mock('@bloctop/ui/components/toast', () => ({
  useToast: () => ({ showToast }),
}))

const mockBeta: BetaLink = {
  id: 'beta-1', platform: 'xiaohongshu', noteId: 'note-123',
  url: 'https://www.xiaohongshu.com/explore/note-123',
  title: '爬法视频', author: '张三', climberHeight: 170, climberReach: 175,
  createdAt: new Date('2026-10-02T10:00:00Z'),
}

const mockRoute: Route = {
  id: 42, name: '圆通测试路线', grade: 'V5',
  cragId: 'yuan-tong-si', area: '主墙', betaLinks: [mockBeta],
}

function setup() {
  return renderHook(() => {
    const [routes, setRoutes] = useState<Route[]>([
      mockRoute, { ...mockRoute, id: 99, name: '其他线路' },
    ])
    const management = useBetaManagement({ setRoutes })
    return { routes, management }
  })
}

describe('useBetaManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.fetch = vi.fn()
  })

  it('提交成功事件更新目标线路，同一事件重复到达不会重复追加', () => {
    const { result } = setup()
    const newBeta = { ...mockBeta, id: 'beta-2', noteId: 'note-2' }
    act(() => result.current.management.handleBetaAdded(mockRoute.id, newBeta))
    act(() => result.current.management.handleBetaAdded(mockRoute.id, newBeta))
    expect(result.current.routes[0].betaLinks).toEqual([mockBeta, newBeta])
    expect(result.current.routes[1].betaLinks).toEqual([mockBeta])
  })

  it('保存采用服务器 Beta 记录，并只更新对应线路', async () => {
    const savedBeta = { ...mockBeta, title: '服务端规范化标题', author: '李四', climberHeight: 175, climberReach: 180 }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true, json: async () => ({ success: true, beta: savedBeta }),
    } as Response)
    const { result } = setup()
    act(() => result.current.management.handleStartEdit(mockBeta))
    act(() => result.current.management.setEditForm({
      title: ' 新标题 ', author: ' 李四 ', climberHeight: '175', climberReach: '180',
    }))

    await act(async () => result.current.management.handleSaveBeta(mockBeta.id, mockRoute))

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/beta')
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(init?.body as string)).toEqual({
      routeId: 42, betaId: 'beta-1', title: '新标题', author: '李四', climberHeight: 175, climberReach: 180,
    })
    expect(result.current.routes[0].betaLinks?.[0]).toEqual(savedBeta)
    expect(result.current.routes[1].betaLinks?.[0]).toEqual(mockBeta)
    expect(result.current.management.editingBetaId).toBeNull()
  })

  it('空输入明确提交 null，并采用服务器清空后的记录', async () => {
    const clearedBeta: BetaLink = {
      id: mockBeta.id, platform: mockBeta.platform, noteId: mockBeta.noteId,
      url: mockBeta.url, createdAt: mockBeta.createdAt,
    }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true, json: async () => ({ success: true, beta: clearedBeta }),
    } as Response)
    const { result } = setup()
    act(() => result.current.management.handleStartEdit(mockBeta))
    act(() => result.current.management.setEditForm({
      title: ' ', author: '', climberHeight: '', climberReach: ' ',
    }))

    await act(async () => result.current.management.handleSaveBeta(mockBeta.id, mockRoute))

    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toEqual({
      routeId: 42, betaId: 'beta-1', title: null, author: null, climberHeight: null, climberReach: null,
    })
    expect(result.current.routes[0].betaLinks?.[0]).toEqual(clearedBeta)
    expect(result.current.routes[0].betaLinks?.[0].title).toBeUndefined()
    expect(result.current.routes[0].betaLinks?.[0].climberHeight).toBeUndefined()
  })

  it('保存失败保留数据及编辑表单，反馈服务器错误', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false, json: async () => ({ error: '无权操作' }),
    } as Response)
    const { result } = setup()
    act(() => result.current.management.handleStartEdit(mockBeta))
    act(() => result.current.management.setEditForm(prev => ({ ...prev, title: '未保存标题' })))

    await act(async () => result.current.management.handleSaveBeta(mockBeta.id, mockRoute))

    expect(result.current.routes[0].betaLinks?.[0]).toEqual(mockBeta)
    expect(result.current.management.editingBetaId).toBe(mockBeta.id)
    expect(result.current.management.editForm.title).toBe('未保存标题')
    expect(showToast).toHaveBeenCalledWith('无权操作', 'error', 4000)
    expect(result.current.management.isSaving).toBe(false)
  })

  it('无效数字保留输入，不把 NaN 序列化为清空字段', async () => {
    const { result } = setup()
    act(() => result.current.management.handleStartEdit(mockBeta))
    act(() => result.current.management.setEditForm(prev => ({ ...prev, climberHeight: 'abc' })))

    await act(async () => result.current.management.handleSaveBeta(mockBeta.id, mockRoute))

    expect(fetch).not.toHaveBeenCalled()
    expect(result.current.routes[0].betaLinks?.[0]).toEqual(mockBeta)
    expect(result.current.management.editingBetaId).toBe(mockBeta.id)
    expect(showToast).toHaveBeenCalledWith('身高和臂展必须是有效数字', 'error', 4000)
  })

  it('删除成功只移除目标 Beta', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response)
    const { result } = setup()

    await act(async () => result.current.management.handleDeleteBeta(mockBeta.id, mockRoute))

    expect(fetch).toHaveBeenCalledWith('/api/beta', expect.objectContaining({ method: 'DELETE' }))
    expect(result.current.routes[0].betaLinks).toEqual([])
    expect(result.current.routes[1].betaLinks).toEqual([mockBeta])
    expect(result.current.management.deletingBetaId).toBeNull()
  })

  it('删除失败保留数据并反馈错误', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false, json: async () => ({ error: '删除失败' }),
    } as Response)
    const { result } = setup()

    await act(async () => result.current.management.handleDeleteBeta(mockBeta.id, mockRoute))

    expect(result.current.routes[0].betaLinks).toEqual([mockBeta])
    expect(showToast).toHaveBeenCalledWith('删除失败', 'error', 4000)
    expect(result.current.management.deletingBetaId).toBeNull()
  })

  it('保存期间继续编辑同一 Beta，迟到响应保留新草稿并可再次保存', async () => {
    const { result } = setup()
    act(() => result.current.management.handleStartEdit(mockBeta))
    act(() => result.current.management.setEditForm(prev => ({ ...prev, title: '提交时标题' })))
    let resolveSave!: (response: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { resolveSave = resolve }))
    let saving!: Promise<void>
    act(() => { saving = result.current.management.handleSaveBeta(mockBeta.id, mockRoute) })
    act(() => result.current.management.setEditForm(prev => ({ ...prev, title: '继续编辑的新标题', author: '继续编辑的新作者' })))

    await act(async () => {
      resolveSave({ ok: true, json: async () => ({ success: true, beta: { ...mockBeta, title: '提交时标题' } }) } as Response)
      await saving
    })

    expect(result.current.routes[0].betaLinks?.[0].title).toBe('提交时标题')
    expect(result.current.management.editingBetaId).toBe(mockBeta.id)
    expect(result.current.management.editForm.title).toBe('继续编辑的新标题')
    expect(result.current.management.editForm.author).toBe('继续编辑的新作者')
    expect(showToast).toHaveBeenCalledWith('已保存提交内容，后续 Beta 修改尚未保存', 'info', 4000)

    const latestBeta = { ...mockBeta, title: '继续编辑的新标题', author: '继续编辑的新作者' }
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, beta: latestBeta }) } as Response)
    await act(async () => result.current.management.handleSaveBeta(mockBeta.id, result.current.routes[0]))
    expect(result.current.routes[0].betaLinks?.[0]).toEqual(latestBeta)
    expect(result.current.management.editingBetaId).toBeNull()
  })

  it('Beta A 保存期间取消并编辑 B，A 的响应不能关闭或改写 B 草稿', async () => {
    const { result } = setup()
    act(() => result.current.management.handleStartEdit(mockBeta))
    act(() => result.current.management.setEditForm(prev => ({ ...prev, title: 'A 提交标题' })))
    let resolveSave!: (response: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { resolveSave = resolve }))
    let saving!: Promise<void>
    act(() => { saving = result.current.management.handleSaveBeta(mockBeta.id, mockRoute) })
    act(() => result.current.management.handleCancelEdit())
    const betaB = { ...mockBeta, id: 'beta-2', title: 'B 原标题' }
    act(() => result.current.management.handleStartEdit(betaB))
    act(() => result.current.management.setEditForm(prev => ({ ...prev, title: 'B 未保存草稿' })))

    await act(async () => {
      resolveSave({ ok: true, json: async () => ({ success: true, beta: { ...mockBeta, title: 'A 提交标题' } }) } as Response)
      await saving
    })

    expect(result.current.routes[0].betaLinks?.[0].title).toBe('A 提交标题')
    expect(result.current.management.editingBetaId).toBe(betaB.id)
    expect(result.current.management.editForm.title).toBe('B 未保存草稿')
    expect(result.current.management.isSaving).toBe(false)
  })

  it('取消并重新编辑同一 Beta 时，旧会话响应不能关闭新会话，即使输入相同', async () => {
    const { result } = setup()
    act(() => result.current.management.handleStartEdit(mockBeta))
    let resolveSave!: (response: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { resolveSave = resolve }))
    let saving!: Promise<void>
    act(() => { saving = result.current.management.handleSaveBeta(mockBeta.id, mockRoute) })
    act(() => result.current.management.handleCancelEdit())
    act(() => result.current.management.handleStartEdit(mockBeta))

    await act(async () => {
      resolveSave({ ok: true, json: async () => ({ success: true, beta: mockBeta }) } as Response)
      await saving
    })

    expect(result.current.management.editingBetaId).toBe(mockBeta.id)
    expect(result.current.management.editForm.title).toBe(mockBeta.title)
  })
})
