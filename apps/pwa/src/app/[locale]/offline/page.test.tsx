/**
 * 离线页面测试
 * 测试 AppTabbar 显示和岩场卡片点击行为
 */
/* eslint-disable @next/next/no-html-link-for-pages */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OfflinePage from './page'
import { getAllOfflineCrags, OfflineDBBlockedError } from '@/lib/offline-storage'

// Mock offline-storage
const mockOfflineCrags = [
  {
    cragId: 'ba-jing-cun',
    crag: {
      id: 'ba-jing-cun',
      name: '八井村',
      cityId: 'luoyuan',
      location: '罗源县八井村',
      developmentTime: '2023',
      description: '测试描述',
      approach: '测试接近方式',
    },
    routes: [
      { id: 1, name: '线路1', grade: 'V2', cragId: 'ba-jing-cun', area: '区域1' },
      { id: 2, name: '线路2', grade: 'V4', cragId: 'ba-jing-cun', area: '区域1' },
    ],
    downloadedAt: Date.now(),
  },
]

vi.mock('@/lib/offline-storage', () => ({
  getAllOfflineCrags: vi.fn(() => Promise.resolve(mockOfflineCrags)),
  OFFLINE_META_EVENT: 'offline-meta-changed',
  OfflineDBBlockedError: class OfflineDBBlockedError extends Error {},
}))

// Mock router.push
const mockPush = vi.fn()
vi.mock('next/navigation', async () => {
  const actual = await vi.importActual('next/navigation')
  return {
    ...actual,
    useRouter: () => ({
      push: mockPush,
      replace: vi.fn(),
      back: vi.fn(),
    }),
  }
})

// Mock AppTabbar component
vi.mock('@/components/app-tabbar', () => ({
  AppTabbar: () => (
    <nav data-testid="app-tabbar">
      <a href="/">home</a>
      <a href="/route">routes</a>
      <a href="/profile">settings</a>
    </nav>
  ),
}))

describe('OfflinePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState(null, '', '/zh/offline')
    // Mock navigator.onLine
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      writable: true,
      configurable: true,
    })
  })

  describe('AppTabbar 集成', () => {
    it('在页面底部显示 AppTabbar', async () => {
      render(<OfflinePage />)

      await waitFor(() => {
        expect(screen.getByTestId('app-tabbar')).toBeTruthy()
      })
    })

    it('AppTabbar 包含正确的导航链接', async () => {
      render(<OfflinePage />)

      await waitFor(() => {
        const tabbar = screen.getByTestId('app-tabbar')
        expect(tabbar.querySelector('a[href="/"]')).toBeTruthy()
        expect(tabbar.querySelector('a[href="/route"]')).toBeTruthy()
        expect(tabbar.querySelector('a[href="/profile"]')).toBeTruthy()
      })
    })
  })

  describe('岩场卡片点击行为', () => {
    it('点击岩场后在离线壳内读取完整线路，并且不请求服务端页面', async () => {
      const user = userEvent.setup()
      render(<OfflinePage />)

      // 等待数据加载
      await waitFor(() => {
        expect(screen.getByText('八井村')).toBeTruthy()
      })

      // 点击岩场卡片
      const cragButton = screen.getByRole('button', { name: /八井村/i })
      await user.click(cragButton)

      // 验证跳转到正确的 URL
      expect(mockPush).not.toHaveBeenCalled()
      expect(window.location.search).toBe('?offlineCrag=ba-jing-cun')
      expect(screen.getByText('测试描述')).toBeTruthy()
      await user.click(screen.getByRole('button', { name: 'V2 · 线路1' }))
      expect(screen.getByRole('heading', { name: '线路1' })).toBeTruthy()
      expect(window.location.search).toBe('?offlineCrag=ba-jing-cun&offlineRoute=1')
    })

    it('不再跳转到离线岩场详情页', async () => {
      const user = userEvent.setup()
      render(<OfflinePage />)

      await waitFor(() => {
        expect(screen.getByText('八井村')).toBeTruthy()
      })

      const cragButton = screen.getByRole('button', { name: /八井村/i })
      await user.click(cragButton)

      // 确保不会跳转到旧的离线详情页
      expect(mockPush).not.toHaveBeenCalledWith(expect.stringContaining('/offline/crag/'))
    })
  })

  it('explains blocked upgrade instead of claiming no offline downloads exist', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getAllOfflineCrags).mockRejectedValueOnce(new OfflineDBBlockedError())
    render(<OfflinePage />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('storageBlocked'))
    expect(screen.queryByText('noDownloads')).toBeNull()
    consoleError.mockRestore()
  })

  describe('基础渲染', () => {
    it('显示页面标题', async () => {
      render(<OfflinePage />)

      await waitFor(() => {
        expect(screen.getByText('title')).toBeTruthy()
      })
    })

    it('显示已下载岩场数量', async () => {
      render(<OfflinePage />)

      await waitFor(() => {
        // Mock 的翻译函数会直接返回 key + 参数
        expect(screen.getByText(/downloadedCrags/i)).toBeTruthy()
      })
    })

    it('显示岩场线路数量', async () => {
      render(<OfflinePage />)

      await waitFor(() => {
        // routeCount 带参数 count: 2
        expect(screen.getByText(/routeCount/i)).toBeTruthy()
      })
    })
  })

  describe('网络状态', () => {
    it('离线时不显示返回首页按钮', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
      render(<OfflinePage />)

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'goHome' })).not.toBeTruthy()
      })
    })

    it('在线时显示返回首页按钮', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
      render(<OfflinePage />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'goHome' })).toBeTruthy()
      })
    })
  })
})
