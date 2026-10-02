import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Route } from '@bloctop/shared/types'
import type { FaceDetailPanel } from '@/components/editor/face-detail-panel'
import type { FaceListPanel } from '@/components/editor/face-list-panel'
import type { OverwriteConfirmDialog } from '@/components/editor/overwrite-confirm-dialog'
import type { ComponentProps } from 'react'

const fixtures = vi.hoisted(() => ({ routes: [] as Route[], toast: vi.fn(), updateAreas: vi.fn(), invalidate: vi.fn() }))
vi.mock('@/hooks/use-crag-routes', async () => {
  const { useState } = await import('react')
  return { useCragRoutes: () => {
    const [routes, setRoutes] = useState(fixtures.routes)
    const [selectedCragId, setSelectedCragId] = useState('a')
    return { crags: [{ id: 'a', name: 'A', areas: ['北区', '南区'] }], routes, setRoutes, selectedCragId, setSelectedCragId,
      isLoadingCrags: false, isLoadingRoutes: false, stats: {}, updateCragAreas: fixtures.updateAreas,
      cragSelectionError: null, reloadCrags: vi.fn() }
  } }
})
vi.mock('@/hooks/use-break-app-shell-limit', () => ({ useBreakAppShellLimit: () => {} }))
vi.mock('@bloctop/shared/editor-utils', () => ({ preloadImage: async () => {} }))
vi.mock('@bloctop/ui/components/toast', () => ({ useToast: () => ({ showToast: fixtures.toast }) }))
vi.mock('@bloctop/ui/face-image/use-face-image', () => ({ useFaceImageCache: () => cache }))
const cache = { getImageUrl: (face: { area: string; faceId: string }) => `https://img.example.com/${face.area}/${face.faceId}`, invalidate: fixtures.invalidate }
vi.mock('@/components/editor/face-list-panel', () => ({ FaceListPanel: (props: ComponentProps<typeof FaceListPanel>) => <div>
  {props.faceGroups.map(face => <button key={`${face.area}/${face.faceId}`} onClick={() => props.onSelectFace(face)}>{face.area}/{face.faceId}</button>)}
</div> }))
vi.mock('@/components/editor/face-detail-panel', () => ({ FaceDetailPanel: (props: ComponentProps<typeof FaceDetailPanel>) => <div>
  <p>当前 {props.selectedFace.area}/{props.selectedFace.faceId} 线路 {props.selectedFace.routes.map(route => route.id).join(',')}</p>
  <label>照片
    {/* eslint-disable-next-line no-restricted-syntax -- upload fixture uses a file input */}
    <input type="file" onChange={props.onFileSelect} />
  </label>
  <button onClick={props.onUpload} disabled={props.isUploading}>上传照片</button>
</div> }))
vi.mock('@/components/editor/overwrite-confirm-dialog', () => ({ OverwriteConfirmDialog: (props: ComponentProps<typeof OverwriteConfirmDialog>) => <div role="dialog">
  <p>清除目标 Topo {props.affectedRoutes.map(route => route.id).join(',')}</p>
  <button onClick={() => { props.setClearTopoOnUpload(true) }}>清除当前照片标注</button>
  <button onClick={props.onConfirm}>确认覆盖</button>
</div> }))

