'use client'

import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Search, X, ArrowRight, SlidersHorizontal } from 'lucide-react'
import { Drawer } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { ContextualHint } from '@/components/contextual-hint'
import { RouteDetailDrawer } from '@/components/route-detail-drawer'
import { RouteListItem } from '@/components/route-list-item'
import { getSiblingRoutes } from '@/lib/route-utils'
import type { Route, Crag } from '@/types'

interface SearchDrawerProps {
  isOpen: boolean
  onClose: () => void
  searchQuery: string
  onSearchChange: (value: string) => void
  results: Route[]
  crags: Crag[]
  allRoutes: Route[]
  cityId?: string
}

const MAX_DISPLAY_RESULTS = 8

export function SearchDrawer({
  isOpen,
  onClose,
  searchQuery,
  onSearchChange,
  results,
  crags,
  allRoutes,
  cityId,
}: SearchDrawerProps) {
  const t = useTranslations('Search')
  const tIntro = useTranslations('Intro')
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  // 线路详情抽屉状态
  const [routeSelection, setRouteSelection] = useState<Route | null>(null)
  const selectedRoute = routeSelection
    ? allRoutes.find(route => route.id === routeSelection.id && route.cragId === routeSelection.cragId) ?? null
    : null
  const [isDetailOpen, setIsDetailOpen] = useState(false)

  // 打开时聚焦输入框
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300)
    }
  }, [isOpen])

  // 限制显示数量
  const displayResults = results.slice(0, MAX_DISPLAY_RESULTS)
  const hasMoreResults = results.length > MAX_DISPLAY_RESULTS

  // 处理线路点击 - 打开详情抽屉
  const handleRouteClick = (route: Route) => {
    setRouteSelection(route)
    setIsDetailOpen(true)
  }

  // 获取选中线路对应的岩场
  const selectedCrag = selectedRoute
    ? crags.find((c) => c.id === selectedRoute.cragId) || null
    : null

  const siblingRoutes = useMemo(
    () => getSiblingRoutes(selectedRoute, allRoutes),
    [allRoutes, selectedRoute]
  )

  // 处理线路切换（Topo 叠加层点击其他线路起点）
  const handleRouteChange = useCallback((route: Route) => {
    setRouteSelection(route)
  }, [])

  // 跳转到线路页面并带上搜索词（携带城市参数）
  const handleViewAll = () => {
    onClose()
    const cityParam = cityId ? `city=${cityId}&` : ''
    router.push(`/route?${cityParam}q=${encodeURIComponent(searchQuery)}`)
  }

  // 跳转到线路筛选页面（携带城市参数）
  const handleGoToRoutes = () => {
    onClose()
    router.push(cityId ? `/route?city=${cityId}` : '/route')
  }

  return (
    <>
      <Drawer isOpen={isOpen} onClose={onClose} height="three-quarter">
        <div className="px-4 pb-4">
          {/* 搜索提示 */}
          <div className="mb-3">
            <ContextualHint
              hintKey="search-hint"
              message={tIntro('hintSearch')}
              icon={<SlidersHorizontal className="w-3.5 h-3.5" />}
            />
          </div>

          {/* 搜索输入框 */}
          <div className="relative mb-4">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
              style={{ color: 'var(--theme-on-surface-variant)' }}
            />
            <Input
              ref={inputRef}
              variant="search"
              placeholder={t('placeholder')}
              value={searchQuery}
              onChange={(value) => onSearchChange(value)}
              className="h-11 glass-light"
              style={{
                borderRadius: 'var(--theme-radius-full)',
              }}
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center"
                style={{ backgroundColor: 'var(--theme-on-surface-variant)' }}
              >
                <X className="w-3 h-3" style={{ color: 'var(--theme-surface)' }} />
              </button>
            )}
          </div>

          {/* 搜索结果 */}
          {searchQuery.trim() ? (
            <>
              <p
                className="text-xs mb-3"
                style={{ color: 'var(--theme-on-surface-variant)' }}
              >
                {t('foundRoutes', { count: results.length })}
              </p>

              {displayResults.length > 0 ? (
                <div className="space-y-2">
                  {displayResults.map((route, index) => (
                    <RouteListItem
                      key={route.id}
                      route={route}
                      onClick={handleRouteClick}
                      compact
                      className="animate-fade-in-up glass"
                      style={{ animationDelay: `${index * 30}ms` }}
                    />
                  ))}

                  {/* 查看更多按钮 */}
                  {hasMoreResults && (
                    <button
                      onClick={handleViewAll}
                      className="w-full py-3 flex items-center justify-center gap-2 transition-colors"
                      style={{
                        color: 'var(--theme-primary)',
                        borderRadius: 'var(--theme-radius-xl)',
                      }}
                    >
                      <span className="text-sm font-medium">
                        {t('viewAll', { count: results.length })}
                      </span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <p style={{ color: 'var(--theme-on-surface-variant)' }}>
                    {t('noResults')}
                  </p>
                </div>
              )}
            </>
          ) : (
            /* 无搜索词时的引导 */
            <div className="text-center py-6">
              <p
                className="text-sm mb-4"
                style={{ color: 'var(--theme-on-surface-variant)' }}
              >
                {t('inputHint')}
              </p>
              <button
                onClick={handleGoToRoutes}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium transition-all active:scale-95"
                style={{
                  backgroundColor: 'var(--theme-primary)',
                  color: 'var(--theme-on-primary)',
                  borderRadius: 'var(--theme-radius-full)',
                  boxShadow: 'var(--theme-shadow-sm)',
                }}
              >
                {t('browseAll')}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </Drawer>

      {/* 线路详情抽屉 */}
      <RouteDetailDrawer
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        route={selectedRoute}
        siblingRoutes={siblingRoutes}
        crag={selectedCrag}
        onRouteChange={handleRouteChange}
      />
    </>
  )
}
