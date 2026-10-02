import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useState } from 'react'
import { useRouteEditor } from './use-route-editor'
import { useBetaManagement } from './use-beta-management'
import { useDirtyGuard } from './use-dirty-guard'
import type { Route } from '@bloctop/shared/types'

// Mock external dependencies
vi.mock('@bloctop/shared/topo-utils', () => ({
  catmullRomCurve: vi.fn().mockReturnValue('M0,0 L10,10'),
  scalePoints: vi.fn().mockImplementation((pts: Array<{x: number; y: number}>) => pts),
}))
vi.mock('@bloctop/shared/tokens', () => ({
  getGradeColor: vi.fn().mockReturnValue('#ff0000'),
}))
vi.mock('@bloctop/shared/topo-constants', () => ({
  computeViewBox: vi.fn().mockReturnValue({ width: 1000, height: 750 }),
}))
vi.mock('@bloctop/ui/components/toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))
vi.mock('@/lib/route-validation', () => ({
  validateRouteForm: vi.fn().mockReturnValue({}),
}))

const mockRoute: Route = {
  id: 1,
  name: '测试线路',
  grade: 'V3',
  cragId: 'test-crag',
  area: '主墙',
  faceId: 'face-1',
  setter: '张三',
  FA: '李四',
  description: '一条测试线路',
  topoLine: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }],
  topoTension: 0.5,
}

const mockCache = {
  getImageUrl: vi.fn().mockReturnValue('https://img.example.com/face.jpg'),
  getFaceKey: vi.fn(),
  invalidate: vi.fn(),
  invalidateByPrefix: vi.fn(),
  subscribe: vi.fn(),
  subscribeByPrefix: vi.fn(),
  prefetch: vi.fn(),
}

function setup(route: Route | null = mockRoute) {
  const setRoutes = vi.fn()
  const updateCragAreas = vi.fn().mockResolvedValue(undefined)

  return renderHook(() =>
    useRouteEditor({
      selectedRoute: route,
      faceImageCache: mockCache as never,
      setRoutes,
      persistedAreas: ['主墙'],
      selectedCragId: 'test-crag',
      updateCragAreas,
    })
  )
}

const secondRoute: Route = { ...mockRoute, id: 2, name: '另一条线路' }

// Mirrors the workbench ownership: a persisted route collection + selected ID,
// with the Topo draft and Beta mutations consuming the same selected record.
function setupWorkbench(route: Route = mockRoute) {
  const updateCragAreas = vi.fn().mockResolvedValue(['主墙'])
  return renderHook(() => {
    const [routes, setRoutes] = useState<Route[]>([route, secondRoute])
    const [selectedId, setSelectedId] = useState(route.id)
    const selectedRoute = routes.find(item => item.id === selectedId) ?? null
    const editor = useRouteEditor({
      selectedRoute,
      faceImageCache: mockCache as never,
      setRoutes,
      persistedAreas: ['主墙'],
      selectedCragId: 'test-crag',
      updateCragAreas,
    })
    const beta = useBetaManagement({ setRoutes })
    const guard = useDirtyGuard<number>({
      hasUnsavedChanges: editor.hasUnsavedChanges,
      onSave: editor.handleSave,
      executeAction: setSelectedId,
    })
    return { routes, setRoutes, selectedRoute, editor, beta, guard }
  })
}

