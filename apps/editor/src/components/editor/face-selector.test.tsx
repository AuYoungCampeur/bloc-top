import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Route } from '@bloctop/shared/types'
import { useRouteEditor } from '@/hooks/use-route-editor'
import { FaceSelector } from './face-selector'

vi.mock('@bloctop/ui/components/toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
const faces = ['北区', '南区'].map(area => ({ faceId: 'same', area, routes: [], imageUrl: `https://img.example.com/${area}` }))
const route: Route = { id: 1, name: '跨区域线路', grade: 'V3', cragId: 'a', area: '业务区',
  topoAnnotations: [{ area: '北区', faceId: 'same', topoLine: [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.9 }] }] }
const cache = { getImageUrl: () => 'https://img.example.com/face.jpg' } as never
const setRoutes = vi.fn()
const updateAreas = vi.fn()
function Workbench() {
  const editor = useRouteEditor({ selectedRoute: route, faceImageCache: cache, setRoutes,
    selectedCragId: 'a', persistedAreas: ['北区', '南区'], updateCragAreas: updateAreas })
  return <>
    <FaceSelector faceGroups={faces} selectedFaceId={editor.selectedFaceId}
      selectedFaceArea={editor.annotations[editor.activeAnnotationIndex]?.area ?? null}
      isLoading={false} onSelect={editor.addAnnotation} />
    <p>标注数量 {editor.annotations.length} 当前 {editor.annotations[editor.activeAnnotationIndex]?.area}</p>
  </>
}

describe('真实 FaceSelector 区域身份', () => {
  it('同名跨区域只有当前图片选中，另一图片仍可点击并传完整目标', async () => {
    const user = userEvent.setup()
    const select = vi.fn()
    const { rerender } = render(<FaceSelector faceGroups={faces} selectedFaceId="same" selectedFaceArea="北区" isLoading={false} onSelect={select} />)
    const north = screen.getByRole('button', { name: '北区/same' })
    const south = screen.getByRole('button', { name: '南区/same' })
    expect(north).toHaveAttribute('aria-pressed', 'true')
    expect(south).toHaveAttribute('aria-pressed', 'false')
    await user.click(south)
    expect(select).toHaveBeenCalledWith('same', '南区')
    rerender(<FaceSelector faceGroups={faces} selectedFaceId="same" selectedFaceArea="南区" isLoading={false} onSelect={select} />)
    expect(south).toHaveAttribute('aria-pressed', 'true')
    expect(north).toHaveAttribute('aria-pressed', 'false')
  })

  it('已选同一 ID 和区域重复点击不触发添加', async () => {
    const user = userEvent.setup()
    const select = vi.fn()
    render(<FaceSelector faceGroups={faces} selectedFaceId="same" selectedFaceArea="北区" isLoading={false} onSelect={select} />)
    await user.click(screen.getByRole('button', { name: '北区/same' }))
    await user.click(screen.getByRole('button', { name: '北区/same' }))
    expect(select).not.toHaveBeenCalled()
  })

  it('实际线路编辑 hook 可添加另一同名区域，再回到已有区域不产生重复标注', async () => {
    const user = userEvent.setup()
    render(<Workbench />)
    await user.click(screen.getByRole('button', { name: '南区/same' }))
    expect(screen.getByText('标注数量 2 当前 南区')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '南区/same' }))
    expect(screen.getByText('标注数量 2 当前 南区')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '北区/same' }))
    expect(screen.getByText('标注数量 2 当前 北区')).toBeInTheDocument()
  })
})
