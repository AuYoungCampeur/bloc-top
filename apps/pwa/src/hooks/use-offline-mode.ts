'use client'

/**
 * 离线模式检测 Hook
 *
 * 提供统一的离线状态检测，支持：
 * - 网络状态监听
 * - IndexedDB 数据可用性检测
 * - 离线模式下的自动路由建议
 */

import { useSyncExternalStore, useCallback } from 'react'
import { isOfflineAvailable, getMeta, META_STORAGE_KEY, OFFLINE_META_EVENT, type OfflineCragsMeta } from '@/lib/offline-storage'

// ==================== 网络状态监听 ====================

/**
 * 订阅网络状态变化
 */
function subscribeToOnlineStatus(callback: () => void) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

/**
 * 获取当前网络状态
 */
function getOnlineSnapshot() {
  return navigator.onLine
}

/**
 * 服务端渲染时的默认值
 */
function getServerOnlineSnapshot() {
  return true // 服务端假设在线
}

// ==================== 离线元数据订阅 ====================

/**
 * 缓存离线元数据
 *
 * useSyncExternalStore 要求 getSnapshot 返回引用相同的值（如果数据未变化）
 * 否则会触发无限重渲染
 */
let cachedMetaJson: string | null = null
let cachedMeta: OfflineCragsMeta = { crags: {}, lastUpdated: '' }
const emptyMeta: OfflineCragsMeta = { crags: {}, lastUpdated: '' }

/**
 * 订阅 localStorage 变化（用于离线元数据）
 */
function subscribeToOfflineMeta(callback: () => void) {
  const handleStorage = (e: StorageEvent) => {
    if (e.key === META_STORAGE_KEY) {
      callback()
    }
  }
  window.addEventListener('storage', handleStorage)
  window.addEventListener(OFFLINE_META_EVENT, callback)
  return () => {
    window.removeEventListener('storage', handleStorage)
    window.removeEventListener(OFFLINE_META_EVENT, callback)
  }
}

/**
 * 获取当前离线元数据（带缓存）
 *
 * 只有当 localStorage 中的数据实际变化时才返回新对象
 */
function getOfflineMetaSnapshot(): OfflineCragsMeta {
  if (typeof localStorage === 'undefined') {
    return emptyMeta
  }

  const current = getMeta()
  const currentJson = JSON.stringify(current)

  // 如果 JSON 字符串没变，返回缓存的对象（引用不变）
  if (currentJson === cachedMetaJson) {
    return cachedMeta
  }

  // JSON 变化了，解析并缓存新对象
  cachedMetaJson = currentJson
  cachedMeta = current
  return cachedMeta
}

/**
 * 服务端渲染时的离线元数据默认值
 */
function getServerOfflineMetaSnapshot(): OfflineCragsMeta {
  return emptyMeta
}

// ==================== Hook 实现 ====================

export interface OfflineModeState {
  /** 是否在线 */
  isOnline: boolean
  /** 是否离线 */
  isOffline: boolean
  /** 已下载的岩场元数据 */
  offlineCragsMeta: OfflineCragsMeta
  /** 检查指定岩场是否有离线数据 */
  hasOfflineData: (cragId: string) => boolean
  /** 获取已下载岩场数量 */
  offlineCragCount: number
}

/**
 * 离线模式检测 Hook
 *
 * @example
 * ```tsx
 * const { isOffline, hasOfflineData, offlineCragCount } = useOfflineMode()
 *
 * if (isOffline && hasOfflineData('yuan-tong-si')) {
 *   // 可以使用离线数据
 * }
 * ```
 */
export function useOfflineMode(): OfflineModeState {
  // 使用 useSyncExternalStore 监听网络状态，避免 hydration 问题
  const isOnline = useSyncExternalStore(
    subscribeToOnlineStatus,
    getOnlineSnapshot,
    getServerOnlineSnapshot
  )

  // 使用 useSyncExternalStore 监听离线元数据变化
  const offlineCragsMeta = useSyncExternalStore(
    subscribeToOfflineMeta,
    getOfflineMetaSnapshot,
    getServerOfflineMetaSnapshot
  )

  // 检查指定岩场是否有离线数据
  const hasOfflineData = useCallback((cragId: string): boolean => {
    return isOfflineAvailable(cragId)
  }, [])

  // 计算已下载岩场数量
  const offlineCragCount = Object.keys(offlineCragsMeta.crags).length

  return {
    isOnline,
    isOffline: !isOnline,
    offlineCragsMeta,
    hasOfflineData,
    offlineCragCount,
  }
}

/**
 * 仅监听网络状态的轻量级 Hook
 *
 * @example
 * ```tsx
 * const isOnline = useOnlineStatus()
 * ```
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribeToOnlineStatus,
    getOnlineSnapshot,
    getServerOnlineSnapshot
  )
}

/**
 * 判断是否应该显示离线提示的 Hook
 *
 * 当用户离线且有离线数据时返回 true
 */
export function useShouldShowOfflineHint(): boolean {
  const { isOffline, offlineCragCount } = useOfflineMode()
  return isOffline && offlineCragCount > 0
}
