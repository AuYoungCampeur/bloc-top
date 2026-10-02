'use client'

import { ArrowUp, ArrowDown, X } from 'lucide-react'
import { FilterChip, FilterChipGroup } from '@/components/filter-chip'
import { FaceThumbnailStrip } from '@/components/face-thumbnail-strip'
import type { Crag } from '@/types'
import type { SortDirection } from '@/lib/filter-constants'

interface FilterTag {
  label: string
  onRemove: () => void
}

interface RouteFilterBarProps {
  faces: { faceId: string; area: string }[]
  crags: Crag[]
  selectedCrag: string
  onCragSelect: (cragId: string) => void
  selectedFace: string | null
  onFaceSelect: (faceId: string | null) => void
  selectedArea: string | null
  onAreaChange: (area: string | null) => void
  sortDirection: SortDirection
  onToggleSort: () => void
  activeFilterTags: FilterTag[]
  // i18n
  allLabel: string
  totalCountLabel: string
  sortAscLabel: string
  sortDescLabel: string
  sortAscHint: string
  sortDescHint: string
  faceHintLabel: string
}

export function RouteFilterBar({
  faces,
  crags,
  selectedCrag,
  onCragSelect,
  selectedFace,
  onFaceSelect,
  selectedArea,
  onAreaChange,
  sortDirection,
  onToggleSort,
  activeFilterTags,
  allLabel,
  totalCountLabel,
  sortAscLabel,
  sortDescLabel,
  sortAscHint,
  sortDescHint,
  faceHintLabel,
}: RouteFilterBarProps) {
  return (
    <div className="flex-shrink-0">
      {/* 岩场筛选 */}
      <div className="pt-[max(1.5rem,env(safe-area-inset-top))] px-4 pb-2">
        <FilterChipGroup>
          <FilterChip
            label={allLabel}
            selected={!selectedCrag}
            onClick={() => onCragSelect('')}
          />
          {crags.map((crag) => (
            <FilterChip
              key={crag.id}
              label={crag.name}
              selected={selectedCrag === crag.id}
              onClick={() => onCragSelect(crag.id)}
            />
          ))}
        </FilterChipGroup>
      </div>

      {/* 岩面缩略图 */}
      {selectedCrag ? (
        <FaceThumbnailStrip
          faces={faces}
          selectedCrag={selectedCrag}
          selectedFace={selectedFace}
          onFaceSelect={onFaceSelect}
          selectedArea={selectedArea}
          onAreaChange={onAreaChange}
          mediaRevision={crags.find(crag => crag.id === selectedCrag)?.mediaRevision}
        />
      ) : (
        <p
          className="px-4 pb-2 text-xs"
          style={{ color: 'var(--theme-on-surface-variant)', opacity: 0.6 }}
        >
          {faceHintLabel}
        </p>
      )}

      {/* 数量 + 排序 + 筛选标签 */}
      <div className="px-4 pb-2">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs" style={{ color: 'var(--theme-on-surface-variant)' }}>
            {totalCountLabel}
          </p>
          <button
            onClick={onToggleSort}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium transition-colors glass-light"
            style={{
              color: 'var(--theme-on-surface-variant)',
              borderRadius: 'var(--theme-radius-full)',
            }}
            aria-label={sortDirection === 'asc' ? sortAscHint : sortDescHint}
          >
            {sortDirection === 'asc' ? (
              <>
                <ArrowUp className="w-3 h-3" />
                <span>{sortAscLabel}</span>
              </>
            ) : (
              <>
                <ArrowDown className="w-3 h-3" />
                <span>{sortDescLabel}</span>
              </>
            )}
          </button>
        </div>

        {activeFilterTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {activeFilterTags.map((tag) => (
              <button
                key={tag.label}
                onClick={tag.onRemove}
                className="flex items-center gap-1 px-2 py-0.5 text-xs transition-all active:scale-95"
                style={{
                  color: 'var(--theme-primary)',
                  backgroundColor: 'color-mix(in srgb, var(--theme-primary) 10%, transparent)',
                  borderRadius: 'var(--theme-radius-full)',
                }}
              >
                <span className="max-w-24 truncate">{tag.label}</span>
                <X className="w-3 h-3 flex-shrink-0 opacity-60" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
