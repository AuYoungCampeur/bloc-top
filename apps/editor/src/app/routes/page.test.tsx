import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BetaLink, Crag, Route } from '@bloctop/shared/types'
import RouteAnnotationPage from './page'

const showToast = vi.fn()
vi.mock('@bloctop/ui/components/toast', () => ({ useToast: () => ({ showToast }) }))
vi.mock('@/hooks/use-break-app-shell-limit', () => ({ useBreakAppShellLimit: () => {} }))
vi.mock('@/components/beta-submit-drawer', () => ({ BetaSubmitDrawer: () => null }))
vi.mock('@/components/editor/inline-face-upload', () => ({ InlineFaceUpload: () => null }))

const imageCache = { getImageUrl: () => null }
vi.mock('@bloctop/ui/face-image/use-face-image', () => ({ useFaceImageCache: () => imageCache }))

const betaA: BetaLink = {
  id: 'beta-a', platform: 'xiaohongshu', noteId: 'note-a',
  url: 'https://www.xiaohongshu.com/explore/note-a', title: 'A 标题',
  createdAt: new Date('2026-10-02T10:00:00Z'),
}
const betaB = { ...betaA, id: 'beta-b', noteId: 'note-b', title: 'B 标题' }
const betaC = { ...betaA, id: 'beta-c', noteId: 'note-c', title: 'C 标题' }
const initialRoutes: Route[] = [
  { id: 39, name: '测试线路 A', grade: 'V5', cragId: 'test-crag', area: '主墙', betaLinks: [betaA, betaB] },
  { id: 40, name: '测试线路 B', grade: 'V4', cragId: 'test-crag', area: '主墙', betaLinks: [betaC] },
]
const crags: Crag[] = [{
  id: 'test-crag', name: '测试岩场', cityId: 'test-city',
  location: '', description: '', approach: '', areas: ['主墙'],
}]

// Keep the real page, editing hooks, dirty guard and BetaCard. Only the remote
// collection loader and unrelated image/upload services are replaced.
vi.mock('@/hooks/use-crag-routes', async () => {
  const { useState } = await import('react')
  return {
    useCragRoutes: function useMockCragRoutes() {
      const [routes, setRoutes] = useState(initialRoutes)
      const [selectedCragId, setSelectedCragId] = useState<string | null>('test-crag')
      return {
        crags, routes, setRoutes, selectedCragId, setSelectedCragId,
        isLoadingCrags: false, isLoadingRoutes: false,
        stats: { total: routes.length, marked: 0, progress: 0 },
        updateCragAreas: async (_id: string, areas: string[]) => areas,
      }
    },
  }
})

const betaPatch = vi.fn<(init?: RequestInit) => Promise<Response>>()
const responseWith = (beta: BetaLink) => ({
  ok: true, json: async () => ({ success: true, beta }),
}) as Response

async function setup() {
  const user = userEvent.setup()
  const { container } = render(<RouteAnnotationPage />)
  // Both responsive panels exist in jsdom; scope normal interactions to the
  // desktop workbench while keeping the shared session banner in screen scope.
  const desktop = within(container.querySelector('.hidden.lg\\:flex') as HTMLElement)
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/faces?cragId=test-crag'))
  await user.click(desktop.getByRole('button', { name: /测试线路 A/ }))
  await user.click(desktop.getByRole('button', { name: /Beta 视频/ }))
  return { user, desktop }
}

