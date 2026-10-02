'use client'

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Image as ImageIcon } from 'lucide-react'
import { FilterChip, FilterChipGroup } from '../components/filter-chip'
import { useFaceImageCache } from './use-face-image'
import { getFaceIdentityKey } from '@bloctop/shared/face-references'

interface FaceGroup {
  key: string
  label: string
  area: string
  image: string
}

interface FaceThumbnailStripProps {
  faces: { faceId: string; area: string }[]
  selectedCrag: string
  selectedFace: string | null
  onFaceSelect: (faceId: string | null) => void
  selectedArea?: string | null
  onAreaChange?: (area: string | null) => void
}

/**
 * 岩面缩略图 - 独立管理加载/错误状态
 *
 * 设计决策: src 变化时不重置 status。
 * 浏览器原生 <img> 在 src 变化时保持显示旧图直到新图加载完成,
 * 对缩略图来说这是更好的 UX (避免多个缩略图同时闪烁 skeleton)。
 * 新图加载成功 → onLoad → 'loaded'; 失败 → onError → 'error'。
 */
const FaceThumbnail = memo(function FaceThumbnail({ src, alt }: { src: string; alt: string }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')

  return (
    <>
      {status === 'loading' && (
        <div className="w-full h-full skeleton-shimmer" />
      )}
      {status === 'error' && (
        <div
          className="w-full h-full flex items-center justify-center"
          style={{ color: 'var(--theme-on-surface-variant)' }}
        >
          <ImageIcon className="w-4 h-4 opacity-40" />
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className={`w-full h-full object-cover ${status === 'loaded' ? '' : 'hidden'}`}
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('error')}
      />
    </>
  )
})

/**
 * 岩面缩略图横向滑动组件
 * 选中岩场后展示公开线路引用中的岩面；不读取管理专用 R2 API。
 */
export const FaceThumbnailStrip = memo(function FaceThumbnailStrip({
  faces,
  selectedCrag,
  selectedFace,
  onFaceSelect,
  selectedArea: controlledArea,
  onAreaChange,
}: FaceThumbnailStripProps) {
  const tCommon = useTranslations('Common')
  const cache = useFaceImageCache()
  // 递增值用于强制 useMemo 重算 (缓存失效时触发)
  const [cacheVersion, setCacheVersion] = useState(0)

  // Optimistic: 点击后立即显示选中边框，不等 URL transition 完成
  const [optimisticFace, setOptimisticFace] = useState<string | null>(null)
  // URL 状态追上后清除 optimistic 状态
  useEffect(() => {
    setOptimisticFace(null)
  }, [selectedFace, selectedCrag, controlledArea])
  const displayFace = optimisticFace !== null ? optimisticFace : selectedFace

  // 订阅当前岩场下所有岩面的缓存失效事件
  useEffect(() => {
    if (!selectedCrag) return
    return cache.subscribeByPrefix(`${selectedCrag}/`, () => {
      setCacheVersion(v => v + 1)
    })
  }, [selectedCrag, cache])

  // Area 筛选状态 — 支持受控模式 (controlledArea + onAreaChange) 和内部状态
  const isControlled = controlledArea !== undefined
  const [areaState, setAreaState] = useState<{ cragId: string; area: string | null }>({
    cragId: '',
    area: null,
  })
  const internalArea = areaState.cragId === selectedCrag ? areaState.area : null
  const selectedArea = isControlled ? (controlledArea ?? null) : internalArea

  // AC4: 切换 area 时重置 face 选中状态
  const setSelectedArea = useCallback(
    (area: string | null) => {
      if (isControlled) {
        // The parent updates area + face in one URL transaction.
        onAreaChange?.(area)
      } else {
        setAreaState({ cragId: selectedCrag, area })
        if (selectedFace) onFaceSelect(null)
      }
    },
    [selectedCrag, selectedFace, onFaceSelect, isControlled, onAreaChange]
  )

  // 提取唯一 area 列表 (保持原始顺序)
  const uniqueAreas = useMemo(() => {
    const seen = new Set<string>()
    const areas: string[] = []
    for (const { area } of faces) {
      if (!seen.has(area)) {
        seen.add(area)
        areas.push(area)
      }
    }
    return areas
  }, [faces])

  // 公开引用生成 face groups (通过缓存层获取版本感知的 URL)
  // cacheVersion 变化时强制重算 → 获取带新时间戳的 URL
  const allFaceGroups = useMemo<FaceGroup[]>(() => {
    return faces.map(({ faceId, area }) => ({
      key: getFaceIdentityKey({ cragId: selectedCrag, area, faceId }),
      label: faceId,
      area,
      image: cache.getImageUrl({ cragId: selectedCrag, area, faceId }),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cacheVersion is an intentional trigger dep for cache invalidation
  }, [faces, selectedCrag, cache, cacheVersion])

  // 按选中 area 过滤
  const faceGroups = useMemo(() => {
    if (!selectedArea) return allFaceGroups
    return allFaceGroups.filter((g) => g.area === selectedArea)
  }, [allFaceGroups, selectedArea])

  const handleAllClick = useCallback(() => {
    setOptimisticFace(null)
    onFaceSelect(null)
  }, [onFaceSelect])

  const handleFaceClick = useCallback(
    (key: string) => {
      const newValue = selectedFace === key ? null : key
      setOptimisticFace(newValue)
      onFaceSelect(newValue)
    },
    [onFaceSelect, selectedFace]
  )

  if (!selectedCrag) return null

  if (allFaceGroups.length === 0) return null

  // 只有多个 area 时才显示 area 筛选芯片
  const showAreaChips = uniqueAreas.length > 1

  return (
    <div>
      {/* Area 区域标签 */}
      {showAreaChips && (
        <div className="px-4 pb-1.5">
          <FilterChipGroup>
            <FilterChip
              label={tCommon('all')}
              selected={!selectedArea}
              onClick={() => setSelectedArea(null)}
            />
            {uniqueAreas.map((area) => (
              <FilterChip
                key={area}
                label={area}
                selected={selectedArea === area}
                onClick={() => setSelectedArea(area)}
              />
            ))}
          </FilterChipGroup>
        </div>
      )}

      {/* 岩面缩略图 */}
      <div className="overflow-x-auto scrollbar-hide">
        <div className="flex gap-2 px-4 pb-2" style={{ minWidth: 'min-content' }}>
        {/* "全部" 选项 */}
        <button
          onClick={handleAllClick}
          className="flex-shrink-0 flex flex-col items-center gap-1 transition-all active:scale-95"
        >
          <div
            className={`w-16 h-12 flex items-center justify-center text-xs font-medium ${!displayFace ? '' : 'glass-light'}`}
            style={{
              borderRadius: 'var(--theme-radius-md)',
              backgroundColor: !displayFace
                ? 'var(--theme-primary)'
                : undefined,
              color: !displayFace
                ? 'var(--theme-on-primary)'
                : 'var(--theme-on-surface-variant)',
              border: !displayFace
                ? '2px solid var(--theme-primary)'
                : '2px solid transparent',
            }}
          >
            {tCommon('all')}
          </div>
        </button>

        {faceGroups.map((group) => {
          const isSelected = displayFace === group.key
          return (
            <button
              key={group.key}
              aria-label={`${group.area} · ${group.label}`}
              aria-pressed={isSelected}
              onClick={() => handleFaceClick(group.key)}
              className="flex-shrink-0 flex flex-col items-center gap-1 transition-all active:scale-95"
            >
              <div
                className="w-16 h-12 overflow-hidden"
                style={{
                  borderRadius: 'var(--theme-radius-md)',
                  border: isSelected
                    ? '2px solid var(--theme-primary)'
                    : '2px solid transparent',
                }}
              >
                <FaceThumbnail src={group.image} alt={group.label} />
              </div>
              <span
                className="text-xs max-w-16 truncate"
                style={{
                  color: isSelected
                    ? 'var(--theme-primary)'
                    : 'var(--theme-on-surface-variant)',
                  fontWeight: isSelected ? 600 : 400,
                }}
              >
                {group.label}
              </span>
            </button>
          )
        })}
        </div>
      </div>
    </div>
  )
})
