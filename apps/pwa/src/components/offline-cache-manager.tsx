'use client'

/**
 * 离线缓存管理组件
 *
 * 在设置页面显示已下载的离线数据，支持查看和删除
 */

import { useState, useCallback, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { HardDrive, Trash2, ChevronRight, AlertCircle, Check, WifiOff } from 'lucide-react'
import { Drawer } from '@/components/ui/drawer'
import { useOfflineMode } from '@/hooks/use-offline-mode'
import { deleteCragOffline, type OfflineCragsMeta } from '@/lib/offline-storage'

interface OfflineCragInfo {
  id: string
  name: string
  routeCount: number
  downloadedAt: string
  imageCount: number
}

/**
 * 离线缓存管理区块 - 在设置页面显示
 */
export function OfflineCacheSection() {
  const t = useTranslations('OfflineCache')
  const { offlineCragsMeta, offlineCragCount, isOffline } = useOfflineMode()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // 计算总线路数
  const totalRouteCount = Object.values(offlineCragsMeta.crags).reduce(
    (sum, crag) => sum + crag.routeCount,
    0
  )

  // 如果没有离线数据，不显示此区块（除非离线状态）
  if (offlineCragCount === 0 && !isOffline) {
    return null
  }

  return (
    <>
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <HardDrive className="w-4 h-4" style={{ color: 'var(--theme-primary)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--theme-on-surface)' }}>
            {t('title')}
          </span>
        </div>

        <button
          onClick={() => setDrawerOpen(true)}
          className="w-full flex items-center gap-4 p-4 transition-all active:scale-[0.98]"
          style={{
            backgroundColor: 'var(--theme-surface)',
            borderRadius: 'var(--theme-radius-xl)',
            boxShadow: 'var(--theme-shadow-sm)',
          }}
        >
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{
              backgroundColor: offlineCragCount > 0
                ? 'color-mix(in srgb, var(--theme-success) 15%, var(--theme-surface))'
                : 'color-mix(in srgb, var(--theme-on-surface-variant) 15%, var(--theme-surface))',
            }}
          >
            {offlineCragCount > 0 ? (
              <WifiOff className="w-5 h-5" style={{ color: 'var(--theme-success)' }} />
            ) : (
              <WifiOff className="w-5 h-5" style={{ color: 'var(--theme-on-surface-variant)' }} />
            )}
          </div>
          <div className="flex-1 text-left">
            <p className="text-base font-medium" style={{ color: 'var(--theme-on-surface)' }}>
              {offlineCragCount > 0
                ? t('cragsDownloaded', { count: offlineCragCount })
                : t('noDownloads')}
            </p>
            <p className="text-xs" style={{ color: 'var(--theme-on-surface-variant)' }}>
              {offlineCragCount > 0
                ? t('routesAvailable', { count: totalRouteCount })
                : t('downloadHint')}
            </p>
          </div>
          <ChevronRight className="w-5 h-5" style={{ color: 'var(--theme-on-surface-variant)' }} />
        </button>
      </div>

      {/* 缓存管理抽屉 */}
      <OfflineCacheDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        offlineCragsMeta={offlineCragsMeta}
      />
    </>
  )
}

/**
 * 离线缓存管理抽屉
 */
interface OfflineCacheDrawerProps {
  isOpen: boolean
  onClose: () => void
  offlineCragsMeta: OfflineCragsMeta
}