describe('线路工作台 Beta 编辑入口', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    betaPatch.mockReset()
    globalThis.fetch = vi.fn(async (input, init) => {
      if (String(input).startsWith('/api/faces?')) {
        return { ok: true, json: async () => ({ success: true, faces: [] }) } as Response
      }
      if (input === '/api/beta' && init?.method === 'PATCH') return betaPatch(init)
      throw new Error(`未配置测试请求 ${String(input)}`)
    })
  })

  it('有当前草稿时其他编辑按钮禁用，显式取消后才允许编辑下一条', async () => {
    const { user, desktop } = await setup()
    await user.click(desktop.getAllByRole('button', { name: '编辑' })[0])
    const title = desktop.getByPlaceholderText('Beta 标题')
    await user.clear(title)
    await user.type(title, 'A 未保存草稿')

    const editB = desktop.getByRole('button', { name: '编辑' })
    expect(editB).toBeDisabled()
    expect(editB).toHaveAttribute('title', '请先保存或取消当前 Beta 编辑')
    await user.click(editB)
    expect(title).toHaveValue('A 未保存草稿')
    expect(screen.getByRole('button', { name: '取消当前 Beta 编辑' })).toBeEnabled()

    await user.click(desktop.getByRole('button', { name: '取消' }))
    await user.click(desktop.getAllByRole('button', { name: '编辑' })[1])
    expect(desktop.getByPlaceholderText('Beta 标题')).toHaveValue('B 标题')
  })

  it('成功保存采用服务器记录并释放会话，允许编辑其他 Beta', async () => {
    const { user, desktop } = await setup()
    betaPatch.mockResolvedValueOnce(responseWith({ ...betaA, title: '服务器已保存标题' }))
    await user.click(desktop.getAllByRole('button', { name: '编辑' })[0])
    await user.click(desktop.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: '取消当前 Beta 编辑' })).not.toBeInTheDocument())
    expect(desktop.getByText('服务器已保存标题')).toBeInTheDocument()
    expect(desktop.getAllByRole('button', { name: '编辑' })[1]).toBeEnabled()
    await user.click(desktop.getAllByRole('button', { name: '编辑' })[1])
    expect(desktop.getByPlaceholderText('Beta 标题')).toHaveValue('B 标题')
  })

  it('慢保存期间继续输入不丢失，响应到达后其他 Beta 仍不能覆盖草稿', async () => {
    const { user, desktop } = await setup()
    let resolveSave!: (response: Response) => void
    betaPatch.mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve }))
    await user.click(desktop.getAllByRole('button', { name: '编辑' })[0])
    await user.click(desktop.getByRole('button', { name: '保存' }))
    const title = desktop.getByPlaceholderText('Beta 标题')
    await user.clear(title)
    await user.type(title, '请求之后的新草稿')

    await act(async () => resolveSave(responseWith(betaA)))

    await waitFor(() => expect(desktop.getByRole('button', { name: '保存' })).toBeEnabled())
    expect(title).toHaveValue('请求之后的新草稿')
    expect(desktop.getByRole('button', { name: '编辑' })).toBeDisabled()
    expect(showToast).toHaveBeenCalledWith('已保存提交内容，后续 Beta 修改尚未保存', 'info', 4000)
    await user.click(screen.getByRole('button', { name: '取消当前 Beta 编辑' }))
    expect(desktop.getAllByRole('button', { name: '编辑' })[1]).toBeEnabled()
  })

  it('慢保存期间取消 A 再编辑 B，迟到响应不能关闭 B 或覆盖 B 的输入', async () => {
    const { user, desktop } = await setup()
    let resolveSave!: (response: Response) => void
    betaPatch.mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve }))
    await user.click(desktop.getAllByRole('button', { name: '编辑' })[0])
    await user.click(desktop.getByRole('button', { name: '保存' }))
    await user.click(desktop.getByRole('button', { name: '取消' }))
    await user.click(desktop.getAllByRole('button', { name: '编辑' })[1])
    const title = desktop.getByPlaceholderText('Beta 标题')
    await user.clear(title)
    await user.type(title, 'B 未保存输入')

    await act(async () => resolveSave(responseWith({ ...betaA, title: 'A 已保存' })))

    await waitFor(() => expect(desktop.getByRole('button', { name: '保存' })).toBeEnabled())
    expect(title).toHaveValue('B 未保存输入')
    expect(desktop.getByText('A 已保存')).toBeInTheDocument()
    expect(desktop.getByRole('button', { name: '编辑' })).toBeDisabled()
  })

  it('切换线路或区域后会话仍可取消，返回原线路保留草稿，不会锁死其他 Beta', async () => {
    const { user, desktop } = await setup()
    await user.click(desktop.getAllByRole('button', { name: '编辑' })[0])
    const title = desktop.getByPlaceholderText('Beta 标题')
    await user.clear(title)
    await user.type(title, '跨线路保留草稿')

    await user.click(desktop.getByRole('button', { name: /测试线路 B/ }))
    await user.click(desktop.getByRole('button', { name: /Beta 视频/ }))
    expect(desktop.getByRole('button', { name: '编辑' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '取消当前 Beta 编辑' })).toBeEnabled()
    await user.click(desktop.getByRole('button', { name: /测试线路 A/ }))
    await user.click(desktop.getByRole('button', { name: /Beta 视频/ }))
    expect(desktop.getByPlaceholderText('Beta 标题')).toHaveValue('跨线路保留草稿')

    await user.click(desktop.getByRole('button', { name: '主墙 (2)' }))
    expect(desktop.queryByPlaceholderText('Beta 标题')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '取消当前 Beta 编辑' }))
    await user.click(desktop.getByRole('button', { name: /测试线路 B/ }))
    await user.click(desktop.getByRole('button', { name: /Beta 视频/ }))
    await user.click(desktop.getByRole('button', { name: '编辑' }))
    expect(desktop.getByPlaceholderText('Beta 标题')).toHaveValue('C 标题')
  })
})
