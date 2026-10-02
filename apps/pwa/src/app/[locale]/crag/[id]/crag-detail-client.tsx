'use client'

import { useRef, useState, useEffect, useMemo } from 'react'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import Image from 'next/image'
import { FileText, Car, ChevronLeft, Heart, Mountain } from 'lucide-react'
import { CoverCarousel } from '@/components/cover-carousel'
import { Button } from '@/components/ui/button'
import { Drawer } from '@/components/ui/drawer'
import { getCragCoverImages } from '@/lib/crag-cover-images'
import { useOnlineCragContent } from '@/hooks/use-online-crag-content'
import { computeGradeRange, formatGradeRange } from '@/lib/grade-utils'
import AMapContainer from '@/components/amap-container'
import { WeatherCard } from '@/components/weather-card'
import { InfoCard } from '@/components/info-card'
import type { Crag, Route } from '@/types'

/** 默认坐标 fallback: 罗源县中心 (WGS-84) */
const DEFAULT_COORDINATES = { lng: 119.544922, lat: 26.492767 }

interface CragDetailClientProps {
  crag: Crag
  routes: Route[]
}

export default function CragDetailClient({ crag: initialCrag, routes: initialRoutes }: CragDetailClientProps) {
  const seed = useMemo(() => ({ crag: initialCrag, routes: initialRoutes }), [initialCrag, initialRoutes])
  const { crag, routes } = useOnlineCragContent(initialCrag.id, seed) ?? seed
  const t = useTranslations('CragDetail')
  const router = useRouter()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const heroRef = useRef<HTMLDivElement>(null)
  const [imageVisible, setImageVisible] = useState(true)
  const [isCreditsOpen, setIsCreditsOpen] = useState(false)
  const [failedCovers, setFailedCovers] = useState<string | null>(null)

  const images = getCragCoverImages(crag)
  const coversKey = images.join('\n')
  const coverError = failedCovers === coversKey

  // 监听 Hero 图片可见性（Mobile only）
  useEffect(() => {
    if (!isMobile) return
    const hero = heroRef.current
    if (!hero) return

    const observer = new IntersectionObserver(
      ([entry]) => setImageVisible(entry.isIntersecting),
      { threshold: 0 }
    )
    observer.observe(hero)
    return () => observer.disconnect()
  }, [isMobile])

  // 计算难度范围
  const gradeRange = useMemo(() => {
    const range = computeGradeRange(routes.map((r) => r.grade))
    return formatGradeRange(range) ?? '暂无'
  }, [routes])

  return (
    <div
      className="flex flex-col h-dvh overflow-hidden"
      style={{
        backgroundColor: 'var(--theme-surface)',
        transition: 'var(--theme-transition)',
      }}
    >
      {/* Hero 图片区域 */}
      <div ref={heroRef} className="relative flex-shrink-0">
        {/* 返回按钮（图片上方） */}
        <button
          onClick={() => router.back()}
          className="absolute top-12 left-4 z-10 w-10 h-10 rounded-full bg-black/50 backdrop-blur flex items-center justify-center"
        >
          <ChevronLeft className="w-6 h-6 text-white" />
        </button>

        {coverError ? (
          /* Fallback: 封面图加载失败时的占位 */
          <div
            className="relative h-48 flex items-center justify-center"
            style={{ backgroundColor: 'var(--theme-surface-variant)' }}
          >
            <Mountain className="w-12 h-12 opacity-20" style={{ color: 'var(--theme-on-surface-variant)' }} />
          </div>
        ) : isMobile ? (
          /* Mobile: 单张图片，无轮播 */
          <div className="relative h-48">
            <Image
              key={images[0]}
              src={images[0]}
              alt={crag.name}
              fill
              priority
              sizes="100vw"
              className="object-cover"
              draggable={false}
              onError={() => setFailedCovers(coversKey)}
            />
          </div>
        ) : (
          /* Desktop: 轮播组件 */
          <CoverCarousel
            images={images}
            alt={crag.name}
            onError={() => setFailedCovers(coversKey)}
          />
        )}
      </div>

      {/* 内容滚动区域 */}
      <main className="flex-1 overflow-y-auto px-4 pb-24">
        {/* 标题区域 */}
        <div className="py-4">
          <div className="flex flex-col mb-2">
            <div className="flex items-center gap-2">
              <h1
                className="text-3xl font-bold tracking-wide leading-tight"
                style={{ color: 'var(--theme-on-surface)' }}
              >
                {crag.name}
              </h1>
              {crag.credits && crag.credits.length > 0 && (
                <button
                  onClick={() => setIsCreditsOpen(true)}
                  className="w-8 h-8 flex items-center justify-center flex-shrink-0 transition-all active:scale-90"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--theme-primary) 12%, transparent)',
                    borderRadius: 'var(--theme-radius-full)',
                  }}
                  aria-label={t('credits')}
                >
                  <Heart className="w-4 h-4" style={{ color: 'var(--theme-primary)' }} />
                </button>
              )}
            </div>
            <div
              className="w-10 h-0.5 mt-1"
              style={{ background: 'linear-gradient(to right, var(--theme-primary), transparent)' }}
            />
          </div>

          {/* 徽章组 */}
          <div className="flex flex-wrap gap-1 mt-2">
            <span
              className="inline-flex items-center px-2.5 py-1 text-xs font-medium"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--theme-primary) 15%, var(--theme-surface))',
                color: 'var(--theme-primary)',
                borderRadius: 'var(--theme-radius-full)',
              }}
            >
              {routes.length} 条线路
            </span>
            <span
              className="inline-flex items-center px-2.5 py-1 text-xs font-medium"
              style={{
                backgroundColor: 'var(--theme-surface-variant)',
                color: 'var(--theme-on-surface-variant)',
                borderRadius: 'var(--theme-radius-full)',
              }}
            >
              {gradeRange}
            </span>
          </div>
        </div>

        {/* 天气卡片 */}
        <WeatherCard
          coordinates={crag.coordinates || DEFAULT_COORDINATES}
          delay={0}
        />

        {/* 前往方式卡片（含地图） */}
        <div
          className="glass p-3 mb-2 animate-fade-in-up"
          style={{
            borderRadius: 'var(--theme-radius-xl)',
            animationDelay: '25ms',
            transition: 'var(--theme-transition)',
          }}
        >
          {/* 标题行：Car 图标 + "前往方式" */}
          <div className="flex items-center mb-2">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center mr-2 flex-shrink-0"
              style={{ backgroundColor: 'var(--theme-surface-variant)' }}
            >
              <Car className="w-5 h-5" style={{ color: 'var(--theme-on-surface-variant)' }} />
            </div>
            <span className="text-base font-semibold" style={{ color: 'var(--theme-on-surface)' }}>
              前往方式
            </span>
          </div>

          {/* 前往方式文字描述 */}
          {crag.approach && (
            <p
              className="text-sm leading-relaxed mb-3"
              style={{ color: 'var(--theme-on-surface-variant)' }}
            >
              {crag.approach}
            </p>
          )}

          {/* 地图组件 */}
          <AMapContainer
            center={crag.coordinates || DEFAULT_COORDINATES}
            name={crag.name}
            zoom={15}
            height="180px"
            approachPaths={crag.approachPaths}
          />

          {/* 导航提示 */}
          <p
            className="text-xs mt-2 text-center"
            style={{ color: 'var(--theme-on-surface-variant)' }}
          >
            点击导航按钮可跳转高德地图
          </p>
        </div>

        {/* 岩场介绍卡片 */}
        <InfoCard
          icon={<FileText className="w-5 h-5" style={{ color: 'var(--theme-on-surface-variant)' }} />}
          iconBg="var(--theme-surface-variant)"
          title="岩场介绍"
          content={crag.description}
          delay={50}
        />
      </main>

      {/* 迷你导航栏 — Mobile only, 图片滚出后滑入 */}
      {isMobile && (
        <div
          className={`fixed top-0 inset-x-0 z-30 transition-transform duration-300 ${
            imageVisible ? '-translate-y-full' : 'translate-y-0'
          }`}
        >
          <div
            className="h-14 flex items-center gap-3 glass-heavy"
            style={{
              paddingTop: 'env(safe-area-inset-top)',
              paddingLeft: '1rem',
              paddingRight: '1rem',
            }}
          >
            <button
              onClick={() => router.back()}
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ backgroundColor: 'var(--theme-surface-variant)' }}
            >
              <ChevronLeft className="w-5 h-5" style={{ color: 'var(--theme-on-surface)' }} />
            </button>
            <span
              className="truncate font-semibold text-base"
              style={{ color: 'var(--theme-on-surface)' }}
            >
              {crag.name}
            </span>
          </div>
        </div>
      )}

      {/* 致谢抽屉 */}
      {crag.credits && crag.credits.length > 0 && (
        <Drawer
          isOpen={isCreditsOpen}
          onClose={() => setIsCreditsOpen(false)}
          height="half"
          showHandle
          title={t('credits')}
        >
          <div className="px-4 pb-6">
            <div className="space-y-4">
              {crag.credits.map((credit, index) => (
                <div key={index} className="animate-fade-in-up" style={{ animationDelay: `${index * 50}ms` }}>
                  <p
                    className="text-sm font-semibold"
                    style={{ color: 'var(--theme-on-surface)' }}
                  >
                    {credit.name}
                  </p>
                  <p
                    className="text-xs mt-0.5"
                    style={{ color: 'var(--theme-on-surface-variant)' }}
                  >
                    {credit.contribution}
                  </p>
                </div>
              ))}
            </div>

            {/* 底部感谢语 */}
            <div className="mt-6 pt-4" style={{ borderTop: '1px solid var(--theme-outline-variant)' }}>
              <p
                className="text-xs text-center"
                style={{ color: 'var(--theme-on-surface-variant)' }}
              >
                {t('creditsFooter')}
              </p>
            </div>
          </div>
        </Drawer>
      )}

      {/* 底部操作按钮 */}
      <div
        className="fixed bottom-0 left-0 right-0 desktop-center-padded p-4"
        style={{ background: `linear-gradient(to top, var(--theme-surface), transparent)` }}
      >
        <Button
          onClick={() => router.push(`/route?crag=${crag.id}`)}
          className="w-full h-12 font-semibold"
          style={{
            backgroundColor: 'var(--theme-primary)',
            color: 'var(--theme-on-primary)',
            borderRadius: 'var(--theme-radius-xl)',
            boxShadow: 'var(--theme-shadow-lg)',
          }}
        >
          {t('exploreRoutes')}
        </Button>
      </div>
    </div>
  )
}
