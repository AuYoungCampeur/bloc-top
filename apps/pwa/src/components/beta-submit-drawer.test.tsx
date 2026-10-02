/**
 * BetaSubmitDrawer 组件测试
 * 测试 Beta 提交抽屉的表单验证和提交流程
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@/test/utils'
import type { useSession } from '@/lib/auth-client'
import { BetaSubmitDrawer } from './beta-submit-drawer'

// Mock auth-client
const { mockUseSession, mockUpdateUser } = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
  mockUpdateUser: vi.fn(),
}))
vi.mock('@/lib/auth-client', () => ({
  useSession: () => mockUseSession(),
  authClient: { updateUser: mockUpdateUser },
}))

// Match the actual Better Auth hook payload, including the server session.
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

// Mock fetch
const mockFetch = vi.fn()

// 模拟 localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
  }
})()

describe('BetaSubmitDrawer', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    routeId: 1,
    routeName: '月光',
    onSuccess: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    mockUpdateUser.mockResolvedValue({ data: { status: true }, error: null })
    localStorageMock.clear()
    global.fetch = mockFetch
    // 默认模拟已登录状态
    login()
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('渲染', () => {
    it('应该渲染表单字段', () => {
      render(<BetaSubmitDrawer {...defaultProps} />)

      expect(screen.getByText('urlLabel')).toBeTruthy()
      expect(screen.getByText('bodyDataLabel')).toBeTruthy()
    })

    it('应该渲染 URL 输入框', () => {
      render(<BetaSubmitDrawer {...defaultProps} />)

      expect(screen.getByPlaceholderText('urlPlaceholder')).toBeTruthy()
    })

    it('应该渲染身高和臂长输入框', () => {
      render(<BetaSubmitDrawer {...defaultProps} />)

      expect(screen.getByPlaceholderText('heightPlaceholder')).toBeTruthy()
      expect(screen.getByPlaceholderText('reachPlaceholder')).toBeTruthy()
    })

    it('应该渲染提交按钮', () => {
      render(<BetaSubmitDrawer {...defaultProps} />)

      expect(screen.getByText('submit')).toBeTruthy()
    })
  })

  describe('URL 验证', () => {
    it('URL 为空时提交按钮应禁用', () => {
      render(<BetaSubmitDrawer {...defaultProps} />)

      const submitButton = screen.getByText('submit')
      expect((submitButton as HTMLButtonElement).disabled).toBe(true)
    })

    it('输入 URL 后提交按钮应启用', async () => {
      render(<BetaSubmitDrawer {...defaultProps} />)

      const urlInput = screen.getByPlaceholderText('urlPlaceholder')
      fireEvent.change(urlInput, { target: { value: 'https://xhslink.com/abc' } })

      await waitFor(() => {
        const submitButton = screen.getByText('submit')
        expect((submitButton as HTMLButtonElement).disabled).toBe(false)
      })
    })

    it('非小红书 URL 应显示错误', async () => {
      render(<BetaSubmitDrawer {...defaultProps} />)

      const urlInput = screen.getByPlaceholderText('urlPlaceholder')
      fireEvent.change(urlInput, { target: { value: 'https://example.com/video' } })

      const submitButton = screen.getByText('submit')
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(screen.getByText('onlyXiaohongshu')).toBeTruthy()
      })
    })

    it('小红书 URL 应检测平台', async () => {
      render(<BetaSubmitDrawer {...defaultProps} />)

      const urlInput = screen.getByPlaceholderText('urlPlaceholder')
      fireEvent.change(urlInput, { target: { value: 'https://xhslink.com/abc123' } })

      await waitFor(() => {
        expect(screen.getByText('urlDetected')).toBeTruthy()
      })
    })

    it('应该接受并提交小红书 .cn 分享文本中的短链', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })
      render(<BetaSubmitDrawer {...defaultProps} />)

      const urlInput = screen.getByPlaceholderText('urlPlaceholder') as HTMLInputElement
      fireEvent.change(urlInput, {
        target: { value: '福州罗源野抱 - 晨钟暮鼓 V6 [https://xhslink.cn/o/AsU8BTN9oIl](https://xhslink.cn/o/AsU8BTN9oIl) Copy and open rednote to view the note' },
      })

      expect(urlInput.value).toBe('https://xhslink.cn/o/AsU8BTN9oIl')
      expect(screen.getByText('urlDetected')).toBeTruthy()
      fireEvent.click(screen.getByText('submit'))

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/beta', expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"url":"https://xhslink.cn/o/AsU8BTN9oIl"'),
        }))
      })
    })
  })

  describe('表单提交', () => {
    it('提交成功应显示成功提示', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      render(<BetaSubmitDrawer {...defaultProps} />)

      const urlInput = screen.getByPlaceholderText('urlPlaceholder')
      fireEvent.change(urlInput, { target: { value: 'https://xhslink.com/abc123' } })

      const submitButton = screen.getByText('submit')
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(screen.getByText('submitSuccess')).toBeTruthy()
      })
    })

    it('提交失败应显示错误提示', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ code: 'DUPLICATE_BETA' }),
      })

      render(<BetaSubmitDrawer {...defaultProps} />)

      const urlInput = screen.getByPlaceholderText('urlPlaceholder')
      fireEvent.change(urlInput, { target: { value: 'https://xhslink.com/abc123' } })

      const submitButton = screen.getByText('submit')
      fireEvent.click(submitButton)

      await waitFor(() => {
        // 错误消息会被翻译
        expect(screen.getByText('DUPLICATE_BETA')).toBeTruthy()
      })
    })

    it('提交时应传递身高和臂长', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      render(<BetaSubmitDrawer {...defaultProps} />)

      // 填写表单
      fireEvent.change(screen.getByPlaceholderText('urlPlaceholder'), {
        target: { value: 'https://xhslink.com/abc123' },
      })
      fireEvent.change(screen.getByPlaceholderText('heightPlaceholder'), {
        target: { value: '175' },
      })
      fireEvent.change(screen.getByPlaceholderText('reachPlaceholder'), {
        target: { value: '180' },
      })

      fireEvent.click(screen.getByText('submit'))

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/beta', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            routeId: 1,
            url: 'https://xhslink.com/abc123',
            climberHeight: 175,
            climberReach: 180,
          }),
        })
      })
    })
  })

  describe('表单状态', () => {
    it('提交中应显示 loading 状态', async () => {
      // 延迟响应以捕获 loading 状态
      mockFetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(
          () => resolve({
            ok: true,
            json: () => Promise.resolve({ success: true }),
          }),
          100
        ))
      )

      render(<BetaSubmitDrawer {...defaultProps} />)

      fireEvent.change(screen.getByPlaceholderText('urlPlaceholder'), {
        target: { value: 'https://xhslink.com/abc123' },
      })

      fireEvent.click(screen.getByText('submit'))

      await waitFor(() => {
        expect(screen.getByText('submitting')).toBeTruthy()
      })
    })

    it('提交成功后应调用 onSuccess', async () => {
      const onSuccess = vi.fn()
      const beta = { id: 'beta-new', platform: 'xiaohongshu', url: 'https://www.xiaohongshu.com/explore/6797869e0000000029017615' }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, beta }),
      })

      render(<BetaSubmitDrawer {...defaultProps} onSuccess={onSuccess} />)

      fireEvent.change(screen.getByPlaceholderText('urlPlaceholder'), {
        target: { value: 'https://xhslink.com/abc123' },
      })

      fireEvent.click(screen.getByText('submit'))

      // 等待 success 状态
      await waitFor(() => {
        expect(screen.getByText('submitSuccess')).toBeTruthy()
      })

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(beta)
      })
    })
  })

  describe('关闭行为', () => {
    it('关闭时应重置表单', async () => {
      const onClose = vi.fn()
      const { rerender } = render(
        <BetaSubmitDrawer {...defaultProps} onClose={onClose} />
      )

      // 填写表单
      fireEvent.change(screen.getByPlaceholderText('urlPlaceholder'), {
        target: { value: 'https://xhslink.com/abc123' },
      })

      // 关闭并重新打开
      rerender(<BetaSubmitDrawer {...defaultProps} isOpen={false} onClose={onClose} />)
      rerender(<BetaSubmitDrawer {...defaultProps} isOpen={true} onClose={onClose} />)

      expect((screen.getByPlaceholderText('urlPlaceholder') as HTMLInputElement).value).toBe('')
    })
  })

  describe('抽屉状态', () => {
    it('isOpen=false 时不应渲染内容', () => {
      render(<BetaSubmitDrawer {...defaultProps} isOpen={false} />)

      expect(screen.queryByText('urlLabel')).not.toBeTruthy()
    })
  })

  describe('身体数据缓存', () => {
    it('有缓存数据时表单应预填充身高和臂长', () => {
      // 设置缓存数据
      localStorageMock.setItem(
        bodyKey(),
        JSON.stringify({ height: '175', reach: '180' })
      )

      render(<BetaSubmitDrawer {...defaultProps} />)

      const heightInput = screen.getByPlaceholderText('heightPlaceholder') as HTMLInputElement
      const reachInput = screen.getByPlaceholderText('reachPlaceholder') as HTMLInputElement

      expect(heightInput.value).toBe('175')
      expect(reachInput.value).toBe('180')
    })

    it('无缓存数据时表单字段应为空', () => {
      render(<BetaSubmitDrawer {...defaultProps} />)

      const heightInput = screen.getByPlaceholderText('heightPlaceholder') as HTMLInputElement
      const reachInput = screen.getByPlaceholderText('reachPlaceholder') as HTMLInputElement

      expect(heightInput.value).toBe('')
      expect(reachInput.value).toBe('')
    })

    it('提交成功后应将身高和臂长存入缓存', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      render(<BetaSubmitDrawer {...defaultProps} />)

      // 填写表单
      fireEvent.change(screen.getByPlaceholderText('urlPlaceholder'), {
        target: { value: 'https://xhslink.com/abc123' },
      })
      fireEvent.change(screen.getByPlaceholderText('heightPlaceholder'), {
        target: { value: '175' },
      })
      fireEvent.change(screen.getByPlaceholderText('reachPlaceholder'), {
        target: { value: '180' },
      })

      fireEvent.click(screen.getByText('submit'))

      await waitFor(() => {
        expect(screen.getByText('submitSuccess')).toBeTruthy()
      })

      // 验证缓存数据
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        bodyKey(),
        JSON.stringify({ height: '175', reach: '180' })
      )
      expect(mockUpdateUser).toHaveBeenCalledExactlyOnceWith({ height: 175, reach: 180 })
      expect(localStorageMock.setItem.mock.calls.every(([key]) => key === bodyKey())).toBe(true)
    })

    it('提交失败时不应更新缓存', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ code: 'DUPLICATE_BETA' }),
      })

      render(<BetaSubmitDrawer {...defaultProps} />)
      localStorageMock.setItem.mockClear()

      // 填写表单
      fireEvent.change(screen.getByPlaceholderText('urlPlaceholder'), {
        target: { value: 'https://xhslink.com/abc123' },
      })
      fireEvent.change(screen.getByPlaceholderText('heightPlaceholder'), {
        target: { value: '175' },
      })

      fireEvent.click(screen.getByText('submit'))

      await waitFor(() => {
        expect(screen.getByText('DUPLICATE_BETA')).toBeTruthy()
      })

      // Hydration is allowed; a failed POST must not persist the submitted values.
      const setItemCalls = localStorageMock.setItem.mock.calls.filter(
        (call: string[]) => call[0] === bodyKey()
      )
      expect(setItemCalls.length).toBe(0)
      expect(mockUpdateUser).not.toHaveBeenCalled()
    })

    it('只填写身高提交成功后应保存身高并保留旧臂长', async () => {
      // 设置旧缓存
      localStorageMock.setItem(
        bodyKey(),
        JSON.stringify({ height: '170', reach: '175' })
      )

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      render(<BetaSubmitDrawer {...defaultProps} />)

      // 只修改身高，清空臂长
      fireEvent.change(screen.getByPlaceholderText('urlPlaceholder'), {
        target: { value: 'https://xhslink.com/abc123' },
      })
      fireEvent.change(screen.getByPlaceholderText('heightPlaceholder'), {
        target: { value: '180' },
      })
      fireEvent.change(screen.getByPlaceholderText('reachPlaceholder'), {
        target: { value: '' },
      })

      fireEvent.click(screen.getByText('submit'))

      await waitFor(() => {
        expect(screen.getByText('submitSuccess')).toBeTruthy()
      })

      // 验证：身高更新，臂长保留旧值
      const lastSetItemCall = localStorageMock.setItem.mock.calls
        .filter((call: string[]) => call[0] === bodyKey())
        .pop()

      expect(lastSetItemCall).toBeDefined()
      const savedData = JSON.parse(lastSetItemCall![1])
      expect(savedData.height).toBe('180')
      expect(savedData.reach).toBe('175') // 保留旧值
      expect(mockUpdateUser).toHaveBeenCalledExactlyOnceWith({ height: 180 })
    })
  })

  describe('未登录状态', () => {
    beforeEach(() => {
      mockUseSession.mockReturnValue({ data: null, isPending: false })
    })

    it('未登录时应显示登录提示而非表单', () => {
      render(<BetaSubmitDrawer {...defaultProps} />)

      // 应显示登录提示
      expect(screen.getByText('loginRequired')).toBeTruthy()
      expect(screen.getByText('loginToShare')).toBeTruthy()
      expect(screen.getByText('loginOrRegister')).toBeTruthy()

      // 不应显示表单字段
      expect(screen.queryByPlaceholderText('urlPlaceholder')).toBeNull()
      expect(screen.queryByText('submit')).toBeNull()
    })

    it('登录按钮应链接到登录页', () => {
      render(<BetaSubmitDrawer {...defaultProps} />)

      const loginLink = screen.getByText('loginOrRegister')
      expect(loginLink.closest('a')).toBeTruthy()
      expect(loginLink.closest('a')?.getAttribute('href')).toContain('/login')
    })
  })
  describe('提交结果的账号、线路和抽屉归属', () => {
    const beta = { id: 'saved-beta', routeId: 1, platform: 'xiaohongshu', url: 'https://xhslink.cn/o/saved' }
    const response = () => ({ ok: true, json: async () => ({ success: true, beta }) })
    const input = (name: string) => screen.getByPlaceholderText(name) as HTMLInputElement
    const fill = (height = '175', name = '当前账号') => {
      fireEvent.change(input('urlPlaceholder'), { target: { value: 'https://xhslink.cn/o/abc' } })
      fireEvent.change(input('heightPlaceholder'), { target: { value: height } })
      fireEvent.change(input('reachPlaceholder'), { target: { value: '180' } })
      fireEvent.change(input('nicknamePlaceholder'), { target: { value: name } })
    }
    const clickSubmit = () => fireEvent.click(screen.getByText('submit'))

    beforeEach(() => { vi.useFakeTimers() })

    it('实际提交只写当前账号的身体数据和昵称，不认领全局、匿名或其他账号值', async () => {
      localStorage.setItem('climber-body-data', JSON.stringify({ height: '199', reach: '200' }))
      localStorage.setItem('beta_nickname', '未知所有者')
      localStorage.setItem('climber-body-data:anonymous', JSON.stringify({ height: '195', reach: '196' }))
      localStorage.setItem(bodyKey('other'), JSON.stringify({ height: '188', reach: '189' }))
      mockFetch.mockResolvedValueOnce(response())
      render(<BetaSubmitDrawer {...defaultProps} />)
      expect(input('heightPlaceholder').value).toBe('')
      expect(input('reachPlaceholder').value).toBe('')
      expect(input('nicknamePlaceholder').value).toBe('')
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
      expect(screen.getByText('submitSuccess')).toBeTruthy()
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
      expect(screen.getByText('submitting')).toBeTruthy()
      let nextProps = defaultProps
      if (context === '账号切换') login('user-2')
      if (context === '同账号重新登录') login('user-1', 'new-session')
      if (context === '线路切换') nextProps = { ...defaultProps, routeId: 2, routeName: '第二线路' }
      if (context === '关闭后重开') view.rerender(<BetaSubmitDrawer {...defaultProps} isOpen={false} />)
      view.rerender(<BetaSubmitDrawer {...nextProps} />)
      expect(input('urlPlaceholder').value).toBe('')
      expect(input('heightPlaceholder').value).toBe('')
      fill('160', '新草稿')
      await act(async () => { resolvePost(response()) })
      await act(async () => { vi.advanceTimersByTime(1600) })
      expect(input('heightPlaceholder').value).toBe('160')
      expect(input('nicknamePlaceholder').value).toBe('新草稿')
      expect(input('urlPlaceholder').disabled).toBe(false)
      expect(screen.queryByText('submitSuccess')).toBeNull()
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
      expect(screen.getByText('submitting')).toBeTruthy()
      expect(input('heightPlaceholder').value).toBe('160')
      expect(mockUpdateUser).not.toHaveBeenCalled()
      expect(defaultProps.onSuccess).not.toHaveBeenCalled()
      await act(async () => { resolveB(response()) })
      expect(screen.getByText('submitSuccess')).toBeTruthy()
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
      expect(screen.getByText('submitSuccess')).toBeTruthy()
      defaultProps.onSuccess.mockClear()
      login('user-2')
      view.rerender(<BetaSubmitDrawer {...defaultProps} />)
      fill('160', '新账号')
      await act(async () => { vi.advanceTimersByTime(1600) })
      expect(input('nicknamePlaceholder').value).toBe('新账号')
      expect(defaultProps.onClose).not.toHaveBeenCalled()
      expect(defaultProps.onSuccess).not.toHaveBeenCalled()
    })
  })

})
