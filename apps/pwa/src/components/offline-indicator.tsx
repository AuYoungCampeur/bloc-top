'use client'

/**
 * 离线状态指示器
 *
 * 增强版功能:
 * 1. 显示当前离线状态
 * 2. 显示已下载的岩场数量
 * 3. 点击可展开查看已下载岩场列表
 * 4. 支持点击岩场跳转到离线详情页
 */

import { useState, useMemo, useSyncExternalStore } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { WifiOff, ChevronDown, ChevronUp, ChevronRight, Mountain } from 'lucide-react'
import { useOfflineDownloadContextSafe } from '@/components/offline-download-provider'

// 网络状态订阅
function subscribe(callback: () => void) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

function getSnapshot() {
  return !navigator.onLine
}

function getServerSnapshot() {
  return false
}

export default function OfflineIndicator() {
  const t = useTranslations('OfflineIndicator')
  const locale = useLocale()
  const isOffline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const [isExpanded, setIsExpanded] = useState(false)

  // 获取离线下载 Context (可能为 null)
  const offlineDownload = useOfflineDownloadContextSafe()

  // 已下载岩场数量
  const offlineCragCount = useMemo(() => {
    return offlineDownload?.offlineCrags.length ?? 0
  }, [offlineDownload?.offlineCrags])

  // 不是离线模式且没有已下载岩场，不显示
  if (!isOffline) return null

  return (
    <div
      className="fixed top-0 left-0 right-0 desktop-center-full z-50 animate-fade-in-up"
      style={{
        background: 'color-mix(in srgb, var(--theme-warning) 85%, transparent)',
        WebkitBackdropFilter: 'blur(var(--glass-blur-sm))',
        backdropFilter: 'blur(var(--glass-blur-sm))',
        color: 'white',
        transition: 'var(--theme-transition)',
      }}
    >
      {/* 主横幅 */}
      <button
        type="button"
        onClick={() => offlineCragCount > 0 && setIsExpanded(!isExpanded)}
        className="w-full px-4 py-2 flex items-center justify-center gap-2"
        disabled={offlineCragCount === 0}
      >
        <WifiOff className="w-4 h-4" />
        <span className="text-sm font-medium">{t('message')}</span>

        {/* 显示可用岩场数量 */}
        {offlineCragCount > 0 && (
          <>
            <span className="text-sm opacity-80">·</span>
            <span className="text-sm opacity-80">
              {t('cragsAvailable', { count: offlineCragCount })}
            </span>
            {isExpanded ? (
              <ChevronUp className="w-4 h-4 ml-1" />
            ) : (
              <ChevronDown className="w-4 h-4 ml-1" />
            )}
          </>
        )}
      </button>

      {/* 展开的岩场列表 */}
      {isExpanded && offlineCragCount > 0 && offlineDownload && (
        <div
          className="px-4 pb-3 border-t border-white/20"
          style={{ maxHeight: '250px', overflowY: 'auto' }}
        >
          <p className="text-xs opacity-70 mt-2 mb-2">{t('tapToView')}</p>
          <div className="space-y-2">
            {offlineDownload.offlineCrags.map((crag) => (
              // Native document navigation lets SW serve the offline shell without an RSC request.
              <a
                key={crag.cragId}
                href={`/${locale}/offline?offlineCrag=${encodeURIComponent(crag.cragId)}`}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-white/20 hover:bg-white/30 transition-colors text-left"
              >
                <Mountain className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1 truncate">{crag.cragName}</span>
                <span className="text-xs opacity-70">{crag.routeCount} {t('routes')}</span>
                <ChevronRight className="w-4 h-4 flex-shrink-0 opacity-70" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
