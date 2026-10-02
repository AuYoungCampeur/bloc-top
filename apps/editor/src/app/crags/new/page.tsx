'use client'

import { useState, useEffect, useRef } from 'react'
import { Mountain, Loader2, Save, X, Navigation } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { EditorPageHeader } from '@/components/editor/editor-page-header'
import { useBreakAppShellLimit } from '@/hooks/use-break-app-shell-limit'
import { Input } from '@bloctop/ui/components/input'
import { Textarea } from '@bloctop/ui/components/textarea'
import { parseCoordinateInput, truncateCoordinates } from '@bloctop/shared/coordinate-utils'
import type { CityConfig } from '@bloctop/shared/types'
import { useSession } from '@/lib/auth-client'
import { ConfirmDialog } from '@/components/editor/confirm-dialog'
import { CRAG_ID_PATTERN, isValidCoordinates } from '@/lib/crag-validation'
import { pinyin } from 'pinyin-pro'
import { useToast } from '@bloctop/ui/components/toast'
import { publishingDelayMessage } from '@/lib/publishing-feedback'

interface CreateForm {
  id: string
  name: string
  cityId: string
  location: string
  description: string
  approach: string
  coordinateInput: string
}

const EMPTY_FORM: CreateForm = {
  id: '',
  name: '',
  cityId: '',
  location: '',
  description: '',
  approach: '',
  coordinateInput: '',
}

