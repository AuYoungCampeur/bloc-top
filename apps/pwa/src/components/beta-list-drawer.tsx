'use client'

import { useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { ExternalLink, Play, Ruler, MoveHorizontal, Plus, Copy, Check, RefreshCw } from 'lucide-react'
import { Drawer } from '@/components/ui/drawer'
import type { BetaLink } from '@/types'

interface BetaListDrawerProps {
  isOpen: boolean
  onClose: () => void
  betaLinks: BetaLink[]  // 来自 props 的数据（可能是 ISR 缓存）
  routeName: string
  routeId: number
  onAddBeta?: () => void
  onRefresh: () => Promise<boolean>
}

// Beta 视频图标（不强调具体平台）
const BetaIcon = Play

export function BetaListDrawer({
  isOpen,
  onClose,
  betaLinks: propsBetaLinks,
  routeName,
  routeId,
  onAddBeta,
  onRefresh,
}: BetaListDrawerProps) {
  const t = useTranslations('Beta')
  const tCommon = useTranslations('Common')
  const [refreshing, setRefreshing] = useState(false)
  const [failedRouteId, setFailedRouteId] = useState<number | null>(null)
  const refreshFailed = failedRouteId === routeId
  const betaLinks = propsBetaLinks

  /**
   * 手动刷新 Beta 列表
   * 只在用户主动点击刷新按钮时调用 API
   */
  const handleRefresh = useCallback(async () => {
    if (refreshing || !routeId) return

    setRefreshing(true)
    try {
      const success = await onRefresh()
      setFailedRouteId(success ? null : routeId)
    } catch {
      setFailedRouteId(routeId)
    } finally {
      setRefreshing(false)
    }
  }, [refreshing, routeId, onRefresh])

  // 复制成功状态（记录哪个链接被复制）
  const [copiedId, setCopiedId] = useState<string | null>(null)

  /**
   * 复制链接到剪贴板
   */
  const handleCopyLink = useCallback(async (url: string, betaId: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(betaId)

      // 2秒后重置复制状态
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      // 降级方案：使用传统的复制方法
      const textArea = document.createElement('textarea')
      textArea.value = url
      textArea.style.position = 'fixed'
      textArea.style.opacity = '0'
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopiedId(betaId)
      setTimeout(() => setCopiedId(null), 2000)
    }
  }, [])

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      height="half"
      title={t('drawerTitle', { name: routeName })}
      showCloseButton
    >
      <div className="px-4 pb-4">
        {/* 分享 Beta 按钮 */}
        {onAddBeta && (
          <button
            onClick={onAddBeta}
            className="w-full flex items-center justify-center gap-2 p-3 mb-4 transition-all active:scale-[0.98]"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--theme-primary) 10%, var(--theme-surface))',
              borderRadius: 'var(--theme-radius-xl)',
              border: '1px dashed var(--theme-primary)',
              color: 'var(--theme-primary)',
            }}
          >
            <Plus className="w-5 h-5" />
            <span className="text-sm font-medium">{t('shareButton')}</span>
          </button>
        )}

        {/* 空列表也允许主动刷新，避免旧页面数据使新增 Beta 长时间不可见。 */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs" style={{ color: 'var(--theme-on-surface-variant)' }}>
            {t('videoCount', { count: betaLinks.length })}
          </span>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-all active:scale-95 disabled:opacity-50 glass-light"
            style={{ color: 'var(--theme-on-surface-variant)', borderRadius: 'var(--theme-radius-lg)' }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? tCommon('refreshing') : refreshFailed ? tCommon('retry') : tCommon('refresh')}
          </button>
        </div>

        {refreshFailed && (
          <p role="alert" className="text-sm mb-3" style={{ color: 'var(--theme-error)' }}>
            {t('refreshFailed')}
          </p>
        )}

        {betaLinks.length === 0 ? (
          <div className="text-center py-8">
            <div
              className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center glass-light"
            >
              <ExternalLink
                className="w-8 h-8"
                style={{ color: 'var(--theme-on-surface-variant)' }}
              />
            </div>
            <p
              className="text-base font-medium mb-1"
              style={{ color: 'var(--theme-on-surface)' }}
            >
              {t('noBeta')}
            </p>
            <p
              className="text-sm"
              style={{ color: 'var(--theme-on-surface-variant)' }}
            >
              {t('beFirst')}
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {betaLinks.map((beta, index) => {
              return (
                <div
                  key={beta.id}
                  className="w-full flex items-center gap-3 p-3 animate-fade-in-up glass"
                  style={{
                    borderRadius: 'var(--theme-radius-xl)',
                    animationDelay: `${index * 50}ms`,
                  }}
                >
                  <a
                    href={beta.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-1 min-w-0 items-center gap-3 transition-transform active:scale-[0.98]"
                  >
                    {/* Beta 视频图标 */}
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: 'color-mix(in srgb, var(--theme-primary) 15%, var(--theme-surface))' }}
                    >
                      <BetaIcon className="w-5 h-5" style={{ color: 'var(--theme-primary)' }} />
                    </div>

                    {/* 链接信息 */}
                    <div className="flex-1 min-w-0 text-left">
                      <span
                        className="text-sm font-medium block truncate"
                        style={{ color: 'var(--theme-on-surface)' }}
                      >
                        {beta.title || (beta.author ? `@${beta.author}` : `Beta #${index + 1}`)}
                      </span>
                      <div className="flex items-center gap-2 flex-wrap">
                        {beta.author && beta.title && (
                          <span
                            className="text-xs"
                            style={{ color: 'var(--theme-on-surface-variant)' }}
                          >
                            @{beta.author}
                          </span>
                        )}
                        {/* 身高臂长标签 */}
                        {(beta.climberHeight || beta.climberReach) && (
                          <span className="flex items-center gap-1.5">
                            {beta.climberHeight && (
                              <span
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] font-medium"
                                style={{
                                  backgroundColor: 'color-mix(in srgb, var(--theme-primary) 12%, transparent)',
                                  color: 'var(--theme-primary)',
                                  borderRadius: 'var(--theme-radius-sm)',
                                }}
                              >
                                <Ruler className="w-3 h-3" />
                                {t('height')} {beta.climberHeight}cm
                              </span>
                            )}
                            {beta.climberReach && (
                              <span
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] font-medium"
                                style={{
                                  backgroundColor: 'color-mix(in srgb, var(--theme-success) 12%, transparent)',
                                  color: 'var(--theme-success)',
                                  borderRadius: 'var(--theme-radius-sm)',
                                }}
                              >
                                <MoveHorizontal className="w-3 h-3" />
                                {t('reach')} {beta.climberReach}cm
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </a>

                  {/* 复制链接按钮 */}
                  <button
                    onClick={() => handleCopyLink(beta.url, beta.id)}
                    className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all active:scale-95 ${copiedId !== beta.id ? 'glass-light' : ''}`}
                    style={{
                      ...(copiedId === beta.id ? { backgroundColor: 'var(--theme-success, #22c55e)' } : {}),
                    }}
                    title={tCommon('copyLink')}
                    aria-label={tCommon('copyLink')}
                  >
                    {copiedId === beta.id ? (
                      <Check className="w-5 h-5 text-white" />
                    ) : (
                      <Copy
                        className="w-5 h-5"
                        style={{ color: 'var(--theme-on-surface-variant)' }}
                      />
                    )}
                  </button>
                </div>
              )
            })}
            </div>
          </>
        )}
      </div>
    </Drawer>
  )
}
