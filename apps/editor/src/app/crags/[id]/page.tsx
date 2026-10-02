'use client'

import { use, useState, useEffect, useCallback } from 'react'
import {
  Mountain,
  Loader2,
  MapPin,
  Calendar,
  Layers,
  Pencil,
  Save,
  X,
  Navigation,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useSession } from '@/lib/auth-client'
import { EditorPageHeader } from '@/components/editor/editor-page-header'
import { CragPermissionsPanel } from '@/components/editor/crag-permissions-panel'
import { useBreakAppShellLimit } from '@/hooks/use-break-app-shell-limit'
import { Input } from '@bloctop/ui/components/input'
import { Textarea } from '@bloctop/ui/components/textarea'
import { findCityName } from '@bloctop/shared/city-utils'
import { parseCoordinateInput, formatCoordinateDisplay, truncateCoordinates } from '@bloctop/shared/coordinate-utils'
import type { Crag, CityConfig } from '@bloctop/shared/types'
import { useToast } from '@bloctop/ui/components/toast'
import { publishingDelayMessage } from '@/lib/publishing-feedback'

// ==================== Types ====================

interface EditForm {
  name: string
  cityId: string
  location: string
  description: string
  approach: string
  coordinateInput: string
}

function cragToForm(crag: Crag): EditForm {
  return {
    name: crag.name,
    cityId: crag.cityId,
    location: crag.location,
    description: crag.description,
    approach: crag.approach,
    coordinateInput: crag.coordinates ? formatCoordinateDisplay(crag.coordinates) : '',
  }
}

// ==================== Crag Detail Page ====================

