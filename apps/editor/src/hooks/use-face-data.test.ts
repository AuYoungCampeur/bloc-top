import { useState } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Route } from '@bloctop/shared/types'
import { useFaceData } from './use-face-data'

const fixtures = vi.hoisted(() => ({ toast: vi.fn(), preload: vi.fn(), invalidate: vi.fn() }))
vi.mock('@bloctop/ui/components/toast', () => ({ useToast: () => ({ showToast: fixtures.toast }) }))
vi.mock('@bloctop/shared/editor-utils', () => ({ preloadImage: fixtures.preload }))
const cache = {
  getImageUrl: (face: { cragId: string; area: string; faceId: string }) => `https://img.example.com/${face.cragId}/${face.area}/${face.faceId}.jpg`,
  invalidate: fixtures.invalidate,
} as never
const updateAreas = vi.fn().mockResolvedValue(['北区', '南区'])
const points = [{ x: 0.1, y: 0.1 }, { x: 0.8, y: 0.8 }]
const a: Route = { id: 1, cragId: 'a', name: '跨区域线路', grade: 'V3', area: '业务区域', faceId: 'stale',
  topoLine: points, topoAnnotations: [{ area: '北区', faceId: 'same', topoLine: points }, { area: '南区', faceId: 'same', topoLine: points }] }
const b: Route = { id: 2, cragId: 'a', name: '旧线路', grade: 'V4', area: '业务区域', faceArea: '南区', faceId: 'same' }
const foreign: Route = { ...b, id: 3, cragId: 'b' }
const response = (data: unknown, ok = true) => ({ ok, json: async () => data }) as Response
const faces = [{ area: '北区', faceId: 'same' }, { area: '南区', faceId: 'same' }]
function setup(initialRoutes = [a, b, foreign]) {
  return renderHook(({ cragId, area }: { cragId: string | null; area: string | null }) => {
    const [routes, setRoutes] = useState(initialRoutes)
    return { routes, setRoutes, ...useFaceData({ selectedCragId: cragId, selectedArea: area, routes, setRoutes,
      persistedAreas: ['北区', '南区'], updateCragAreas: updateAreas, faceImageCache: cache }) }
  }, { initialProps: { cragId: 'a' as string | null, area: null as string | null } })
}

beforeEach(() => {
  vi.clearAllMocks()
  fixtures.preload.mockResolvedValue(undefined)
  globalThis.fetch = vi.fn(async input => {
    if (String(input).startsWith('/api/faces?')) return response({ success: true, faces })
    return response({ success: true, routes: [a, b, foreign] })
  })
})