import FaceManagementPage from './page'
const points = [{ x: 0.1, y: 0.2 }, { x: 0.7, y: 0.8 }]
const faces = [{ area: '北区', faceId: 'same' }, { area: '南区', faceId: 'same' }]
const response = (data: unknown, ok = true) => ({ ok, json: async () => data }) as Response
const upload = async () => {
  const user = userEvent.setup()
  render(<FaceManagementPage />)
  await screen.findAllByRole('button', { name: '北区/same' })
  await user.click(screen.getAllByRole('button', { name: '北区/same' })[0])
  fireEvent.change(screen.getAllByLabelText('照片')[0], { target: { files: [new File(['photo'], 'photo.webp', { type: 'image/webp' })] } })
  await user.click(screen.getAllByRole('button', { name: '上传照片' })[0])
  return user
}
beforeEach(() => {
  vi.clearAllMocks()
  URL.createObjectURL = vi.fn().mockReturnValue('blob:preview')
  URL.revokeObjectURL = vi.fn()
  fixtures.routes = [
    { id: 1, cragId: 'a', name: '跨图', grade: 'V3', area: '业务区', faceId: 'same', faceArea: '南区', topoLine: points,
      topoAnnotations: [{ faceId: 'same', area: '南区', topoLine: points }, { faceId: 'same', area: '北区', topoLine: points }] },
    { id: 2, cragId: 'a', name: '南图', grade: 'V4', area: '南区', faceId: 'same', topoLine: points },
    { id: 3, cragId: 'a', name: '北图', grade: 'V5', area: '业务区', faceArea: '北区', faceId: 'same', topoLine: points },
  ]
  fixtures.updateAreas.mockResolvedValue(['北区', '南区'])
  globalThis.fetch = vi.fn(async input => String(input).startsWith('/api/faces?')
    ? response({ success: true, faces }) : response({ success: true, exists: true, etag: 'version-1' }))
})

describe('真实岩面页面、上传 hook 与服务器结果', () => {
  it('覆盖入口只列目标区域的每个 Topo 视角，确认带 ETag，详情立即反映权威清图结果', async () => {
    const user = await upload()
    expect(await screen.findByText('清除目标 Topo 1,3')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '清除当前照片标注' }))
    const saved = [
      { ...fixtures.routes[0], topoAnnotations: [fixtures.routes[0].topoAnnotations![0]] },
      { ...fixtures.routes[2], topoLine: undefined, topoTension: undefined, topoAnnotations: [] },
    ]
    vi.mocked(fetch).mockResolvedValueOnce(response({ success: true, url: 'saved', routes: saved, partial: true, warning: '已保存，通知待完成' }))
    await user.click(screen.getByRole('button', { name: '确认覆盖' }))
    await waitFor(() => expect(screen.getAllByText('当前 北区/same 线路 3')).toHaveLength(2))
    const body = vi.mocked(fetch).mock.calls.at(-1)![1]!.body as FormData
    expect(body.get('expectedEtag')).toBe('version-1')
    expect(body.get('overwrite')).toBe('true')
    expect(body.get('clearTopoLines')).toBe('true')
    expect(fixtures.toast).toHaveBeenCalledWith('已保存，通知待完成', 'info', 5000)
  })

  it('检查失败保留当前选择和待上传图片，不进入覆盖确认或写入', async () => {
    vi.mocked(fetch).mockImplementation(async input => String(input).startsWith('/api/faces?')
      ? response({ success: true, faces }) : response({ success: false, error: '检查服务失败' }, false))
    await upload()
    await waitFor(() => expect(fixtures.toast).toHaveBeenCalledWith('检查服务失败', 'error', 4000))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getAllByText('当前 北区/same 线路 1,3')).toHaveLength(2)
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => (init?.body as FormData | undefined)?.has('file'))).toHaveLength(0)
  })

  it('部分错误重新请求线路与照片核对，不把未知结果显示为全部成功', async () => {
    const user = await upload()
    await screen.findByRole('dialog')
    vi.mocked(fetch).mockImplementation(async input => {
      if (input === '/api/upload') return response({ success: false, partial: true, imageChangeUnknown: true, error: '写入状态需要核对' }, false)
      if (String(input).startsWith('/api/faces?')) return response({ success: true, faces })
      return response({ success: true, routes: fixtures.routes })
    })
    await user.click(screen.getByRole('button', { name: '确认覆盖' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/crags/a/routes'))
    await waitFor(() => expect(fixtures.toast).toHaveBeenCalledWith('写入状态需要核对', 'error', 4000))
    expect(screen.getAllByText('当前 北区/same 线路 1,3')).toHaveLength(2)
    expect(fixtures.toast).not.toHaveBeenCalledWith('照片上传成功！', 'success', 3000)
  })
})
