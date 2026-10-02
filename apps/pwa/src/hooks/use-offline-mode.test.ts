/**
 * use-offline-mode Hook 单元测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock 数据
const mockMeta = {
  crags: {
    'downloaded-crag': {
      cragName: '已下载岩场',
      routeCount: 10,
      downloadedAt: '2024-01-01',
      imageCount: 20,
    },
  },
  lastUpdated: '2024-01-01',
}

// Mock offline-storage 模块
vi.mock('@/lib/offline-storage', () => ({
  isOfflineAvailable: vi.fn((cragId: string) => cragId === 'downloaded-crag'),
  getMeta: vi.fn(() => mockMeta),
  META_STORAGE_KEY: 'offline-crags-meta',
  OFFLINE_META_EVENT: 'offline-meta-changed',
}))

// 需要在 mock 之后导入
import { useOfflineMode, useOnlineStatus, useShouldShowOfflineHint } from './use-offline-mode'
import { getMeta } from '@/lib/offline-storage'

describe('use-offline-mode', () => {
  // 保存原始的 navigator.onLine
  const originalOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine')

  beforeEach(() => {
    // 清理 localStorage
    localStorage.clear()

    // 设置 mock localStorage 数据，触发缓存更新
    localStorage.setItem('offline-crags-meta', JSON.stringify(mockMeta))

    // 默认设置为在线状态
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      writable: true,
      configurable: true,
    })

    // 重置 mock
    vi.mocked(getMeta).mockReturnValue(mockMeta)
  })

  afterEach(() => {
    // 恢复 navigator.onLine
    if (originalOnLine) {
      Object.defineProperty(navigator, 'onLine', originalOnLine)
    }
    localStorage.clear()
    vi.clearAllMocks()
  })

  // ==================== useOnlineStatus 测试 ====================

  describe('useOnlineStatus', () => {
    it('在线时应返回 true', () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })

      const { result } = renderHook(() => useOnlineStatus())

      expect(result.current).toBe(true)
    })

    it('离线时应返回 false', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })

      const { result } = renderHook(() => useOnlineStatus())

      expect(result.current).toBe(false)
    })

    it('网络状态变化时应更新', () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })

      const { result } = renderHook(() => useOnlineStatus())
      expect(result.current).toBe(true)

      // 模拟离线
      act(() => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
        window.dispatchEvent(new Event('offline'))
      })

      expect(result.current).toBe(false)

      // 模拟恢复在线
      act(() => {
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
        window.dispatchEvent(new Event('online'))
      })

      expect(result.current).toBe(true)
    })
  })

  // ==================== useOfflineMode 测试 ====================

  describe('useOfflineMode', () => {
    it('应返回正确的在线状态', () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })

      const { result } = renderHook(() => useOfflineMode())

      expect(result.current.isOnline).toBe(true)
      expect(result.current.isOffline).toBe(false)
    })

    it('应返回正确的离线状态', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })

      const { result } = renderHook(() => useOfflineMode())

      expect(result.current.isOnline).toBe(false)
      expect(result.current.isOffline).toBe(true)
    })

    it('应返回离线元数据', () => {
      const { result } = renderHook(() => useOfflineMode())

      expect(result.current.offlineCragsMeta.crags).toHaveProperty('downloaded-crag')
      expect(result.current.offlineCragsMeta.crags['downloaded-crag'].cragName).toBe('已下载岩场')
    })

    it('hasOfflineData 应正确检测已下载岩场', () => {
      const { result } = renderHook(() => useOfflineMode())

      expect(result.current.hasOfflineData('downloaded-crag')).toBe(true)
      expect(result.current.hasOfflineData('not-downloaded')).toBe(false)
    })

    it('应返回正确的离线岩场数量', () => {
      const { result } = renderHook(() => useOfflineMode())

      expect(result.current.offlineCragCount).toBe(1)
    })
  })

  // ==================== useShouldShowOfflineHint 测试 ====================

  describe('useShouldShowOfflineHint', () => {
    it('在线时应返回 false', () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })

      const { result } = renderHook(() => useShouldShowOfflineHint())

      expect(result.current).toBe(false)
    })

    it('离线且有离线数据时应返回 true', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })

      const { result } = renderHook(() => useShouldShowOfflineHint())

      expect(result.current).toBe(true)
    })

    it('离线但无离线数据时应返回 false', () => {
      // 清空 localStorage 并更新 mock
      localStorage.clear()
      localStorage.setItem('offline-crags-meta', JSON.stringify({ crags: {}, lastUpdated: '' }))
      vi.mocked(getMeta).mockReturnValue({ crags: {}, lastUpdated: '' })

      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })

      const { result } = renderHook(() => useShouldShowOfflineHint())

      expect(result.current).toBe(false)
    })
  })

  // ==================== 事件监听清理测试 ====================

  describe('事件监听', () => {
    it('卸载时应移除事件监听器', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

      const { unmount } = renderHook(() => useOnlineStatus())
      unmount()

      // 应该移除 online 和 offline 事件监听器
      expect(removeEventListenerSpy).toHaveBeenCalledWith('online', expect.any(Function))
      expect(removeEventListenerSpy).toHaveBeenCalledWith('offline', expect.any(Function))

      removeEventListenerSpy.mockRestore()
    })
  })
})
