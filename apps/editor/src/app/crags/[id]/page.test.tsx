import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Suspense } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CragDetailPage from './page'
import { PUBLISHING_DELAY_MESSAGE } from '@/lib/publishing-feedback'

const fixtures = vi.hoisted(() => ({ session: { user: { id: 'admin', role: 'admin' } }, router: { push: vi.fn() }, toast: vi.fn() }))
vi.mock('@bloctop/ui/components/toast', () => ({ useToast: () => ({ showToast: fixtures.toast }) }))
vi.mock('next/navigation', () => ({ useRouter: () => fixtures.router }))
vi.mock('@/lib/auth-client', () => ({ useSession: () => ({ data: fixtures.session }) }))
vi.mock('@/hooks/use-break-app-shell-limit', () => ({ useBreakAppShellLimit: () => {} }))
vi.mock('@/components/editor/crag-permissions-panel', () => ({ CragPermissionsPanel: () => null }))

beforeEach(() => {
  vi.clearAllMocks()
  fixtures.session = { user: { id: 'admin', role: 'admin' } }
  globalThis.fetch = vi.fn(async input => ({ ok: true, json: async () => String(input).includes('/api/editor/crags')
    ? { crags: [] }
    : { success: true, crag: { id: 'crag-b', name: '岩场 B', cityId: 'new-city', location: '位置', description: '描述', approach: '接近' } },
  }) as Response)
})

describe('岩场详情内容管理入口', () => {
  it('保存成功但发布通知待完成采用服务器岩场并退出编辑，只提示延迟不重复保存', async () => {
    const crag = { id: 'crag-b', name: '服务端规范名称', cityId: 'new-city', location: '位置', description: '描述', approach: '接近' }
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (input, init) => init?.method === 'PATCH'
      ? { ok: true, json: async () => ({ success: true, crag, refreshPending: true }) } as Response
      : originalFetch(input, init))
    const user = userEvent.setup()
    await act(async () => { render(<Suspense><CragDetailPage params={Promise.resolve({ id: 'crag-b' })} /></Suspense>) })
    await user.click(await screen.findByRole('button', { name: '编辑岩场信息' }))
    await user.clear(screen.getByPlaceholderText('岩场名称'))
    await user.type(screen.getByPlaceholderText('岩场名称'), '新名称')
    await user.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByRole('heading', { name: '服务端规范名称' })
    expect(screen.queryByPlaceholderText('岩场名称')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(fixtures.toast).toHaveBeenCalledWith(PUBLISHING_DELAY_MESSAGE, 'info', 8000)
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1)
  })

  it('admin 从当前详情进入岩面/线路时携带同一岩场 ID', async () => {
    await act(async () => { render(<Suspense><CragDetailPage params={Promise.resolve({ id: 'crag-b' })} /></Suspense>) })
    expect(await screen.findByRole('link', { name: '管理岩面' })).toHaveAttribute('href', '/faces?cragId=crag-b')
    expect(screen.getByRole('link', { name: '管理线路与 Beta' })).toHaveAttribute('href', '/routes?cragId=crag-b')
  })

  it('无该岩场编辑权限的用户不出现管理入口', async () => {
    fixtures.session = { user: { id: 'manager-a', role: 'user' } }
    await act(async () => { render(<Suspense><CragDetailPage params={Promise.resolve({ id: 'crag-b' })} /></Suspense>) })
    await screen.findByRole('heading', { name: '岩场 B' })
    expect(screen.queryByRole('link', { name: '管理岩面' })).not.toBeInTheDocument()
  })

  it('admin 会话变为普通用户时立即收起管理入口，不沿用旧角色授权', async () => {
    const params = Promise.resolve({ id: 'crag-b' })
    let view!: ReturnType<typeof render>
    await act(async () => { view = render(<Suspense><CragDetailPage params={params} /></Suspense>) })
    await screen.findByRole('link', { name: '管理岩面' })
    fixtures.session = { user: { id: 'admin', role: 'user' } }
    await act(async () => { view.rerender(<Suspense><CragDetailPage params={params} /></Suspense>) })
    expect(screen.queryByRole('link', { name: '管理岩面' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑岩场' })).not.toBeInTheDocument()
  })
})