export default function CragDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: cragId } = use(params)

  useBreakAppShellLimit()

  const router = useRouter()
  const { showToast } = useToast()
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === 'admin'

  // ============ State ============

  const [crag, setCrag] = useState<Crag | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [editAccess, setEditAccess] = useState<{ cragId: string; userId: string; allowed: boolean } | null>(null)
  const canEdit = !!session && (isAdmin || (editAccess?.cragId === cragId && editAccess.userId === session.user.id && editAccess.allowed))

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [cities, setCities] = useState<CityConfig[]>([])

  // ============ Fetch crag data ============

  useEffect(() => {
    const controller = new AbortController()

    async function fetchCrag() {
      try {
        const res = await fetch(`/api/crags/${cragId}`, {
          signal: controller.signal,
        })
        const data = await res.json()
        if (!data.success || !data.crag) {
          router.push('/crags')
          return
        }
        setCrag(data.crag)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        router.push('/crags')
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }

    fetchCrag()
    return () => controller.abort()
  }, [cragId, router])

  // ============ Determine canEdit ============

  useEffect(() => {
    if (!session || isAdmin) return

    const controller = new AbortController()

    // Check if user has edit permission for this crag via editor crags list
    fetch('/api/editor/crags', { signal: controller.signal })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (controller.signal.aborted) return
        const found = data?.crags?.some((c: { id: string }) => c.id === cragId)
        setEditAccess({ cragId, userId: session.user.id, allowed: !!found })
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        if (!controller.signal.aborted) setEditAccess({ cragId, userId: session.user.id, allowed: false })
      })

    return () => controller.abort()
  }, [session, cragId, isAdmin])

  // ============ Fetch cities for edit mode ============

  useEffect(() => {
    if (!isEditing) return
    if (cities.length > 0) return // already fetched

    const controller = new AbortController()
    fetch('/api/cities', { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        if (data.cities) setCities(data.cities)
      })
      .catch(() => {})

    return () => controller.abort()
  }, [isEditing, cities.length])

  // ============ Edit handlers ============

  const handleStartEdit = useCallback(() => {
    if (!crag) return
    setEditForm(cragToForm(crag))
    setSaveError(null)
    setIsEditing(true)
  }, [crag])

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false)
    setEditForm(null)
    setSaveError(null)
  }, [])

  const handleSave = useCallback(async () => {
    if (!editForm || !crag) return

    setIsSaving(true)
    setSaveError(null)

    try {
      const updates: Record<string, unknown> = {}

      if (editForm.name.trim() !== crag.name) updates.name = editForm.name.trim()
      if (editForm.cityId !== crag.cityId) updates.cityId = editForm.cityId
      if (editForm.location.trim() !== crag.location) updates.location = editForm.location.trim()
      if (editForm.description.trim() !== crag.description) updates.description = editForm.description.trim()
      if (editForm.approach.trim() !== crag.approach) updates.approach = editForm.approach.trim()

      // Handle coordinates — truncate to 6 decimals before comparing to avoid
      // floating-point drift causing spurious saves
      const newCoords = editForm.coordinateInput.trim()
        ? parseCoordinateInput(editForm.coordinateInput)
        : null
      const origCoords = crag.coordinates ?? null

      if (newCoords !== null) {
        const truncNew = truncateCoordinates(newCoords)
        const truncOrig = origCoords ? truncateCoordinates(origCoords) : null
        if (!truncOrig || truncNew.lng !== truncOrig.lng || truncNew.lat !== truncOrig.lat) {
          updates.coordinates = truncNew
        }
      } else if (editForm.coordinateInput.trim() === '' && origCoords !== null) {
        updates.coordinates = null
      }

      if (Object.keys(updates).length === 0) {
        setIsEditing(false)
        setEditForm(null)
        return
      }

      const res = await fetch(`/api/crags/${cragId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        setSaveError(data.error || '保存失败')
        return
      }

      setCrag(data.crag)
      setIsEditing(false)
      setEditForm(null)
      if (data.refreshPending) showToast(publishingDelayMessage(data.warning), 'info', 8000)
    } catch {
      setSaveError('网络错误，请重试')
    } finally {
      setIsSaving(false)
    }
  }, [editForm, crag, cragId, showToast])

  const updateField = useCallback(<K extends keyof EditForm>(key: K, value: EditForm[K]) => {
    setEditForm((prev) => prev ? { ...prev, [key]: value } : prev)
  }, [])

  // ============ Loading state ============

  if (isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: 'var(--theme-surface)' }}
      >
        <Loader2
          className="w-8 h-8 animate-spin"
          style={{ color: 'var(--theme-primary)' }}
        />
      </div>
    )
  }

  // ============ Crag not found (handled by redirect, but safety net) ============

  if (!crag) {
    return null
  }

  // ============ Render ============

  return (
    <div
      className="min-h-screen pb-20 lg:pb-0"
      style={{ backgroundColor: 'var(--theme-surface)' }}
    >
      {/* Header */}
      <EditorPageHeader
        title="岩场详情"
        icon={
          <Mountain
            className="w-5 h-5"
            style={{ color: 'var(--theme-primary)' }}
          />
        }
        isDetailMode={true}
        onBackToList={() => router.push('/crags')}
        listLabel="岩场列表"
      />

      {/* Content */}
      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {canEdit && (
          <nav aria-label="当前岩场内容管理" className="flex gap-3">
            <Link href={`/faces?cragId=${encodeURIComponent(cragId)}`} className="glass-light p-3 rounded-xl">管理岩面</Link>
            <Link href={`/routes?cragId=${encodeURIComponent(cragId)}`} className="glass-light p-3 rounded-xl">管理线路与 Beta</Link>
          </nav>
        )}
        {/* ==================== Crag Info Card ==================== */}
        <div
          className="glass-light p-5 space-y-4 animate-fade-in-up"
          style={{
            borderRadius: 'var(--theme-radius-xl)',
          }}
        >
          {/* Card header with edit button */}
          <div className="flex items-center justify-between">
            {isEditing && editForm ? (
              <Input
                value={editForm.name}
                onChange={(value) => updateField('name', value)}
                className="text-xl font-bold flex-1"
                style={{ color: 'var(--theme-on-surface)' }}
                placeholder="岩场名称"
              />
            ) : (
              <h2
                className="text-xl font-bold"
                style={{ color: 'var(--theme-on-surface)' }}
              >
                {crag.name}
              </h2>
            )}

            {canEdit && !isEditing && (
              <button
                onClick={handleStartEdit}
                className="p-2 rounded-lg transition-colors shrink-0 ml-2"
                style={{
                  color: 'var(--theme-primary)',
                  backgroundColor: 'color-mix(in srgb, var(--theme-primary) 10%, transparent)',
                }}
                aria-label="编辑岩场信息"
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Info rows / Edit form */}
          {isEditing && editForm ? (
            <div className="space-y-4">
              {/* City selector */}
              <div className="space-y-1">
                <label
                  className="text-xs font-medium"
                  style={{ color: 'var(--theme-on-surface-variant)' }}
                >
                  所属城市
                </label>
                <select
                  value={editForm.cityId}
                  onChange={(e) => updateField('cityId', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm border"
                  style={{
                    backgroundColor: 'var(--theme-surface)',
                    color: 'var(--theme-on-surface)',
                    borderColor: 'var(--theme-outline-variant)',
                    borderRadius: 'var(--theme-radius-md)',
                  }}
                >
                  {cities.length === 0 ? (
                    <option value={editForm.cityId}>{editForm.cityId}</option>
                  ) : (
                    cities.map((city) => (
                      <option key={city.id} value={city.id}>
                        {city.name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* Location */}
              <div className="space-y-1">
                <label
                  className="text-xs font-medium"
                  style={{ color: 'var(--theme-on-surface-variant)' }}
                >
                  位置
                </label>
                <Input
                  value={editForm.location}
                  onChange={(value) => updateField('location', value)}
                  placeholder="详细地址"
                />
              </div>

              {/* Description */}
              <div className="space-y-1">
                <label
                  className="text-xs font-medium"
                  style={{ color: 'var(--theme-on-surface-variant)' }}
                >
                  描述
                </label>
                <Textarea
                  value={editForm.description}
                  onChange={(value) => updateField('description', value)}
                  placeholder="岩场描述"
                  rows={4}
                />
              </div>

              {/* Approach */}
              <div className="space-y-1">
                <label
                  className="text-xs font-medium"
                  style={{ color: 'var(--theme-on-surface-variant)' }}
                >
                  接近路线
                </label>
                <Textarea
                  value={editForm.approach}
                  onChange={(value) => updateField('approach', value)}
                  placeholder="如何到达岩场"
                  rows={3}
                />
              </div>

              {/* Coordinates */}
              <div className="space-y-1">
                <label
                  className="text-xs font-medium flex items-center gap-1"
                  style={{ color: 'var(--theme-on-surface-variant)' }}
                >
                  <Navigation className="w-3 h-3" />
                  坐标 (GCJ-02)
                </label>
                <Input
                  value={editForm.coordinateInput}
                  onChange={(value) => updateField('coordinateInput', value)}
                  placeholder="经度,纬度 (如 119.306239,26.063477)"
                />
                <p
                  className="text-[11px]"
                  style={{ color: 'var(--theme-on-surface-variant)' }}
                >
                  格式: 经度,纬度 — 从<a
                    href="https://lbs.amap.com/tools/picker"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                    style={{ color: 'var(--theme-primary)' }}
                  >高德坐标拾取器</a>复制粘贴即可，留空则清除
                </p>
              </div>

              {/* Error message */}
              {saveError && (
                <p
                  className="text-sm"
                  style={{ color: 'var(--theme-error)' }}
                >
                  {saveError}
                </p>
              )}

              {/* Save / Cancel buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-opacity"
                  style={{
                    backgroundColor: 'var(--theme-primary)',
                    color: 'var(--theme-on-primary)',
                    borderRadius: 'var(--theme-radius-lg)',
                    opacity: isSaving ? 0.6 : 1,
                  }}
                >
                  {isSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  {isSaving ? '保存中...' : '保存'}
                </button>
                <button
                  onClick={handleCancelEdit}
                  disabled={isSaving}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-opacity"
                  style={{
                    backgroundColor: 'var(--theme-surface-variant)',
                    color: 'var(--theme-on-surface-variant)',
                    borderRadius: 'var(--theme-radius-lg)',
                    opacity: isSaving ? 0.6 : 1,
                  }}
                >
                  <X className="w-4 h-4" />
                  取消
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Read-only info rows */}
              <div className="space-y-3">
                {/* City */}
                <div className="flex items-center gap-3">
                  <Mountain
                    className="w-4 h-4 shrink-0"
                    style={{ color: 'var(--theme-primary)' }}
                  />
                  <span
                    className="text-sm"
                    style={{ color: 'var(--theme-on-surface-variant)' }}
                  >
                    {cities.length > 0 ? findCityName(cities, crag.cityId) : crag.cityId}
                  </span>
                </div>

                {/* Location */}
                <div className="flex items-start gap-3">
                  <MapPin
                    className="w-4 h-4 shrink-0 mt-0.5"
                    style={{ color: 'var(--theme-primary)' }}
                  />
                  <span
                    className="text-sm"
                    style={{ color: 'var(--theme-on-surface-variant)' }}
                  >
                    {crag.location}
                  </span>
                </div>

                {/* Areas count */}
                {crag.areas && crag.areas.length > 0 && (
                  <div className="flex items-center gap-3">
                    <Layers
                      className="w-4 h-4 shrink-0"
                      style={{ color: 'var(--theme-primary)' }}
                    />
                    <span
                      className="text-sm"
                      style={{ color: 'var(--theme-on-surface-variant)' }}
                    >
                      {crag.areas.length} 个区域
                    </span>
                  </div>
                )}

                {/* Development time */}
                {crag.developmentTime && (
                  <div className="flex items-center gap-3">
                    <Calendar
                      className="w-4 h-4 shrink-0"
                      style={{ color: 'var(--theme-primary)' }}
                    />
                    <span
                      className="text-sm"
                      style={{ color: 'var(--theme-on-surface-variant)' }}
                    >
                      {crag.developmentTime}
                    </span>
                  </div>
                )}

                {/* Coordinates */}
                {crag.coordinates && (
                  <div className="flex items-center gap-3">
                    <Navigation
                      className="w-4 h-4 shrink-0"
                      style={{ color: 'var(--theme-primary)' }}
                    />
                    <span
                      className="text-sm"
                      style={{ color: 'var(--theme-on-surface-variant)' }}
                    >
                      {crag.coordinates.lng.toFixed(6)}, {crag.coordinates.lat.toFixed(6)}
                      <span className="text-[10px] ml-1 opacity-60">(经度, 纬度)</span>
                    </span>
                  </div>
                )}
              </div>

              {/* Description */}
              {crag.description && (
                <div className="space-y-1">
                  <p
                    className="text-xs font-medium"
                    style={{ color: 'var(--theme-on-surface-variant)' }}
                  >
                    描述
                  </p>
                  <p
                    className="text-sm leading-relaxed"
                    style={{ color: 'var(--theme-on-surface-variant)' }}
                  >
                    {crag.description}
                  </p>
                </div>
              )}

              {/* Approach */}
              {crag.approach && (
                <div className="space-y-1">
                  <p
                    className="text-xs font-medium"
                    style={{ color: 'var(--theme-on-surface-variant)' }}
                  >
                    接近路线
                  </p>
                  <p
                    className="text-sm leading-relaxed"
                    style={{ color: 'var(--theme-on-surface-variant)' }}
                  >
                    {crag.approach}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* ==================== Permissions Panel ==================== */}
        <div className="animate-fade-in-up" style={{ animationDelay: '100ms', animationFillMode: 'both' }}>
          <CragPermissionsPanel cragId={cragId} canManage={isAdmin} />
        </div>
      </div>

      {/* Mobile Tabbar */}
    </div>
  )
}