function OfflineCacheDrawer({ isOpen, onClose, offlineCragsMeta }: OfflineCacheDrawerProps) {
  const t = useTranslations('OfflineCache')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deletedId, setDeletedId] = useState<string | null>(null)
  const [localCrags, setLocalCrags] = useState<OfflineCragInfo[]>([])

  // 将 meta 转换为数组并排序
  useEffect(() => {
    const crags = Object.entries(offlineCragsMeta.crags).map(([id, info]) => ({
      id,
      name: info.cragName,
      routeCount: info.routeCount,
      downloadedAt: info.downloadedAt,
      imageCount: info.imageCount,
    }))
    // 按下载时间倒序
    crags.sort((a, b) => new Date(b.downloadedAt).getTime() - new Date(a.downloadedAt).getTime())
    setLocalCrags(crags)
  }, [offlineCragsMeta])

  // 删除单个岩场
  const handleDelete = useCallback(async (cragId: string, cragName: string) => {
    if (deletingId) return

    // 确认删除
    if (!window.confirm(t('confirmDelete', { name: cragName }))) {
      return
    }

    setDeletingId(cragId)
    try {
      await deleteCragOffline(cragId)
      setDeletedId(cragId)
      // 从本地列表移除
      setLocalCrags((prev) => prev.filter((c) => c.id !== cragId))
      setTimeout(() => setDeletedId(null), 1500)
    } catch (error) {
      window.alert(t('deleteFailed'))
      console.error('Failed to delete offline crag:', error)
    } finally {
      setDeletingId(null)
    }
  }, [deletingId, t])

  // 格式化日期
  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString)
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return dateString
    }
  }

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      height="three-quarter"
      showHandle
      title={t('manageTitle')}
      showCloseButton
    >
      <div className="px-4 pb-6">
        {localCrags.length === 0 ? (
          /* 空状态 */
          <div className="flex flex-col items-center justify-center py-12">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--theme-on-surface-variant) 10%, var(--theme-surface))',
              }}
            >
              <HardDrive className="w-8 h-8" style={{ color: 'var(--theme-on-surface-variant)' }} />
            </div>
            <p
              className="text-base font-medium mb-2"
              style={{ color: 'var(--theme-on-surface)' }}
            >
              {t('emptyTitle')}
            </p>
            <p
              className="text-sm text-center max-w-xs"
              style={{ color: 'var(--theme-on-surface-variant)' }}
            >
              {t('emptyDescription')}
            </p>
          </div>
        ) : (
          /* 已下载列表 */
          <div className="space-y-3">
            {localCrags.map((crag) => (
              <div
                key={crag.id}
                className="flex items-center gap-3 p-3 transition-all"
                style={{
                  backgroundColor: 'var(--theme-surface-variant)',
                  borderRadius: 'var(--theme-radius-lg)',
                  opacity: deletedId === crag.id ? 0.5 : 1,
                }}
              >
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-medium truncate"
                    style={{ color: 'var(--theme-on-surface)' }}
                  >
                    {crag.name}
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: 'var(--theme-on-surface-variant)' }}
                  >
                    {t('cragInfo', {
                      routes: crag.routeCount,
                      images: crag.imageCount,
                    })}
                    {' · '}
                    {formatDate(crag.downloadedAt)}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(crag.id, crag.name)}
                  disabled={deletingId === crag.id || deletedId === crag.id}
                  className="p-2 rounded-full transition-all active:scale-95 disabled:opacity-50"
                  style={{
                    backgroundColor: deletedId === crag.id
                      ? 'color-mix(in srgb, var(--theme-success) 15%, transparent)'
                      : 'color-mix(in srgb, var(--theme-error) 15%, transparent)',
                  }}
                  aria-label={t('delete')}
                >
                  {deletedId === crag.id ? (
                    <Check className="w-4 h-4" style={{ color: 'var(--theme-success)' }} />
                  ) : deletingId === crag.id ? (
                    <div
                      className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
                      style={{ color: 'var(--theme-error)' }}
                    />
                  ) : (
                    <Trash2 className="w-4 h-4" style={{ color: 'var(--theme-error)' }} />
                  )}
                </button>
              </div>
            ))}

            {/* 提示信息 */}
            <div
              className="flex items-start gap-2 p-3 mt-4"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--theme-warning) 10%, var(--theme-surface))',
                borderRadius: 'var(--theme-radius-lg)',
              }}
            >
              <AlertCircle
                className="w-4 h-4 flex-shrink-0 mt-0.5"
                style={{ color: 'var(--theme-warning)' }}
              />
              <p className="text-xs" style={{ color: 'var(--theme-on-surface-variant)' }}>
                {t('deleteHint')}
              </p>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  )
}
