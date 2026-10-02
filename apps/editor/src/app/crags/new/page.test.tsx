import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixtures = vi.hoisted(() => ({
  auth: { data: { user: { id: '507f1f77bcf86cd799439011', role: 'admin' } } as { user: { id: string; role: string } } | null, isPending: false },
  push: vi.fn(), cities: vi.fn(), create: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: fixtures.push }) }))
vi.mock('@/lib/auth-client', () => ({ useSession: () => fixtures.auth }))
vi.mock('@/lib/auth', () => ({ getAuth: async () => ({ api: { getSession: async () => fixtures.auth.data } }) }))
vi.mock('@/hooks/use-break-app-shell-limit', () => ({ useBreakAppShellLimit: () => {} }))
vi.mock('@/lib/revalidate-pwa', () => ({ revalidateHomePage: vi.fn() }))
vi.mock('@bloctop/shared/logger', () => ({ createModuleLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) }))
vi.mock('@bloctop/shared/db', () => ({ getAllCities: fixtures.cities, getAllCrags: vi.fn(), getCragsByCityId: vi.fn() }))
vi.mock('@bloctop/shared/crag-creation', async importOriginal => ({
  ...await importOriginal<typeof import('@bloctop/shared/crag-creation')>(),
  createCragWithCreatorPermission: fixtures.create,
}))

import NewCragPage from './page'
import { POST } from '../../api/crags/route'

const city = { id: 'new-city', name: '待发布城市', available: false }
const namePlaceholder = '如：袁通寺'
const idPlaceholder = '如：yuan-tong-si（小写字母、数字、连字符）'

async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText(namePlaceholder), '袁通寺')
  await user.type(screen.getByPlaceholderText('详细地址'), '福建罗源')
  await user.type(screen.getByPlaceholderText('岩场描述、特色、注意事项等'), '花岗岩抱石')
  await user.type(screen.getByPlaceholderText('如何到达岩场，停车、步行路线等'), '沿小路步行')
}

async function setup() {
  const user = userEvent.setup()
  const view = render(<NewCragPage />)
  await screen.findByRole('combobox')
  return { user, ...view }
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  fixtures.auth = { data: { user: { id: '507f1f77bcf86cd799439011', role: 'admin' } }, isPending: false }
  fixtures.cities.mockResolvedValue([city])
  fixtures.create.mockImplementation(async input => ({ crag: { ...input, areas: [] }, replayed: false }))
  globalThis.fetch = vi.fn(async (input, init) => {
    if (input === '/api/cities') return { ok: true, json: async () => ({ success: true, cities: await fixtures.cities() }) } as Response
    if (input === '/api/crags') return POST(new NextRequest('http://localhost:3001/api/crags', init))
    throw new Error(`未配置测试请求 ${String(input)}`)
  })
})