function nameToId(name: string) {
  return pinyin(name, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('-')
    .toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * 新建岩场页面
 * 仅 admin 可访问（通过 canCreate 权限控制）
 */
export default function NewCragPage() {
  useBreakAppShellLimit()

  const router = useRouter()
  const { showToast } = useToast()
  const { data: session, isPending } = useSession()
  const isAdmin = !isPending && session?.user?.role === 'admin'
  const userId = session?.user?.id
  const draftKey = userId ? `bloctop:new-crag:${userId}` : null

  const [form, setForm] = useState<CreateForm>(EMPTY_FORM)
  const [cities, setCities] = useState<CityConfig[]>([])
  const [citiesLoading, setCitiesLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof CreateForm, string>>>({})
  const [readyUserId, setReadyUserId] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [showLeaveDialog, setShowLeaveDialog] = useState(false)
  const [citiesError, setCitiesError] = useState<string | null>(null)
  const [cityLoadVersion, setCityLoadVersion] = useState(0)
  const savingRef = useRef(false)
  const currentCreatorRef = useRef<string | null>(null)
  currentCreatorRef.current = isAdmin && userId ? userId : null
  const draftReady = !!userId && readyUserId === userId

  useEffect(() => {
    if (!isAdmin || !userId || !draftKey) return
    let restored: CreateForm | null = null
    try {
      const stored = JSON.parse(sessionStorage.getItem(draftKey) || 'null')
      if (stored && Object.keys(EMPTY_FORM).every(key => typeof stored[key] === 'string')) restored = stored
    } catch { /* An unavailable or old browser draft cannot block the form. */ }
    setForm(restored ?? EMPTY_FORM)
    setIsDirty(!!restored)
    setReadyUserId(userId)
  }, [isAdmin, userId, draftKey])

  useEffect(() => {
    if (!isAdmin || !draftReady || !draftKey) return
    try {
      if (isDirty) sessionStorage.setItem(draftKey, JSON.stringify(form))
      else sessionStorage.removeItem(draftKey)
    } catch { /* The unload guard still protects unsaved input. */ }
  }, [form, isDirty, isAdmin, draftReady, draftKey])

  useEffect(() => {
    if (!isDirty && !isSaving) return
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [isDirty, isSaving])

  // 加载城市列表
  useEffect(() => {
    if (!isAdmin || !draftReady) return
    const controller = new AbortController()
    setCitiesLoading(true)
    setCitiesError(null)
    fetch('/api/cities', { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok || !data.success || !Array.isArray(data.cities)) throw new Error(data.error || '加载城市失败')
        return data
      })
      .then((data) => {
        if (controller.signal.aborted) return
        setCities(data.cities)
        // Management can prepare content before a city is publicly enabled.
        setForm(prev => ({ ...prev, cityId: prev.cityId || data.cities[0]?.id || '' }))
      })
      .catch(error => {
        if (!controller.signal.aborted) setCitiesError(error instanceof Error ? error.message : '加载城市失败')
      })
      .finally(() => { if (!controller.signal.aborted) setCitiesLoading(false) })
    return () => controller.abort()
  }, [isAdmin, draftReady, cityLoadVersion])

  const updateField = <K extends keyof CreateForm>(key: K, value: CreateForm[K]) => {
    if (savingRef.current) return
    setIsDirty(true)
    setForm((prev) => ({ ...prev, [key]: value }))
    // 清除该字段的错误
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  // 自动从岩场名生成 slug ID（仅供参考，用户可手动修改）
  const handleNameChange = (value: string) => {
    if (savingRef.current) return
    setIsDirty(true)
    setForm((prev) => {
      const shouldUpdate = prev.id === '' || prev.id === nameToId(prev.name)
      return {
        ...prev,
        name: value,
        id: shouldUpdate ? nameToId(value) : prev.id,
      }
    })
    setFieldErrors((prev) => ({ ...prev, name: undefined, id: undefined }))
  }

  const validate = (): boolean => {
    const errors: Partial<Record<keyof CreateForm, string>> = {}
    if (!form.id.trim()) errors.id = 'ID 不能为空'
    else if (!CRAG_ID_PATTERN.test(form.id.trim()) || form.id.trim().length > 100) errors.id = 'ID 仅支持小写字母、数字和单个连字符，最长 100 字符'

    if (!form.name.trim()) errors.name = '名称不能为空'
    if (!cities.some(city => city.id === form.cityId)) errors.cityId = '请选择有效的所属城市'
    if (!form.location.trim()) errors.location = '位置不能为空'
    if (!form.description.trim()) errors.description = '描述不能为空'
    if (!form.approach.trim()) errors.approach = '接近路线不能为空'

    if (form.coordinateInput.trim()) {
      const parsed = parseCoordinateInput(form.coordinateInput)
      if (!parsed || !isValidCoordinates(parsed)) errors.coordinateInput = '坐标无效，请使用有效的经度,纬度'
    }

    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async () => {
    if (!isAdmin || !draftReady || savingRef.current || citiesLoading || citiesError) return
    setSaveError(null)
    if (!validate()) return

    savingRef.current = true
    setIsSaving(true)

    try {
      const coordinates = form.coordinateInput.trim()
        ? truncateCoordinates(parseCoordinateInput(form.coordinateInput)!)
        : undefined

      const res = await fetch('/api/crags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: form.id.trim(),
          name: form.name.trim(),
          cityId: form.cityId,
          location: form.location.trim(),
          description: form.description.trim(),
          approach: form.approach.trim(),
          ...(coordinates ? { coordinates } : {}),
        }),
      })

      const data = await res.json()

      // A completed request belongs to its original creator, even if the session changed meanwhile.
      if (res.ok && data.success && data.crag?.id) {
        try { if (draftKey) sessionStorage.removeItem(draftKey) } catch { /* Storage is optional. */ }
      }
      if (currentCreatorRef.current !== userId) return

      if (!res.ok || !data.success) {
        setSaveError(data.error || '创建失败，请重试')
        if (data.fieldErrors) {
          const { coordinates, ...rest } = data.fieldErrors
          setFieldErrors({ ...rest, ...(coordinates ? { coordinateInput: coordinates } : {}) })
        }
        return
      }

      // 创建成功，跳转到新岩场详情页
      if (!data.crag?.id) throw new Error('创建响应缺少岩场')
      setIsDirty(false)
      if (data.refreshPending) showToast(publishingDelayMessage(data.warning), 'info', 8000)
      router.push(`/crags/${encodeURIComponent(data.crag.id)}`)
    } catch {
      if (currentCreatorRef.current === userId) setSaveError('网络错误，请重试')
    } finally {
      savingRef.current = false
      setIsSaving(false)
    }
  }

  const requestLeave = () => {
    if (savingRef.current) return
    if (isDirty) setShowLeaveDialog(true)
    else router.push('/crags')
  }

  if (isPending) return <p className="p-6" role="status">正在确认管理权限...</p>
  if (!isAdmin) return <div className="p-6"><p role="alert">仅系统管理员可以新建岩场</p></div>

  return (
    <div
      className="min-h-screen pb-20 lg:pb-0"
      style={{ backgroundColor: 'var(--theme-surface)' }}
    >
      <EditorPageHeader
        title="新建岩场"
        icon={<Mountain className="w-5 h-5" style={{ color: 'var(--theme-primary)' }} />}
        isDetailMode={true}
        onBackToList={requestLeave}
        onBack={requestLeave}
        listLabel="岩场列表"
      />

      <div className="max-w-lg mx-auto px-4 py-6">
        <p className="text-xs mb-3" style={{ color: 'var(--theme-on-surface-variant)' }}>草稿保留在当前浏览器，创建成功或明确放弃后清除。</p>
        <div
          className="glass-light p-5 space-y-5 animate-fade-in-up"
          style={{ borderRadius: 'var(--theme-radius-xl)' }}
        >
          <fieldset disabled={isSaving || !draftReady} className="space-y-5 min-w-0">
          {/* 岩场名称 */}
          <div className="space-y-1">
            <label className="text-xs font-medium" style={{ color: 'var(--theme-on-surface-variant)' }}>
              岩场名称 <span style={{ color: 'var(--theme-error)' }}>*</span>
            </label>
            <Input
              value={form.name}
              onChange={handleNameChange}
              placeholder="如：袁通寺"
            />
            {fieldErrors.name && (
              <p className="text-xs" style={{ color: 'var(--theme-error)' }}>{fieldErrors.name}</p>
            )}
          </div>

          {/* 岩场 ID（Slug） */}
          <div className="space-y-1">
            <label className="text-xs font-medium" style={{ color: 'var(--theme-on-surface-variant)' }}>
              岩场 ID <span style={{ color: 'var(--theme-error)' }}>*</span>
            </label>
            <Input
              value={form.id}
              onChange={(v) => updateField('id', v)}
              placeholder="如：yuan-tong-si（小写字母、数字、连字符）"
            />
            <p className="text-[11px]" style={{ color: 'var(--theme-on-surface-variant)' }}>
              ID 创建后不可修改，将用于 URL 路径（如 /crags/yuan-tong-si）
            </p>
            {fieldErrors.id && (
              <p className="text-xs" style={{ color: 'var(--theme-error)' }}>{fieldErrors.id}</p>
            )}
          </div>

          {/* 所属城市 */}
          <div className="space-y-1">
            <label className="text-xs font-medium" style={{ color: 'var(--theme-on-surface-variant)' }}>
              所属城市 <span style={{ color: 'var(--theme-error)' }}>*</span>
            </label>
            {citiesLoading ? (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--theme-primary)' }} />
                <span className="text-sm" style={{ color: 'var(--theme-on-surface-variant)' }}>加载城市列表...</span>
              </div>
            ) : citiesError ? (
              <div><p role="alert">{citiesError}</p><button type="button" onClick={() => setCityLoadVersion(v => v + 1)}>重试加载城市</button></div>
            ) : cities.length === 0 ? (
              <p role="status">暂无城市，请先在城市管理中创建城市。</p>
            ) : (
              <select
                value={form.cityId}
                onChange={(e) => updateField('cityId', e.target.value)}
                className="w-full px-3 py-2 text-sm border"
                style={{
                  backgroundColor: 'var(--theme-surface)',
                  color: 'var(--theme-on-surface)',
                  borderColor: 'var(--theme-outline-variant)',
                  borderRadius: 'var(--theme-radius-md)',
                }}
              >
                <option value="">请选择城市</option>
                {form.cityId && !cities.some(city => city.id === form.cityId) && <option value={form.cityId} disabled>城市已移除，请重新选择</option>}
                {cities.map((city) => (
                  <option key={city.id} value={city.id}>{city.name}{city.available ? '' : '（未启用）'}</option>
                ))}
              </select>
            )}
            {fieldErrors.cityId && (
              <p className="text-xs" style={{ color: 'var(--theme-error)' }}>{fieldErrors.cityId}</p>
            )}
          </div>

          {/* 位置 */}
          <div className="space-y-1">
            <label className="text-xs font-medium" style={{ color: 'var(--theme-on-surface-variant)' }}>
              位置 <span style={{ color: 'var(--theme-error)' }}>*</span>
            </label>
            <Input
              value={form.location}
              onChange={(v) => updateField('location', v)}
              placeholder="详细地址"
            />
            {fieldErrors.location && (
              <p className="text-xs" style={{ color: 'var(--theme-error)' }}>{fieldErrors.location}</p>
            )}
          </div>

          {/* 坐标（可选） */}
          <div className="space-y-1">
            <label
              className="text-xs font-medium flex items-center gap-1"
              style={{ color: 'var(--theme-on-surface-variant)' }}
            >
              <Navigation className="w-3 h-3" />
              坐标 GCJ-02（可选）
            </label>
            <Input
              value={form.coordinateInput}
              onChange={(v) => updateField('coordinateInput', v)}
              placeholder="经度,纬度（如 119.306239,26.063477）"
            />
            <p className="text-[11px]" style={{ color: 'var(--theme-on-surface-variant)' }}>
              从
              <a
                href="https://lbs.amap.com/tools/picker"
                target="_blank"
                rel="noopener noreferrer"
                className="underline mx-0.5"
                style={{ color: 'var(--theme-primary)' }}
              >
                高德坐标拾取器
              </a>
              复制粘贴，留空则稍后填写
            </p>
            {fieldErrors.coordinateInput && (
              <p className="text-xs" style={{ color: 'var(--theme-error)' }}>{fieldErrors.coordinateInput}</p>
            )}
          </div>

          {/* 描述 */}
          <div className="space-y-1">
            <label className="text-xs font-medium" style={{ color: 'var(--theme-on-surface-variant)' }}>
              描述 <span style={{ color: 'var(--theme-error)' }}>*</span>
            </label>
            <Textarea
              value={form.description}
              onChange={(v) => updateField('description', v)}
              placeholder="岩场描述、特色、注意事项等"
              rows={4}
            />
            {fieldErrors.description && (
              <p className="text-xs" style={{ color: 'var(--theme-error)' }}>{fieldErrors.description}</p>
            )}
          </div>

          {/* 接近路线 */}
          <div className="space-y-1">
            <label className="text-xs font-medium" style={{ color: 'var(--theme-on-surface-variant)' }}>
              接近路线 <span style={{ color: 'var(--theme-error)' }}>*</span>
            </label>
            <Textarea
              value={form.approach}
              onChange={(v) => updateField('approach', v)}
              placeholder="如何到达岩场，停车、步行路线等"
              rows={3}
            />
            {fieldErrors.approach && (
              <p className="text-xs" style={{ color: 'var(--theme-error)' }}>{fieldErrors.approach}</p>
            )}
          </div>

          {/* 全局错误 */}
          {saveError && (
            <p className="text-sm" role="alert" style={{ color: 'var(--theme-error)' }}>{saveError}</p>
          )}

          {/* 操作按钮 */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSubmit}
              disabled={isSaving || citiesLoading || !!citiesError || cities.length === 0}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-opacity"
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
              {isSaving ? '创建中...' : '创建岩场'}
            </button>
            <button
              onClick={requestLeave}
              disabled={isSaving}
              className="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-opacity"
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
          </fieldset>
        </div>
      </div>
      <ConfirmDialog
        isOpen={showLeaveDialog}
        title="放弃新建岩场草稿？"
        description="尚未创建岩场。放弃后会清除当前浏览器中的草稿。"
        confirmLabel="放弃并返回"
        cancelLabel="继续填写"
        onCancel={() => setShowLeaveDialog(false)}
        onConfirm={() => {
          try { if (draftKey) sessionStorage.removeItem(draftKey) } catch { /* Storage is optional. */ }
          setIsDirty(false)
          setShowLeaveDialog(false)
          router.push('/crags')
        }}
      />
    </div>
  )
}