describe('真实 useFaceData 管理会话', () => {
  it('同 ID 按岩场/区域分组，多图数组权威，旧照片区域独立于线路业务区域', async () => {
    const { result, rerender } = setup()
    await waitFor(() => expect(result.current.faceGroups).toHaveLength(2))
    expect(result.current.faceGroups[0].routes.map(route => route.id)).toEqual([1])
    expect(result.current.faceGroups[1].routes.map(route => route.id)).toEqual([1, 2])
    expect(result.current.faceGroups[1].imageUrl).toContain('/a/南区/same.jpg')
    rerender({ cragId: 'a', area: '南区' })
    expect(result.current.faceGroups.map(face => face.area)).toEqual(['南区'])
  })

  it('列表失败可见，刷新失败不能提示成功；重试恢复', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ error: '照片服务暂不可用' }, false))
    const { result } = setup()
    await waitFor(() => expect(result.current.facesError).toBe('照片服务暂不可用'))
    vi.mocked(fetch).mockRejectedValueOnce(new Error('网络中断'))
    await act(async () => { await result.current.handleRefresh() })
    expect(fixtures.toast).toHaveBeenLastCalledWith('刷新失败，请重试', 'error', 2000)
    await act(async () => { await result.current.handleRefresh() })
    expect(result.current.facesError).toBeNull()
    expect(result.current.faceGroups).toHaveLength(2)
  })

  it('迟到 A 列表不污染 B，未加载的新岩场不显示旧照片', async () => {
    let finishA!: (res: Response) => void
    vi.mocked(fetch).mockImplementation(async input => String(input).includes('cragId=a')
      ? new Promise(resolve => { finishA = resolve })
      : response({ success: true, faces: [{ area: 'B区', faceId: 'b-photo' }] }))
    const { result, rerender } = setup()
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    rerender({ cragId: 'b', area: null })
    expect(result.current.faceGroups).toEqual([])
    await waitFor(() => expect(result.current.r2Faces[0]?.faceId).toBe('b-photo'))
    await act(async () => finishA(response({ success: true, faces })))
    expect(result.current.r2Faces.map(face => face.faceId)).toEqual(['b-photo'])
  })

  it('慢重命名仅改目标区域，采用服务端 Topo 同时保留期间新增 Beta 和线路文字', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.faceGroups).toHaveLength(2))
    let finish!: (res: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    let saving!: Promise<string | false>
    act(() => { saving = result.current.handleRenameFace(result.current.faceGroups[0], 'north-new') })
    act(() => result.current.setRoutes(current => current.map(route => route.id === 1
      ? { ...route, description: '期间新文字', betaLinks: [{ id: 'new-beta', url: 'https://xhslink.cn/o/test' }] as Route['betaLinks'] } : route)))
    const saved: Route = { ...a, faceId: 'north-new', faceArea: '北区',
      topoAnnotations: [{ area: '北区', faceId: 'north-new', topoLine: points }, a.topoAnnotations![1]] }
    await act(async () => { finish(response({ success: true, routes: [saved], routesUpdated: 1 })); expect(await saving).toBe('north-new') })
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toEqual({ cragId: 'a', area: '北区', oldFaceId: 'same', newFaceId: 'north-new' })
    expect(result.current.r2Faces).toEqual([{ area: '北区', faceId: 'north-new' }, { area: '南区', faceId: 'same' }])
    expect(result.current.routes[0].betaLinks?.[0].id).toBe('new-beta')
    expect(result.current.routes[0].description).toBe('期间新文字')
    expect(result.current.routes[0].topoAnnotations).toEqual(saved.topoAnnotations)
    expect(result.current.routes[1]).toEqual(b)
  })

  it('删除采用服务器剩余视角，另一同名区域仍保留；当前 Beta 不回滚', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.faceGroups).toHaveLength(2))
    const saved = { ...a, faceId: 'same', faceArea: '南区', topoAnnotations: [a.topoAnnotations![1]] }
    vi.mocked(fetch).mockResolvedValueOnce(response({ success: true, routes: [saved], routesCleared: 1 }))
    await act(async () => { expect(await result.current.handleDeleteFace(result.current.faceGroups[0])).toBe(true) })
    expect(result.current.r2Faces).toEqual([{ area: '南区', faceId: 'same' }])
    expect(result.current.routes[0].faceArea).toBe('南区')
    expect(result.current.routes[0].topoAnnotations).toEqual([a.topoAnnotations![1]])
    expect(result.current.faceGroups[0].routes.map(route => route.id)).toEqual([1, 2])
  })

  it('503 部分成功刷新真实记录核对，不把失败重命名乐观应用到 UI', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.faceGroups).toHaveLength(2))
    vi.mocked(fetch).mockResolvedValueOnce(response({ success: false, partial: true, referencesChanged: true, error: '清理失败' }, false))
    vi.mocked(fetch).mockResolvedValueOnce(response({ success: true, faces }))
    vi.mocked(fetch).mockResolvedValueOnce(response({ success: true, routes: [a, b] }))
    await act(async () => { expect(await result.current.handleRenameFace(result.current.faceGroups[0], 'new')).toBe(false) })
    expect(fetch).toHaveBeenCalledWith('/api/crags/a/routes')
    expect(result.current.r2Faces).toEqual(faces)
    expect(result.current.routes[0].topoAnnotations).toEqual(a.topoAnnotations)
    expect(fixtures.toast).toHaveBeenLastCalledWith('清理失败', 'error', 4000)
  })

  it('200 部分完成展示服务端警告，不能只显示成功', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.faceGroups).toHaveLength(2))
    vi.mocked(fetch).mockResolvedValueOnce(response({ success: true, routes: [], partial: true, warning: '引用已更新，清理待完成' }))
    await act(async () => { await result.current.handleDeleteFace(result.current.faceGroups[0]) })
    expect(fixtures.toast).toHaveBeenLastCalledWith('引用已更新，清理待完成', 'info', 5000)
  })

  it('A 删除响应到达 B 不清空 B 选中记录，不污染 B 照片或提示', async () => {
    const { result, rerender } = setup()
    await waitFor(() => expect(result.current.faceGroups).toHaveLength(2))
    let finish!: (res: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    let saving!: Promise<boolean>
    act(() => { saving = result.current.handleDeleteFace(result.current.faceGroups[0]) })
    rerender({ cragId: 'b', area: null })
    await waitFor(() => expect(result.current.faceGroups).toHaveLength(2))
    await act(async () => { finish(response({ success: true, routes: [{ ...a, faceId: undefined, topoAnnotations: [] }] })); expect(await saving).toBe(false) })
    expect(result.current.r2Faces).toEqual(faces)
    expect(result.current.routes[0].topoAnnotations).toEqual(a.topoAnnotations)
    expect(fixtures.toast).not.toHaveBeenCalled()
  })

  it('上传成功采用服务器清图结果、保留其余视角；预览失败不会撤销已完成写入', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.faceGroups).toHaveLength(2))
    fixtures.preload.mockRejectedValueOnce(new Error('图片网络失败'))
    const saved = { ...a, faceId: 'same', faceArea: '南区', topoAnnotations: [a.topoAnnotations![1]] }
    await act(async () => { expect(await result.current.handleUploadSuccess({ cragId: 'a', url: 'saved', faceId: 'same', area: '北区', isCreating: false, newArea: '', result: { routes: [saved] } })).toBe(true) })
    expect(result.current.routes[0].topoAnnotations).toEqual(saved.topoAnnotations)
    expect(fixtures.invalidate).toHaveBeenCalledWith('a/北区/same')
    expect(fixtures.toast).toHaveBeenCalledWith('照片已上传，预览加载失败，请刷新', 'info', 4000)
  })
})