describe('真实新建岩场页面与 POST handler', () => {
  it.each(['user', 'manager'])('深链接的 %s 看不到表单，也不加载城市或提交', async role => {
    fixtures.auth.data!.user.role = role
    render(<NewCragPage />)
    expect(screen.getByRole('alert')).toHaveTextContent('仅系统管理员')
    expect(screen.queryByPlaceholderText(namePlaceholder)).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('权限确认完成前不暴露表单', () => {
    fixtures.auth.isPending = true
    render(<NewCragPage />)
    expect(screen.getByRole('status')).toHaveTextContent('正在确认')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('连续输入/删除跟随 ID，中文名称生成拼音，手工 ID 不被覆盖', async () => {
    const { user } = await setup()
    const name = screen.getByPlaceholderText(namePlaceholder)
    const id = screen.getByPlaceholderText(idPlaceholder)
    await user.type(name, 'crag')
    expect(id).toHaveValue('crag')
    await user.keyboard('{Backspace}')
    expect(id).toHaveValue('cra')
    await user.clear(name)
    await user.type(name, '袁通寺')
    expect(id).toHaveValue('yuan-tong-si')
    await user.clear(id)
    await user.type(id, 'manual-id')
    await user.type(name, '新')
    expect(id).toHaveValue('manual-id')
  })

  it('未启用城市可管理录入，真实 handler 校验后调用原子创建，成功清除草稿', async () => {
    const { user } = await setup()
    expect(screen.getByRole('option', { name: '待发布城市（未启用）' })).toBeInTheDocument()
    await fillForm(user)
    await user.click(screen.getByRole('button', { name: '创建岩场' }))
    await waitFor(() => expect(fixtures.push).toHaveBeenCalledWith('/crags/yuan-tong-si'))
    expect(fixtures.create).toHaveBeenCalledWith({
      id: 'yuan-tong-si', name: '袁通寺', cityId: 'new-city', location: '福建罗源', description: '花岗岩抱石', approach: '沿小路步行',
    }, '507f1f77bcf86cd799439011')
    expect(sessionStorage.length).toBe(0)
  })

  it('失败保留输入并可重试，响应丢失后的 replay 200 也进入详情', async () => {
    const { user } = await setup()
    await fillForm(user)
    fixtures.create.mockRejectedValueOnce(new Error('事务暂不可用'))
    await user.click(screen.getByRole('button', { name: '创建岩场' }))
    await screen.findByRole('alert')
    expect(screen.getByPlaceholderText(namePlaceholder)).toHaveValue('袁通寺')
    expect(fixtures.push).not.toHaveBeenCalled()
    fixtures.create.mockResolvedValueOnce({ crag: { id: 'yuan-tong-si' }, replayed: true })
    await user.click(screen.getByRole('button', { name: '创建岩场' }))
    await waitFor(() => expect(fixtures.push).toHaveBeenCalledWith('/crags/yuan-tong-si'))
  })

  it('城市错误有重试入口，重试不清除已填名称；空列表明确提示', async () => {
    fixtures.cities.mockRejectedValueOnce(new Error('城市服务暂不可用'))
    const user = userEvent.setup()
    render(<NewCragPage />)
    await screen.findByRole('button', { name: '重试加载城市' })
    await user.type(screen.getByPlaceholderText(namePlaceholder), '保留名称')
    await user.click(screen.getByRole('button', { name: '重试加载城市' }))
    await screen.findByRole('combobox')
    expect(screen.getByPlaceholderText(namePlaceholder)).toHaveValue('保留名称')
  })

  it('零城市不允许提交且提示先创建城市', async () => {
    fixtures.cities.mockResolvedValue([])
    render(<NewCragPage />)
    await screen.findByText('暂无城市，请先在城市管理中创建城市。')
    expect(screen.getByRole('button', { name: '创建岩场' })).toBeDisabled()
  })

  it('保存在途锁住输入及返回，提交快照不会丢失后续输入', async () => {
    const { user } = await setup()
    await fillForm(user)
    let resolve!: (value: { crag: { id: string }; replayed: boolean }) => void
    fixtures.create.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    await user.click(screen.getByRole('button', { name: '创建岩场' }))
    expect(screen.getByPlaceholderText(namePlaceholder)).toBeDisabled()
    await user.type(screen.getByPlaceholderText(namePlaceholder), '不能输入')
    await user.click(screen.getByRole('button', { name: '返回' }))
    expect(screen.getByPlaceholderText(namePlaceholder)).toHaveValue('袁通寺')
    expect(fixtures.push).not.toHaveBeenCalled()
    await act(async () => resolve({ crag: { id: 'yuan-tong-si' }, replayed: false }))
    await waitFor(() => expect(fixtures.push).toHaveBeenCalledWith('/crags/yuan-tong-si'))
  })

  it('刷新/离开保留用户草稿，取消需明确放弃，其他用户不能恢复它', async () => {
    const { user, unmount } = await setup()
    await user.type(screen.getByPlaceholderText(namePlaceholder), '保留草稿')
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    unmount()
    const second = render(<NewCragPage />)
    await screen.findByRole('combobox')
    expect(screen.getByPlaceholderText(namePlaceholder)).toHaveValue('保留草稿')
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByText('放弃新建岩场草稿？')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '继续填写' }))
    expect(fixtures.push).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '返回' }))
    await user.click(screen.getByRole('button', { name: '放弃并返回' }))
    expect(sessionStorage.length).toBe(0)
    expect(fixtures.push).toHaveBeenCalledWith('/crags')
    second.unmount()
    fixtures.auth.data!.user.id = '507f1f77bcf86cd799439012'
    render(<NewCragPage />)
    await screen.findByRole('combobox')
    expect(screen.getByPlaceholderText(namePlaceholder)).toHaveValue('')
  })

  it('保留 A 用户草稿时，B 用户仍只恢复自己的草稿', async () => {
    const { user, unmount } = await setup()
    await user.type(screen.getByPlaceholderText(namePlaceholder), 'A 用户草稿')
    unmount()
    expect(sessionStorage.getItem('bloctop:new-crag:507f1f77bcf86cd799439011')).toContain('A 用户草稿')
    fixtures.auth.data!.user.id = '507f1f77bcf86cd799439012'
    render(<NewCragPage />)
    await screen.findByRole('combobox')
    expect(screen.getByPlaceholderText(namePlaceholder)).toHaveValue('')
    expect(sessionStorage.getItem('bloctop:new-crag:507f1f77bcf86cd799439011')).toContain('A 用户草稿')
  })

  it('A 创建在途切换到 B 用户，A 的迟到成功不导航或清除 B 草稿', async () => {
    const { user, rerender } = await setup()
    await fillForm(user)
    let finish!: (response: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await user.click(screen.getByRole('button', { name: '创建岩场' }))
    sessionStorage.setItem('bloctop:new-crag:507f1f77bcf86cd799439012', JSON.stringify({ id: 'b-draft', name: 'B 用户草稿', cityId: 'new-city', location: '', description: '', approach: '', coordinateInput: '' }))
    fixtures.auth = { data: { user: { id: '507f1f77bcf86cd799439012', role: 'admin' } }, isPending: false }
    rerender(<NewCragPage />)
    await waitFor(() => expect(screen.getByPlaceholderText(namePlaceholder)).toHaveValue('B 用户草稿'))
    await act(async () => finish({ ok: true, json: async () => ({ success: true, crag: { id: 'yuan-tong-si' } }) } as Response))
    expect(fixtures.push).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText(namePlaceholder)).toHaveValue('B 用户草稿')
    expect(sessionStorage.getItem('bloctop:new-crag:507f1f77bcf86cd799439012')).toContain('B 用户草稿')
  })
})
