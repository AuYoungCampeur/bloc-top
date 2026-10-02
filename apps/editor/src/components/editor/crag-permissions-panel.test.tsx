import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CragPermissionsPanel } from './crag-permissions-panel'

const showToast = vi.fn()
vi.mock('@bloctop/ui/components/toast', () => ({ useToast: () => ({ showToast }) }))
vi.mock('./add-manager-drawer', () => ({
  AddManagerDrawer: ({ isOpen, onAdded }: { isOpen: boolean; onAdded: () => void }) => isOpen ? <button onClick={onAdded}>刷新新增名单</button> : null,
}))

const userId = '507f1f77bcf86cd799439012'
const permission = (cragId: string, name: string) => ({
  userId, cragId, role: 'manager', assignedBy: '507f1f77bcf86cd799439011',
  createdAt: '2026-10-02T10:00:00Z', user: { name, email: `${name}@example.com` },
})
const list = (cragId: string, name: string) => ({ ok: true, json: async () => ({ success: true, permissions: [permission(cragId, name)] }) }) as Response

beforeEach(() => { vi.clearAllMocks(); globalThis.fetch = vi.fn() })

describe('CragPermissionsPanel 权限与响应归属', () => {
  it('非 admin 不请求或显示管理名单', () => {
    render(<CragPermissionsPanel cragId="crag-a" canManage={false} />)
    expect(screen.getByText('岩场权限名单仅系统管理员可查看和管理。')).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.queryByText('暂无权限记录')).not.toBeInTheDocument()
  })

  it('admin 加载真实名单，读取失败明确反馈并可重试', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({ success: false, error: '权限已失效' }) } as Response)
    const user = userEvent.setup()
    render(<CragPermissionsPanel cragId="crag-a" canManage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('权限已失效')
    expect(screen.queryByText('暂无权限记录')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加管理员' })).toBeDisabled()
    vi.mocked(fetch).mockResolvedValueOnce(list('crag-a', '管理员 A'))
    await user.click(screen.getByRole('button', { name: '重试加载权限' }))
    await screen.findByText('管理员 A')
    expect(screen.getByRole('button', { name: '添加管理员' })).toBeEnabled()
  })

  it('A 的迟到名单不能展示在 B，移除操作必须按 B 的身份提交', async () => {
    let resolveA!: (response: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { resolveA = resolve }))
    const user = userEvent.setup()
    const view = render(<CragPermissionsPanel cragId="crag-a" canManage />)
    vi.mocked(fetch).mockResolvedValueOnce(list('crag-b', 'B 管理员'))
    view.rerender(<CragPermissionsPanel cragId="crag-b" canManage />)
    await screen.findByText('B 管理员')
    await act(async () => resolveA(list('crag-a', 'A 管理员')))
    expect(screen.queryByText('A 管理员')).not.toBeInTheDocument()
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) } as Response)
    await user.click(screen.getByRole('button', { name: '移除权限' }))
    await waitFor(() => expect(screen.queryByText('B 管理员')).not.toBeInTheDocument())
    expect(JSON.parse(vi.mocked(fetch).mock.calls[2][1]?.body as string)).toEqual({ userId, cragId: 'crag-b' })
  })

  it('切换时立即隐藏旧名单，旧删除响应也不能移除新岩场的同一用户', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(list('crag-a', 'A 管理员'))
    const user = userEvent.setup()
    const view = render(<CragPermissionsPanel cragId="crag-a" canManage />)
    await screen.findByText('A 管理员')
    let resolveDelete!: (response: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { resolveDelete = resolve }))
    await user.click(screen.getByRole('button', { name: '移除权限' }))
    vi.mocked(fetch).mockResolvedValueOnce(list('crag-b', 'B 管理员'))
    view.rerender(<CragPermissionsPanel cragId="crag-b" canManage />)
    expect(screen.queryByText('A 管理员')).not.toBeInTheDocument()
    await screen.findByText('B 管理员')
    await act(async () => resolveDelete({ ok: true, json: async () => ({ success: true }) } as Response))
    expect(screen.getByText('B 管理员')).toBeInTheDocument()
  })

  it('撤销 admin 能力时正在加载的名单也不能重新出现', async () => {
    let resolve!: (response: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const view = render(<CragPermissionsPanel cragId="crag-a" canManage />)
    view.rerender(<CragPermissionsPanel cragId="crag-a" canManage={false} />)
    await act(async () => resolve(list('crag-a', '隐私名单')))
    expect(screen.queryByText('隐私名单')).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('移除失败等待错误反馈后仍保留记录', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(list('crag-a', '管理员 A'))
    const user = userEvent.setup()
    render(<CragPermissionsPanel cragId="crag-a" canManage />)
    await screen.findByText('管理员 A')
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({ success: false, error: '移除被拒绝' }) } as Response)
    await user.click(screen.getByRole('button', { name: '移除权限' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('移除被拒绝', 'error'))
    expect(screen.getByText('管理员 A')).toBeInTheDocument()
  })
})
