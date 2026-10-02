import { act, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { useSession } from '@/lib/auth-client'
import { BetaSubmitDrawer } from './beta-submit-drawer'

const { mockUseSession, mockUpdateUser } = vi.hoisted(() => ({ mockUseSession: vi.fn(), mockUpdateUser: vi.fn() }))
vi.mock('@/lib/auth-client', () => ({ useSession: () => mockUseSession(), authClient: { updateUser: mockUpdateUser } }))
const mockFetch = vi.fn()
function sessionData(userId = 'user-1', sessionId = `session-${userId}`): NonNullable<ReturnType<typeof useSession>['data']> {
  const now = new Date('2026-10-02T10:00:00Z')
  return {
    user: { id: userId, name: userId, email: `${userId}@example.test`, emailVerified: true, banned: false, createdAt: now, updatedAt: now },
    session: { id: sessionId, userId, token: 'isolated-test-token', createdAt: now, updatedAt: now, expiresAt: new Date('2026-11-01T10:00:00Z') },
  }
}
function login(userId = 'user-1', sessionId?: string) {
  mockUseSession.mockReturnValue({ data: sessionData(userId, sessionId), error: null, isPending: false, isRefetching: false, refetch: vi.fn() })
}
const bodyKey = (id = 'user-1') => `climber-body-data:user:${id}`
const nicknameKey = (id = 'user-1') => `beta_nickname:user:${id}`

describe('BetaSubmitDrawer', () => {
  const defaultProps = { isOpen: true, onClose: vi.fn(), routeId: 1, routeName: '月光', onSuccess: vi.fn() }
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    localStorage.clear()
    vi.stubGlobal('fetch', mockFetch)
    mockUpdateUser.mockResolvedValue({ data: { status: true }, error: null })
    login()
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  describe('提交结果的账号、线路和抽屉归属', () => {
    const beta = { id: 'saved-beta', routeId: 1, platform: 'xiaohongshu', url: 'https://xhslink.cn/o/saved' }
    const response = () => ({ ok: true, json: async () => ({ success: true, beta }) })
    const input = (name: string) => screen.getByPlaceholderText(name) as HTMLInputElement
    const fill = (height = '175', name = '当前账号') => {
      fireEvent.change(input('直接粘贴小红书分享内容...'), { target: { value: 'https://xhslink.cn/o/abc' } })
      fireEvent.change(input('身高'), { target: { value: height } })
      fireEvent.change(input('臂展'), { target: { value: '180' } })
      fireEvent.change(input('你的昵称'), { target: { value: name } })
    }
    const clickSubmit = () => fireEvent.click(screen.getByText('贡献 Beta'))

    beforeEach(() => { vi.useFakeTimers() })

    it('实际提交只写当前账号的身体数据和昵称，不认领全局、匿名或其他账号值', async () => {
      localStorage.setItem('climber-body-data', JSON.stringify({ height: '199', reach: '200' }))
      localStorage.setItem('beta_nickname', '未知所有者')
      localStorage.setItem('climber-body-data:anonymous', JSON.stringify({ height: '195', reach: '196' }))
      localStorage.setItem(bodyKey('other'), JSON.stringify({ height: '188', reach: '189' }))
      mockFetch.mockResolvedValueOnce(response())
      render(<BetaSubmitDrawer {...defaultProps} />)
      expect(input('身高').value).toBe('')
      expect(input('臂展').value).toBe('')
      expect(input('你的昵称').value).toBe('')
      expect(mockUpdateUser).not.toHaveBeenCalled()
      fill()
      await act(async () => { clickSubmit() })
      expect(JSON.parse(localStorage.getItem(bodyKey())!)).toEqual({ height: '175', reach: '180' })
      expect(localStorage.getItem(nicknameKey())).toBe('当前账号')
      expect(mockUpdateUser).toHaveBeenCalledExactlyOnceWith({ height: 175, reach: 180 })
      expect(localStorage.getItem('beta_nickname')).toBe('未知所有者')
      expect(JSON.parse(localStorage.getItem('climber-body-data')!).height).toBe('199')
      expect(JSON.parse(localStorage.getItem('climber-body-data:anonymous')!).height).toBe('195')
      expect(JSON.parse(localStorage.getItem(bodyKey('other'))!).height).toBe('188')
      expect(screen.getByText('Beta 分享成功！')).toBeTruthy()
      await act(async () => { vi.advanceTimersByTime(1500) })
      expect(defaultProps.onSuccess).toHaveBeenCalledExactlyOnceWith(beta)
      expect(defaultProps.onClose).toHaveBeenCalledOnce()
    })

    it.each(['账号切换', '同账号重新登录', '线路切换', '关闭后重开'] as const)('%s后迟到POST不能覆盖新草稿、回调或偏好', async (context) => {
      let resolvePost!: (value: ReturnType<typeof response>) => void
      mockFetch.mockImplementationOnce(() => new Promise(resolve => { resolvePost = resolve }))
      const view = render(<BetaSubmitDrawer {...defaultProps} />)
      fill()
      clickSubmit()
      expect(screen.getByText('提交中...')).toBeTruthy()
      let nextProps = defaultProps
      if (context === '账号切换') login('user-2')
      if (context === '同账号重新登录') login('user-1', 'new-session')
      if (context === '线路切换') nextProps = { ...defaultProps, routeId: 2, routeName: '第二线路' }
      if (context === '关闭后重开') view.rerender(<BetaSubmitDrawer {...defaultProps} isOpen={false} />)
      view.rerender(<BetaSubmitDrawer {...nextProps} />)
      expect(input('直接粘贴小红书分享内容...').value).toBe('')
      expect(input('身高').value).toBe('')
      fill('160', '新草稿')
      await act(async () => { resolvePost(response()) })
      await act(async () => { vi.advanceTimersByTime(1600) })
      expect(input('身高').value).toBe('160')
      expect(input('你的昵称').value).toBe('新草稿')
      expect(input('直接粘贴小红书分享内容...').disabled).toBe(false)
      expect(screen.queryByText('Beta 分享成功！')).toBeNull()
      expect(defaultProps.onClose).not.toHaveBeenCalled()
      expect(defaultProps.onSuccess).not.toHaveBeenCalled()
      expect(mockUpdateUser).not.toHaveBeenCalled()
      expect(localStorage.getItem(nicknameKey())).toBeNull()
      expect(localStorage.getItem(nicknameKey('user-2'))).toBeNull()
      expect(JSON.parse(localStorage.getItem(bodyKey())!)).toEqual({ height: '', reach: '' })
    })

    it('A迟到完成不能结束B正在进行的提交，B成功只写B账号', async () => {
      let resolveA!: (value: ReturnType<typeof response>) => void
      let resolveB!: (value: ReturnType<typeof response>) => void
      mockFetch.mockImplementationOnce(() => new Promise(resolve => { resolveA = resolve }))
      mockFetch.mockImplementationOnce(() => new Promise(resolve => { resolveB = resolve }))
      const view = render(<BetaSubmitDrawer {...defaultProps} />)
      fill()
      clickSubmit()
      login('user-2')
      view.rerender(<BetaSubmitDrawer {...defaultProps} />)
      fill('160', '账号B')
      clickSubmit()
      await act(async () => { resolveA(response()) })
      expect(screen.getByText('提交中...')).toBeTruthy()
      expect(input('身高').value).toBe('160')
      expect(mockUpdateUser).not.toHaveBeenCalled()
      expect(defaultProps.onSuccess).not.toHaveBeenCalled()
      await act(async () => { resolveB(response()) })
      expect(screen.getByText('Beta 分享成功！')).toBeTruthy()
      expect(JSON.parse(localStorage.getItem(bodyKey('user-2'))!)).toEqual({ height: '160', reach: '180' })
      expect(localStorage.getItem(nicknameKey('user-2'))).toBe('账号B')
      expect(localStorage.getItem(nicknameKey())).toBeNull()
      expect(mockUpdateUser).toHaveBeenCalledExactlyOnceWith({ height: 160, reach: 180 })
    })

    it('已成功的旧抽屉关闭定时器不能误关切换后的账号抽屉', async () => {
      mockFetch.mockResolvedValueOnce(response())
      const view = render(<BetaSubmitDrawer {...defaultProps} />)
      fill()
      await act(async () => { clickSubmit() })
      expect(screen.getByText('Beta 分享成功！')).toBeTruthy()
      defaultProps.onSuccess.mockClear()
      login('user-2')
      view.rerender(<BetaSubmitDrawer {...defaultProps} />)
      fill('160', '新账号')
      await act(async () => { vi.advanceTimersByTime(1600) })
      expect(input('你的昵称').value).toBe('新账号')
      expect(defaultProps.onClose).not.toHaveBeenCalled()
      expect(defaultProps.onSuccess).not.toHaveBeenCalled()
    })
  })

})
