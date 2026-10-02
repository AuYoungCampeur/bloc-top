'use client'

/**
 * 离线下载按钮组件
 *
 * 显示状态:
 * - idle: 显示下载图标
 * - downloading: 显示环形进度条
 * - completed: 显示勾选图标
 * - failed: 显示错误图标 + 重试
 */

import { memo, useCallback, useMemo, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Download, Check, AlertCircle, Loader2, RefreshCw } from 'lucide-react'
import type { Crag, Route } from '@/types'
import type { OfflineDownloadProgress as DownloadProgress } from '@/lib/offline-download'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'

interface DownloadButtonProps {
  crag: Crag
  routes: Route[]
  isDownloaded: boolean
  progress: DownloadProgress | null
  onDownload: (crag: Crag, routes: Route[]) => Promise<void>
  onDelete?: (cragId: string) => Promise<void>
  updateInfo?: { isStale: boolean; newRouteCount: number } | null
  variant?: 'icon' | 'badge'  // icon=仅图标按钮, badge=已下载徽章
  className?: string
  style?: React.CSSProperties
}

/**
 * 环形进度条组件
 */
const CircularProgress = memo(function CircularProgress({
  progress,
  size = 24,
  strokeWidth = 2.5,
}: {
  progress: number  // 0-100
  size?: number
  strokeWidth?: number
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const offset = circumference - (progress / 100) * circumference

  return (
    <svg
      width={size}
      height={size}
      className="transform -rotate-90"
    >
      {/* 背景圆 */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="opacity-20"
      />
      {/* 进度圆 */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-300"
      />
    </svg>
  )
})

export function DownloadButton({
  crag,
  routes,
  isDownloaded,
  progress,
  onDownload,
  onDelete,
  updateInfo,
  variant = 'icon',
  className,
  style,
}: DownloadButtonProps) {
  const t = useTranslations('Offline')
  const { showToast } = useToast()

  // 用于跟踪之前的状态，避免重复显示 toast
  const prevStatusRef = useRef<string | null>(null)

  // 计算当前状态 (stale 优先级: downloading > stale > completed)
  const status = useMemo(() => {
    if (progress?.cragId === crag.id && progress.status !== 'completed') {
      return progress.status
    }
    if (isDownloaded && updateInfo?.isStale) {
      return 'stale' as const
    }
    return isDownloaded ? 'completed' : 'idle'
  }, [progress, crag.id, isDownloaded, updateInfo])

  // 计算进度百分比
  const progressPercent = useMemo(() => {
    if (progress?.cragId === crag.id && progress.totalImages > 0) {
      return Math.round((progress.downloadedImages / progress.totalImages) * 100)
    }
    return 0
  }, [progress, crag.id])

  // 监听状态变化，显示 Toast 提示
  useEffect(() => {
    // 只有当状态从 downloading 变为 completed 时才显示 toast
    if (progress?.cragId === crag.id) {
      if (prevStatusRef.current === 'downloading' && progress.status === 'completed') {
        showToast(
          `「${crag.name}」${t('downloaded')}，${progress.routeCount ?? routes.length} ${t('routesAvailable')}`,
          'success',
          4000
        )
      } else if (prevStatusRef.current === 'downloading' && progress.status === 'failed') {
        showToast(t(progress.error === 'images' ? 'imagesFailed' : progress.error === 'snapshot' ? 'snapshotFailed' : progress.error === 'quota' ? 'quotaExceeded' : progress.error === 'cancelled' ? 'cancelled' : progress.error === 'db-blocked' ? 'storageBlocked' : 'storageFailed', { count: progress.failedImages ?? 0 }), 'error', 6000)
      }
      prevStatusRef.current = progress.status
    }
  }, [progress, crag.id, crag.name, routes.length, showToast, t])

  // 处理点击
  const handleClick = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (status === 'downloading' || progress?.status === 'downloading') return

    if (status === 'completed' && onDelete) {
      // 已下载状态，长按或点击可以触发删除
      // MVP 阶段暂不实现删除确认
      return
    }

    // stale 或 idle 状态都触发下载
    if (status === 'idle' || status === 'stale' || status === 'failed') {
      try {
        await onDownload(crag, routes)
      } catch (error) {
        console.error('Download failed:', error)
      }
    }
  }, [status, onDownload, onDelete, crag, routes, progress])

  // 已下载徽章样式
  if (variant === 'badge' && isDownloaded && status !== 'downloading') {
    if (status === 'stale') {
      return (
        <div
          className={cn(
            'flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
            className
          )}
          style={{
            backgroundColor: 'var(--theme-warning)',
            color: 'white',
          }}
        >
          <RefreshCw className="w-3 h-3" />
          <span>{t('updateAvailable')}</span>
        </div>
      )
    }
    return (
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
          className
        )}
        style={{
          backgroundColor: 'var(--theme-success)',
          color: 'white',
        }}
      >
        <Check className="w-3 h-3" />
        <span>{t('downloaded')}</span>
      </div>
    )
  }

  // 图标按钮
  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'relative flex items-center justify-center w-8 h-8 rounded-full',
        'transition-all duration-200',
        'focus:outline-none focus-visible:ring-2',
        status === 'idle' && 'hover:opacity-80 active:scale-95',
        status === 'downloading' && 'cursor-wait',
        status === 'stale' && 'hover:opacity-90 active:scale-95',
        className
      )}
      style={{
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        // Use inline style for stateful backgrounds so they can't be
        // overridden by utility classes like glass-light (CSS `background`
        // shorthand beats Tailwind's `background-color`).
        ...(status === 'completed' ? { backgroundColor: 'var(--theme-success)' } : {}),
        ...(status === 'stale' ? { backgroundColor: 'var(--theme-warning)' } : {}),
        ...(status === 'failed' ? { backgroundColor: 'var(--theme-error)' } : {}),
        ...style,
      }}
      disabled={progress?.status === 'downloading'}
      aria-label={status === 'failed' ? t('retry') : undefined}
      title={
        status === 'idle' ? t('download') :
          status === 'downloading' ? `${t('downloading')} ${progressPercent}%` :
            status === 'completed' ? t('downloaded') :
              status === 'stale' ? t('updateAvailable') :
                t('failed')
      }
    >
      {status === 'idle' && (
        <Download className="w-4 h-4" style={{ color: 'var(--theme-on-surface)' }} />
      )}

      {status === 'downloading' && (
        <div className="relative flex items-center justify-center" style={{ color: 'var(--theme-on-surface)' }}>
          <CircularProgress progress={progressPercent} size={20} strokeWidth={2} />
          <span
            className="absolute font-bold"
            style={{ fontSize: '7px' }}
          >
            {progressPercent}
          </span>
        </div>
      )}

      {status === 'completed' && (
        <Check className="w-4 h-4" style={{ color: 'white' }} />
      )}

      {status === 'stale' && (
        <RefreshCw className="w-4 h-4" style={{ color: 'white' }} />
      )}

      {status === 'failed' && (
        <AlertCircle className="w-4 h-4" style={{ color: 'white' }} />
      )}
    </button>
  )
}

/**
 * 简化版下载状态指示器 (用于列表项)
 */
export function DownloadStatusIndicator({
  isDownloaded,
  isDownloading,
  className,
}: {
  isDownloaded: boolean
  isDownloading?: boolean
  className?: string
}) {
  const t = useTranslations('Offline')

  if (isDownloading) {
    return (
      <div className={cn('flex items-center gap-1 text-xs', className)}>
        <div className="w-3 h-3 animate-spin"><Loader2 className="w-full h-full" /></div>
        <span>{t('downloading')}</span>
      </div>
    )
  }

  if (isDownloaded) {
    return (
      <div
        className={cn('flex items-center gap-1 text-xs', className)}
        style={{ color: 'var(--theme-success)' }}
      >
        <Check className="w-3 h-3" />
        <span>{t('available')}</span>
      </div>
    )
  }

  return null
}
