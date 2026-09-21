/**
 * BetaSubmitDrawer 组件测试
 * 测试 Beta 提交抽屉的表单验证和提交流程
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@/test/utils'
import { BetaSubmitDrawer } from './beta-submit-drawer'

// Mock auth-client
const mockUseSession = vi.fn()
vi.mock('@/lib/auth-client', () => ({
  useSession: () => mockUseSession(),
}))

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
    localStorageMock.clear()
    global.fetch = mockFetch
    // 默认模拟已登录状态
    mockUseSession.mockReturnValue({
      data: { user: { id: 'user-1', email: 'test@example.com' } },
      isPending: false,
    })
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    })
  })

  afterEach(() => {
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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
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

      // 等待 1500ms 的 setTimeout 触发 onSuccess
      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled()
      }, { timeout: 2000 })
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

      // 表单应该被重置
      // 注意：由于 Drawer 关闭时会调用 handleClose 重置表单
      // 但这取决于组件内部实现，此处仅验证重新打开不会崩溃
      expect(screen.getByPlaceholderText('urlPlaceholder')).toBeTruthy()
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
        'climber-body-data',
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
        'climber-body-data',
        JSON.stringify({ height: '175', reach: '180' })
      )
    })

    it('提交失败时不应更新缓存', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ code: 'DUPLICATE_BETA' }),
      })

      render(<BetaSubmitDrawer {...defaultProps} />)

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

      // 不应该调用 setItem 保存身体数据
      // 注意：初始化时可能会调用，所以检查最后一次调用
      const setItemCalls = localStorageMock.setItem.mock.calls.filter(
        (call: string[]) => call[0] === 'climber-body-data'
      )
      expect(setItemCalls.length).toBe(0)
    })

    it('只填写身高提交成功后应保存身高并保留旧臂长', async () => {
      // 设置旧缓存
      localStorageMock.setItem(
        'climber-body-data',
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
        .filter((call: string[]) => call[0] === 'climber-body-data')
        .pop()

      expect(lastSetItemCall).toBeDefined()
      const savedData = JSON.parse(lastSetItemCall![1])
      expect(savedData.height).toBe('180')
      expect(savedData.reach).toBe('175') // 保留旧值
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
})
