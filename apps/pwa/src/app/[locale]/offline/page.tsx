'use client'

/**
 * 离线首页
 *
 * 当用户离线时显示此页面，列出所有已下载的岩场
 * 数据来源：IndexedDB
 */

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { CloudDownload, RefreshCw, Mountain, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppTabbar } from '@/components/app-tabbar'
import { getAllOfflineCrags, OFFLINE_META_EVENT, OfflineDBBlockedError, type OfflineCragData } from '@/lib/offline-storage'
import { OfflineBrowser } from '@/components/offline-browser'
import { findPrefectureByDistrictId, isCityValid } from '@/lib/city-utils'
import type { CityConfig, PrefectureConfig } from '@/types'

export default function OfflinePage() {
  const t = useTranslations('OfflinePage')
  const tOffline = useTranslations('Offline')
  const locale = useLocale()
  const router = useRouter()
  const [offlineCrags, setOfflineCrags] = useState<OfflineCragData[]>([])
  const [cities, setCities] = useState<CityConfig[]>([])
  const [prefectures, setPrefectures] = useState<PrefectureConfig[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [storageBlocked, setStorageBlocked] = useState(false)
  const [view, setView] = useState<{ cragId?: string; routeId?: number }>({})
  const [isOnline, setIsOnline] = useState(false)

  // 加载离线数据 + 城市配置
  useEffect(() => {
    async function loadData() {
      try {
        const [crags] = await Promise.all([
          getAllOfflineCrags(),
          // 尝试获取城市数据（离线时可能失败，使用空数组 fallback）
          fetch('/api/cities')
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (data?.success) {
                setCities(data.cities)
                setPrefectures(data.prefectures)
              }
            })
            .catch(() => {}),
        ])
        setOfflineCrags(crags)
        setStorageBlocked(false)
      } catch (error) {
        setStorageBlocked(error instanceof OfflineDBBlockedError)
        console.error('Failed to load offline crags:', error)
      } finally {
        setIsLoading(false)
      }
    }
    void loadData()
    const readView = () => {
      const params = new URLSearchParams(window.location.search)
      const pathCrag = window.location.pathname.match(/\/offline\/crag\/([^/]+)/)?.[1]
      setView({ cragId: params.get('offlineCrag') ?? (pathCrag ? decodeURIComponent(pathCrag) : undefined), routeId: params.has('offlineRoute') ? Number(params.get('offlineRoute')) : undefined })
    }
    readView()
    window.addEventListener('popstate', readView)
    window.addEventListener(OFFLINE_META_EVENT, loadData)
    return () => { window.removeEventListener('popstate', readView); window.removeEventListener(OFFLINE_META_EVENT, loadData) }
  }, [])

  // 监听网络状态
  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine)
    updateOnlineStatus()

    window.addEventListener('online', updateOnlineStatus)
    window.addEventListener('offline', updateOnlineStatus)

    return () => {
      window.removeEventListener('online', updateOnlineStatus)
      window.removeEventListener('offline', updateOnlineStatus)
    }
  }, [])

  // 尝试重新连接
  const handleRetry = () => {
    if (navigator.onLine) {
      router.push(`/${locale}`)
    } else {
      // 刷新页面重新检测网络状态
      window.location.reload()
    }
  }

  // Group crags by prefecture
  const cragsByPrefecture = useMemo(() => {
    const groups: { prefecture: PrefectureConfig; crags: OfflineCragData[] }[] = []
    const ungrouped: OfflineCragData[] = []

    const prefectureMap = new Map<string, OfflineCragData[]>()

    for (const crag of offlineCrags) {
      const cityId = crag.crag.cityId
      if (cityId && isCityValid(cities, cityId)) {
        const prefecture = findPrefectureByDistrictId(prefectures, cityId)
        if (prefecture) {
          if (!prefectureMap.has(prefecture.id)) {
            prefectureMap.set(prefecture.id, [])
          }
          prefectureMap.get(prefecture.id)!.push(crag)
          continue
        }
      }
      ungrouped.push(crag)
    }

    for (const pref of prefectures) {
      const crags = prefectureMap.get(pref.id)
      if (crags && crags.length > 0) {
        groups.push({ prefecture: pref, crags })
      }
    }

    return { groups, ungrouped }
  }, [offlineCrags, cities, prefectures])

  const showPrefectureHeaders = cragsByPrefecture.groups.length >= 2

  // 跳转到在线首页
  const goHome = () => {
    router.push(`/${locale}`)
  }

  const openView = (cragId?: string, routeId?: number) => {
    setView({ cragId, routeId })
    const params = new URLSearchParams()
    if (cragId) params.set('offlineCrag', cragId)
    if (routeId !== undefined) params.set('offlineRoute', String(routeId))
    window.history.pushState(null, '', `/${locale}/offline${params.size ? `?${params}` : ''}`)
  }
  const selectedCrag = offlineCrags.find(item => item.cragId === view.cragId)
  if (selectedCrag) return <><OfflineBrowser data={selectedCrag} routeId={view.routeId} onRouteSelect={id => openView(selectedCrag.cragId, id)} onBack={() => view.routeId !== undefined ? openView(selectedCrag.cragId) : openView()} /><AppTabbar /></>

  return (
    <>
    <div
      className="flex flex-col h-dvh overflow-hidden"
      style={{
        backgroundColor: 'var(--theme-surface)',
        transition: 'var(--theme-transition)',
      }}
    >
      {/* 主内容区 — pt-12 为 layout 的 OfflineIndicator (fixed top-0) 留出空间 */}
      <main className="flex-1 overflow-y-auto px-4 pt-12 pb-6">
        {/* 标题区域 */}
        <div className="text-center mb-6">
          <div
            className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--theme-primary) 15%, var(--theme-surface))',
            }}
          >
            <CloudDownload className="w-8 h-8" style={{ color: 'var(--theme-primary)' }} />
          </div>
          <h1
            className="text-2xl font-bold mb-2"
            style={{ color: 'var(--theme-on-surface)' }}
          >
            {t('title')}
          </h1>
          <p
            className="text-sm"
            style={{ color: 'var(--theme-on-surface-variant)' }}
          >
            {t('description')}
          </p>
        </div>

        {/* 已下载岩场列表 */}
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div
              className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: 'var(--theme-primary)', borderTopColor: 'transparent' }}
            />
          </div>
        ) : storageBlocked ? (
          <p role="alert" className="p-4 text-center">{tOffline('storageBlocked')}</p>
        ) : offlineCrags.length > 0 ? (
          <div className="space-y-3">
            <h2
              className="text-sm font-semibold mb-3"
              style={{ color: 'var(--theme-on-surface-variant)' }}
            >
              {t('downloadedCrags', { count: offlineCrags.length })}
            </h2>
            {cragsByPrefecture.groups.map((group) => (
              <div key={group.prefecture.id}>
                {showPrefectureHeaders && (
                  <h2
                    className="text-sm font-medium mt-4 mb-2 px-1"
                    style={{ color: 'var(--theme-on-surface-variant)' }}
                  >
                    {group.prefecture.name}
                  </h2>
                )}
                {group.crags.map((cragData) => (
                  <CragCard key={cragData.cragId} cragData={cragData} onOpen={openView} t={t} />
                ))}
              </div>
            ))}
            {cragsByPrefecture.ungrouped.map((cragData) => (
              <CragCard key={cragData.cragId} cragData={cragData} onOpen={openView} t={t} />
            ))}
          </div>
        ) : (
          <div
            className="glass-light text-center py-8 px-4"
            style={{
              borderRadius: 'var(--theme-radius-xl)',
            }}
          >
            <CloudDownload
              className="w-12 h-12 mx-auto mb-3"
              style={{ color: 'var(--theme-on-surface-variant)', opacity: 0.5 }}
            />
            <p
              className="text-sm mb-1"
              style={{ color: 'var(--theme-on-surface-variant)' }}
            >
              {t('noDownloads')}
            </p>
            <p
              className="text-xs"
              style={{ color: 'var(--theme-on-surface-variant)', opacity: 0.7 }}
            >
              {t('downloadHint')}
            </p>
          </div>
        )}
        {/* 底部操作区 */}
        <div className="pt-4 pb-20 space-y-3">
          {isOnline && (
            <Button
              onClick={goHome}
              className="w-full h-12 font-semibold"
              style={{
                backgroundColor: 'var(--theme-primary)',
                color: 'var(--theme-on-primary)',
                borderRadius: 'var(--theme-radius-xl)',
              }}
            >
              {t('goHome')}
            </Button>
          )}
          <Button
            onClick={handleRetry}
            variant="outline"
            className="w-full h-12 font-semibold flex items-center justify-center gap-2"
            style={{
              borderColor: 'var(--theme-outline)',
              color: 'var(--theme-on-surface)',
              borderRadius: 'var(--theme-radius-xl)',
            }}
          >
            <RefreshCw className="w-4 h-4" />
            {t('retry')}
          </Button>
        </div>
      </main>
    </div>

    <AppTabbar />
    </>
  )
}

function CragCard({
  cragData,
  onOpen,
  t,
}: {
  cragData: OfflineCragData
  onOpen: (cragId: string) => void
  t: ReturnType<typeof useTranslations<'OfflinePage'>>
}) {
  return (
    <button
      onClick={() => onOpen(cragData.cragId)}
      className="glass w-full p-4 flex items-center gap-3 text-left"
      style={{
        borderRadius: 'var(--theme-radius-xl)',
      }}
    >
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--theme-primary) 15%, var(--theme-surface))',
        }}
      >
        <Mountain className="w-6 h-6" style={{ color: 'var(--theme-primary)' }} />
      </div>
      <div className="flex-1 min-w-0">
        <h3
          className="font-semibold truncate"
          style={{ color: 'var(--theme-on-surface)' }}
        >
          {cragData.crag.name}
        </h3>
        <p
          className="text-sm"
          style={{ color: 'var(--theme-on-surface-variant)' }}
        >
          {t('routeCount', { count: cragData.routes.length })}
        </p>
      </div>
      <ChevronRight
        className="w-5 h-5 flex-shrink-0"
        style={{ color: 'var(--theme-on-surface-variant)' }}
      />
    </button>
  )
}
