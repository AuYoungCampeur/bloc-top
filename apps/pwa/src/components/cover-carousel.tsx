'use client'

import { useRef, useState, useEffect, memo } from 'react'
import Image from 'next/image'

// ==================== 类型 ====================

interface CoverCarouselProps {
  /** 图片 URL 数组 */
  images: string[]
  /** 图片 alt 文本前缀 (会自动追加索引) */
  alt: string
  /** 容器高度 Tailwind class (默认 "h-48") */
  height?: string
  /** 图片加载失败回调 */
  onError?: () => void
  /** 是否跳过 Next.js 图片优化 (离线场景) */
  unoptimized?: boolean
}

// ==================== 组件 ====================

/**
 * 封面图轮播组件
 *
 * 使用 CSS scroll-snap 实现原生滑动体验，带底部圆点指示器。
 * 单张图片时不显示指示器和滚动容器。
 *
 * 提取自 crag-detail-client.tsx 和 offline/crag/[id]/page.tsx 的重复逻辑。
 */
export const CoverCarousel = memo(function CoverCarousel({
  images,
  alt,
  height = 'h-48',
  onError,
  unoptimized,
}: CoverCarouselProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [currentIndex, setCurrentIndex] = useState(0)

  // 监听滚动位置更新当前索引
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const scrollLeft = container.scrollLeft
      const itemWidth = container.offsetWidth
      const newIndex = Math.round(scrollLeft / itemWidth)
      setCurrentIndex(newIndex)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <div
      ref={scrollContainerRef}
      className={`relative ${height} overflow-x-auto scrollbar-hide`}
      style={{
        scrollSnapType: 'x mandatory',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <div className="flex h-full">
        {images.map((src, idx) => (
          <div
            key={src}
            className={`w-full flex-shrink-0 ${height} relative`}
            style={{ scrollSnapAlign: 'start' }}
          >
            <Image
              src={src}
              alt={`${alt} ${idx + 1}`}
              fill
              priority={idx === 0}
              sizes="100vw"
              className="object-cover"
              draggable={false}
              onError={onError}
              unoptimized={unoptimized}
            />
          </div>
        ))}
      </div>

      {/* 底部圆点指示器 (仅多图时显示) */}
      {images.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
          {images.map((_, idx) => (
            <div
              key={idx}
              className={`w-2 h-2 rounded-full transition-colors ${
                idx === currentIndex ? 'bg-white' : 'bg-white/50'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
})