describe('useRouteEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset fetch mock
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ route: mockRoute }),
    })
  })

  it('初始化编辑状态从选中线路', () => {
    const { result } = setup()
    expect(result.current.editedRoute.name).toBe('测试线路')
    expect(result.current.editedRoute.grade).toBe('V3')
    expect(result.current.editedRoute.area).toBe('主墙')
    expect(result.current.topoLine).toHaveLength(2)
    expect(result.current.topoTension).toBe(0.5)
  })

  it('无选中线路时 hasUnsavedChanges 返回 false', () => {
    const { result } = setup(null)
    expect(result.current.hasUnsavedChanges()).toBe(false)
  })

  it('未修改时 hasUnsavedChanges 返回 false', () => {
    const { result } = setup()
    expect(result.current.hasUnsavedChanges()).toBe(false)
  })

  it('修改字段后 hasUnsavedChanges 返回 true', () => {
    const { result } = setup()
    act(() => {
      result.current.setEditedRoute(prev => ({ ...prev, name: '新名称' }))
    })
    expect(result.current.hasUnsavedChanges()).toBe(true)
  })

  it('修改 topoLine 后 hasUnsavedChanges 返回 true', () => {
    const { result } = setup()
    act(() => {
      result.current.setTopoLine([{ x: 0.5, y: 0.5 }])
    })
    expect(result.current.hasUnsavedChanges()).toBe(true)
  })

  it('修改 topoTension 后 hasUnsavedChanges 返回 true', () => {
    const { result } = setup()
    act(() => {
      result.current.setTopoTension(0.8)
    })
    expect(result.current.hasUnsavedChanges()).toBe(true)
  })

  it('handleClearPoints 清空 topoLine 和 tension', () => {
    const { result } = setup()
    act(() => result.current.handleClearPoints())
    expect(result.current.topoLine).toHaveLength(0)
    expect(result.current.topoTension).toBe(0)
  })

  it('handleRemoveLastPoint 移除最后一个点', () => {
    const { result } = setup()
    act(() => result.current.handleRemoveLastPoint())
    expect(result.current.topoLine).toHaveLength(1)
    expect(result.current.topoLine[0]).toEqual({ x: 0.1, y: 0.2 })
  })

  it('routeColor 基于 grade 计算', () => {
    const { result } = setup()
    expect(result.current.routeColor).toBe('#ff0000')
  })

  it('切换岩面时原有标注的 topoLine 不被清空', () => {
    const { result } = setup()
    act(() => {
      result.current.handleFaceSelect('face-2', '主墙')
    })
    // 新模型：handleFaceSelect 新增标注，激活 face-2（新标注，topoLine 为空）
    expect(result.current.selectedFaceId).toBe('face-2')
    // face-1 的原有 topoLine 保留在第一条标注中
    expect(result.current.annotations[0].topoLine).toHaveLength(2)
    expect(result.current.annotations[0].faceId).toBe('face-1')
  })

  it('切换岩面后 hasUnsavedChanges 返回 true', () => {
    // 使用无 topoLine 的 mockRoute，排除 topoLine 长度差异对 dirty 检测的干扰
    // faceId 变更应被 hasUnsavedChanges 感知，即使 topoLine 长度不变
    const routeWithoutTopo = { ...mockRoute, topoLine: undefined }
    const { result } = setup(routeWithoutTopo)
    expect(result.current.hasUnsavedChanges()).toBe(false)
    act(() => {
      // faceId 从 'face-1' 切换到 'face-2'；topoLine 从 [] 变成 []，长度不变
      result.current.handleFaceSelect('face-2', '主墙')
    })
    expect(result.current.hasUnsavedChanges()).toBe(true)
  })

  describe('多图标注管理', () => {
    it('初始化时从旧字段合成 annotations', () => {
      const { result } = setup()
      // mockRoute 有 faceId: 'face-1' 和 topoLine (2 点)
      expect(result.current.annotations).toHaveLength(1)
      expect(result.current.annotations[0].faceId).toBe('face-1')
      expect(result.current.annotations[0].topoLine).toHaveLength(2)
      expect(result.current.activeAnnotationIndex).toBe(0)
    })

    it('初始化时从新字段加载 annotations', () => {
      const routeWithAnnotations: Route = {
        ...mockRoute,
        topoAnnotations: [
          { faceId: 'face-1', area: '主墙', topoLine: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }] },
          { faceId: 'face-2', area: '主墙', topoLine: [{ x: 0.5, y: 0.6 }, { x: 0.7, y: 0.8 }] },
        ],
      }
      const { result } = setup(routeWithAnnotations)
      expect(result.current.annotations).toHaveLength(2)
      expect(result.current.annotations[1].faceId).toBe('face-2')
    })

    it('addAnnotation 新增标注并激活新 index', () => {
      const { result } = setup()
      act(() => {
        result.current.addAnnotation('face-2', '主墙')
      })
      expect(result.current.annotations).toHaveLength(2)
      expect(result.current.annotations[1].faceId).toBe('face-2')
      expect(result.current.annotations[1].topoLine).toHaveLength(0)
      expect(result.current.activeAnnotationIndex).toBe(1)
    })

    it('removeAnnotation 后 activeAnnotationIndex 不越界', () => {
      const routeWith2: Route = {
        ...mockRoute,
        topoAnnotations: [
          { faceId: 'face-1', area: '主墙', topoLine: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }] },
          { faceId: 'face-2', area: '主墙', topoLine: [{ x: 0.5, y: 0.6 }, { x: 0.7, y: 0.8 }] },
        ],
      }
      const { result } = setup(routeWith2)
      act(() => { result.current.setActiveAnnotationIndex(1) })
      act(() => { result.current.removeAnnotation(1) })
      expect(result.current.annotations).toHaveLength(1)
      expect(result.current.activeAnnotationIndex).toBe(0)
    })

    it('updateActiveTopoLine 只修改激活标注的 topoLine', () => {
      const routeWith2: Route = {
        ...mockRoute,
        topoAnnotations: [
          { faceId: 'face-1', area: '主墙', topoLine: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }] },
          { faceId: 'face-2', area: '主墙', topoLine: [{ x: 0.5, y: 0.6 }, { x: 0.7, y: 0.8 }] },
        ],
      }
      const { result } = setup(routeWith2)
      act(() => { result.current.setActiveAnnotationIndex(0) })
      act(() => {
        result.current.updateActiveTopoLine([{ x: 0.9, y: 0.9 }, { x: 0.8, y: 0.8 }])
      })
      expect(result.current.annotations[0].topoLine[0]).toEqual({ x: 0.9, y: 0.9 })
      // 第二条标注不变
      expect(result.current.annotations[1].topoLine[0]).toEqual({ x: 0.5, y: 0.6 })
    })

    it('保存时 patch body 包含 topoAnnotations 和 compat sync', async () => {
      const { result } = setup()
      await act(async () => {
        await result.current.handleSave()
      })
      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      // 新字段
      expect(body.topoAnnotations).toBeDefined()
      expect(Array.isArray(body.topoAnnotations)).toBe(true)
      // compat sync：旧字段与第一条标注一致
      if (result.current.annotations.length > 0) {
        expect(body.faceId).toBe(result.current.annotations[0].faceId)
      }
    })

    it('添加标注后 hasUnsavedChanges 返回 true', () => {
      const { result } = setup()
      act(() => {
        result.current.addAnnotation('face-2', '主墙')
      })
      expect(result.current.hasUnsavedChanges()).toBe(true)
    })

    it('仅改变标注区域也应标记未保存', () => {
      const { result } = setup()
      act(() => result.current.addAnnotation('face-1', '另一区域'))
      act(() => {
        result.current.setTopoLine(mockRoute.topoLine!)
        result.current.setTopoTension(mockRoute.topoTension!)
      })
      act(() => result.current.removeAnnotation(0))
      expect(result.current.annotations).toHaveLength(1)
      expect(result.current.annotations[0].faceId).toBe('face-1')
      expect(result.current.annotations[0].area).toBe('另一区域')
      expect(result.current.hasUnsavedChanges()).toBe(true)
    })
  })

  describe('工作台持久化记录与编辑草稿', () => {
    it('保存采用服务端返回、更新选中线路并清除未保存状态', async () => {
      const { result } = setupWorkbench()
      const updatedPoints = [{ x: 0.2, y: 0.3 }, { x: 0.4, y: 0.5 }]
      act(() => {
        result.current.editor.setEditedRoute(prev => ({ ...prev, name: '  新线路名称  ' }))
        result.current.editor.setTopoLine(updatedPoints)
      })
      const savedRoute: Route = {
        ...mockRoute,
        name: '新线路名称',
        topoLine: updatedPoints,
        topoAnnotations: [{ faceId: 'face-1', area: '主墙', topoLine: updatedPoints, topoTension: 0.5 }],
      }
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ route: savedRoute }),
      } as Response)

      await act(async () => { expect(await result.current.editor.handleSave()).toBe(true) })

      expect(result.current.selectedRoute?.name).toBe('新线路名称')
      expect(result.current.editor.editedRoute.name).toBe('新线路名称')
      expect(result.current.editor.annotations).toEqual(savedRoute.topoAnnotations)
      expect(result.current.editor.hasUnsavedChanges()).toBe(false)
      act(() => result.current.guard.guardAction(secondRoute.id))
      expect(result.current.guard.showUnsavedDialog).toBe(false)
      expect(result.current.selectedRoute?.id).toBe(secondRoute.id)
    })

    it('保存失败保留草稿和未保存状态', async () => {
      const { result } = setupWorkbench()
      act(() => result.current.editor.setEditedRoute(prev => ({ ...prev, name: '待保存草稿' })))
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: '保存失败' }),
      } as Response)

      await act(async () => { expect(await result.current.editor.handleSave()).toBe(false) })

      expect(result.current.selectedRoute?.name).toBe(mockRoute.name)
      expect(result.current.editor.editedRoute.name).toBe('待保存草稿')
      expect(result.current.editor.hasUnsavedChanges()).toBe(true)
    })

    it('编辑、删除 Beta 保留未保存表单和 Topo，切换仍需确认', async () => {
      const betaLink = {
        id: 'beta-1', platform: 'xiaohongshu' as const,
        noteId: 'note-1', url: 'https://www.xiaohongshu.com/explore/note-1', title: '旧标题',
      }
      const { result } = setupWorkbench({ ...mockRoute, betaLinks: [betaLink] })
      const draftPoints = [{ x: 0.7, y: 0.8 }, { x: 0.8, y: 0.9 }]
      act(() => {
        result.current.editor.setEditedRoute(prev => ({ ...prev, name: '未保存名称' }))
        result.current.editor.setTopoLine(draftPoints)
        result.current.beta.handleStartEdit(betaLink)
      })
      act(() => result.current.beta.setEditForm(prev => ({ ...prev, title: '新 Beta 标题' })))
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, beta: { ...betaLink, title: '新 Beta 标题' } }),
      } as Response)

      await act(async () => {
        await result.current.beta.handleSaveBeta(betaLink.id, result.current.selectedRoute!)
      })
      expect(result.current.selectedRoute?.betaLinks?.[0].title).toBe('新 Beta 标题')
      expect(result.current.editor.editedRoute.name).toBe('未保存名称')
      expect(result.current.editor.topoLine).toEqual(draftPoints)

      await act(async () => {
        await result.current.beta.handleDeleteBeta(betaLink.id, result.current.selectedRoute!)
      })
      expect(result.current.selectedRoute?.betaLinks).toEqual([])
      expect(result.current.editor.editedRoute.name).toBe('未保存名称')
      expect(result.current.editor.topoLine).toEqual(draftPoints)
      expect(result.current.editor.hasUnsavedChanges()).toBe(true)

      act(() => result.current.guard.guardAction(secondRoute.id))
      expect(result.current.guard.showUnsavedDialog).toBe(true)
      expect(result.current.selectedRoute?.id).toBe(mockRoute.id)
      act(() => result.current.guard.handleDiscard())
      expect(result.current.selectedRoute?.id).toBe(secondRoute.id)
      expect(result.current.editor.editedRoute.name).toBe(secondRoute.name)
      expect(result.current.editor.hasUnsavedChanges()).toBe(false)
    })

    it('重新读取相同可编辑数据保留草稿，真实持久化变更会采用新基线', () => {
      const { result } = setupWorkbench()
      act(() => result.current.editor.setEditedRoute(prev => ({ ...prev, description: '尚未保存的描述' })))
      act(() => result.current.setRoutes(prev => prev.map(route => JSON.parse(JSON.stringify(route)) as Route)))
      expect(result.current.editor.editedRoute.description).toBe('尚未保存的描述')
      expect(result.current.editor.hasUnsavedChanges()).toBe(true)

      act(() => result.current.setRoutes(prev => prev.map(route => route.id === mockRoute.id
        ? { ...route, description: '新持久化描述' }
        : route)))
      expect(result.current.editor.editedRoute.description).toBe('新持久化描述')
      expect(result.current.editor.hasUnsavedChanges()).toBe(false)
    })

    it('未保存线路切换时可以先保存再进入下一条', async () => {
      const { result } = setupWorkbench()
      act(() => result.current.editor.setEditedRoute(prev => ({ ...prev, name: '先保存的名称' })))
      act(() => result.current.guard.guardAction(secondRoute.id))
      expect(result.current.guard.showUnsavedDialog).toBe(true)
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ route: { ...mockRoute, name: '先保存的名称' } }),
      } as Response)

      await act(async () => result.current.guard.handleSaveAndProceed())

      expect(result.current.routes.find(route => route.id === mockRoute.id)?.name).toBe('先保存的名称')
      expect(result.current.selectedRoute?.id).toBe(secondRoute.id)
      expect(result.current.editor.editedRoute.name).toBe(secondRoute.name)
      expect(result.current.editor.hasUnsavedChanges()).toBe(false)
    })

    it('保存被过滤的空标注后采用持久化基线，即使持久化字段没有变化', async () => {
      const { result } = setupWorkbench()
      act(() => result.current.editor.addAnnotation('空标注', '主墙'))
      expect(result.current.editor.hasUnsavedChanges()).toBe(true)
      await act(async () => result.current.editor.handleSave())
      expect(result.current.editor.annotations).toHaveLength(1)
      expect(result.current.editor.selectedFaceId).toBe('face-1')
      expect(result.current.editor.hasUnsavedChanges()).toBe(false)
    })

    it('上一条线路的迟到保存不会覆盖新选中线路的编辑草稿', async () => {
      const { result } = setupWorkbench()
      act(() => result.current.editor.setEditedRoute(prev => ({ ...prev, name: '第一条已保存名称' })))
      let resolveSave!: (response: Response) => void
      vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { resolveSave = resolve }))
      let saving!: Promise<boolean>
      act(() => { saving = result.current.editor.handleSave() })
      act(() => result.current.guard.guardAction(secondRoute.id))
      act(() => result.current.guard.handleDiscard())
      act(() => result.current.editor.setEditedRoute(prev => ({ ...prev, description: '第二条的未保存描述' })))

      await act(async () => {
        resolveSave({
          ok: true,
          json: async () => ({ route: { ...mockRoute, name: '第一条已保存名称' } }),
        } as Response)
        await saving
      })

      expect(result.current.routes.find(route => route.id === mockRoute.id)?.name).toBe('第一条已保存名称')
      expect(result.current.selectedRoute?.id).toBe(secondRoute.id)
      expect(result.current.editor.editedRoute.description).toBe('第二条的未保存描述')
      expect(result.current.editor.hasUnsavedChanges()).toBe(true)
    })

    it('同线路慢保存只更新持久化基线，保留请求期间的新表单和 Topo 编辑', async () => {
      const { result } = setupWorkbench()
      const submittedPoints = [{ x: 0.2, y: 0.3 }, { x: 0.4, y: 0.5 }]
      const continuedPoints = [{ x: 0.6, y: 0.7 }, { x: 0.8, y: 0.9 }]
      act(() => {
        result.current.editor.setEditedRoute(prev => ({ ...prev, name: '提交时名称' }))
        result.current.editor.setTopoLine(submittedPoints)
      })
      let resolveSave!: (response: Response) => void
      vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { resolveSave = resolve }))
      let saving!: Promise<boolean>
      act(() => { saving = result.current.editor.handleSave() })
      expect(result.current.editor.isSaving).toBe(true)
      act(() => {
        result.current.editor.setEditedRoute(prev => ({ ...prev, name: '继续输入的名称', description: '继续输入的描述' }))
        result.current.editor.setTopoLine(continuedPoints)
      })
      const savedRoute: Route = {
        ...mockRoute, name: '提交时名称', topoLine: submittedPoints,
        topoAnnotations: [{ faceId: 'face-1', area: '主墙', topoLine: submittedPoints, topoTension: 0.5 }],
      }

      await act(async () => {
        resolveSave({ ok: true, json: async () => ({ route: savedRoute }) } as Response)
        expect(await saving).toBe(false)
      })

      expect(result.current.selectedRoute?.name).toBe('提交时名称')
      expect(result.current.selectedRoute?.topoLine).toEqual(submittedPoints)
      expect(result.current.editor.editedRoute.name).toBe('继续输入的名称')
      expect(result.current.editor.editedRoute.description).toBe('继续输入的描述')
      expect(result.current.editor.topoLine).toEqual(continuedPoints)
      expect(result.current.editor.hasUnsavedChanges()).toBe(true)
      expect(result.current.editor.saveSuccess).toBe(false)

      const latestSaved: Route = {
        ...savedRoute, name: '继续输入的名称', description: '继续输入的描述', topoLine: continuedPoints,
        topoAnnotations: [{ faceId: 'face-1', area: '主墙', topoLine: continuedPoints, topoTension: 0.5 }],
      }
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ route: latestSaved }) } as Response)
      await act(async () => { expect(await result.current.editor.handleSave()).toBe(true) })
      expect(result.current.selectedRoute?.name).toBe('继续输入的名称')
      expect(result.current.editor.hasUnsavedChanges()).toBe(false)
    })

    it('保存并切换期间继续修改时停留在当前线路，避免丢失未提交的新修改', async () => {
      const { result } = setupWorkbench()
      act(() => result.current.editor.setEditedRoute(prev => ({ ...prev, name: '提交名称' })))
      act(() => result.current.guard.guardAction(secondRoute.id))
      let resolveSave!: (response: Response) => void
      vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { resolveSave = resolve }))
      let saving!: Promise<void>
      act(() => { saving = result.current.guard.handleSaveAndProceed() })
      act(() => result.current.editor.setEditedRoute(prev => ({ ...prev, description: '保存期间的新描述' })))

      await act(async () => {
        resolveSave({ ok: true, json: async () => ({ route: { ...mockRoute, name: '提交名称' } }) } as Response)
        await saving
      })

      expect(result.current.selectedRoute?.id).toBe(mockRoute.id)
      expect(result.current.selectedRoute?.name).toBe('提交名称')
      expect(result.current.editor.editedRoute.description).toBe('保存期间的新描述')
      expect(result.current.editor.hasUnsavedChanges()).toBe(true)
    })

    it.each(['edit', 'delete', 'add'] as const)('线路迟到保存响应不会回滚在途期间完成的 Beta %s', async mutation => {
      const originalBeta = {
        id: 'beta-1', platform: 'xiaohongshu' as const,
        noteId: 'note-1', url: 'https://www.xiaohongshu.com/explore/note-1', title: '原 Beta 标题',
      }
      const initialRoute = { ...mockRoute, betaLinks: [originalBeta] }
      const { result } = setupWorkbench(initialRoute)
      act(() => result.current.editor.setEditedRoute(prev => ({ ...prev, name: '保存后的线路名' })))
      let resolveSave!: (response: Response) => void
      vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { resolveSave = resolve }))
      let saving!: Promise<boolean>
      act(() => { saving = result.current.editor.handleSave() })

      if (mutation === 'edit') {
        act(() => result.current.beta.handleStartEdit(originalBeta))
        act(() => result.current.beta.setEditForm(prev => ({ ...prev, title: '已更新 Beta 标题' })))
        vi.mocked(fetch).mockResolvedValueOnce({
          ok: true, json: async () => ({ success: true, beta: { ...originalBeta, title: '已更新 Beta 标题' } }),
        } as Response)
        await act(async () => result.current.beta.handleSaveBeta(originalBeta.id, result.current.selectedRoute!))
      } else if (mutation === 'delete') {
        vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response)
        await act(async () => result.current.beta.handleDeleteBeta(originalBeta.id, result.current.selectedRoute!))
      } else {
        // Use the production handler for BetaSubmitDrawer's success event.
        const addedBeta = { ...originalBeta, id: 'beta-2', noteId: 'note-2', title: '新 Beta' }
        act(() => result.current.beta.handleBetaAdded(mockRoute.id, addedBeta))
      }

      const latestBetas = result.current.selectedRoute?.betaLinks
      await act(async () => {
        // The route response was produced before the Beta mutation completed.
        resolveSave({
          ok: true,
          json: async () => ({ route: { ...initialRoute, name: '保存后的线路名' } }),
        } as Response)
        expect(await saving).toBe(true)
      })

      expect(result.current.selectedRoute?.name).toBe('保存后的线路名')
      expect(result.current.selectedRoute?.betaLinks).toEqual(latestBetas)
      expect(result.current.editor.editedRoute.name).toBe('保存后的线路名')
      expect(result.current.editor.hasUnsavedChanges()).toBe(false)
      if (mutation === 'edit') expect(latestBetas?.[0].title).toBe('已更新 Beta 标题')
      if (mutation === 'delete') expect(latestBetas).toEqual([])
      if (mutation === 'add') expect(latestBetas?.map(beta => beta.id)).toEqual(['beta-1', 'beta-2'])
    })
  })
})
