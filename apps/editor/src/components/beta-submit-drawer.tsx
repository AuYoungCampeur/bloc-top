'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Link2, User, Ruler, MoveHorizontal, Check, AlertCircle } from 'lucide-react'
import { Drawer } from '@bloctop/ui/components/drawer'
import { Input } from '@bloctop/ui/components/input'
import { detectPlatformFromUrl, isXiaohongshuUrl, extractUrlFromText, BETA_PLATFORMS } from '@bloctop/shared/beta-constants'
import { useClimberBodyData } from '@/hooks/use-climber-body-data'
import { useSession } from '@/lib/auth-client'
import type { BetaLink } from '@bloctop/shared/types'

/** API 错误码 → 中文提示 */
const API_ERROR_MESSAGES: Record<string, string> = {
  SERVER_ERROR: '服务器错误，请稍后重试',
  RATE_LIMITED: '请求过于频繁，请稍后再试',
  MISSING_ROUTE_ID: '缺少线路 ID',
  MISSING_FIELDS: '缺少必填字段',
  INVALID_URL: '无法识别有效的链接',
  ONLY_XIAOHONGSHU: '目前仅支持小红书链接',
  INVALID_HEIGHT: '身高应在 100-250 cm 之间',
  INVALID_REACH: '臂展应在 100-250 cm 之间',
  CANNOT_PARSE_NOTE: '无法识别小红书笔记链接',
  ROUTE_NOT_FOUND: '线路不存在',
  DUPLICATE_BETA: '该视频已被分享过啦～',
  UPDATE_FAILED: '更新失败，请重试',
  MISSING_BETA_ID: '缺少 Beta ID',
  BETA_NOT_FOUND: '未找到该 Beta',
  UNKNOWN: '发生未知错误',
}

interface BetaSubmitDrawerProps {
  isOpen: boolean
  onClose: () => void
  routeId: number
  routeName: string
  onSuccess?: (beta: BetaLink) => void
}

export function BetaSubmitDrawer({
  isOpen,
  onClose,
  routeId,
  routeName,
  onSuccess,
}: BetaSubmitDrawerProps) {
  const { data: session } = useSession()
  const userId = session?.user?.id
  const actor = `${userId ?? 'anonymous'}:${session?.session?.id ?? ''}`
  const nicknameKey = userId ? `beta_nickname:user:${userId}` : 'beta_nickname:anonymous'
  const { bodyData, updateBodyData } = useClimberBodyData()
  const [url, setUrl] = useState('')
  const [nickname, setNickname] = useState('')
  const [height, setHeight] = useState('')
  const [reach, setReach] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const generation = useRef(0)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // An in-flight POST can still save after leaving this form. Its response
  // belongs only to the account, route and drawer opening that submitted it.
  useEffect(() => {
    generation.current += 1
    async function resetContext() {
      setUrl('')
      setError(null)
      setSuccess(false)
      setIsSubmitting(false)
    }
    resetContext()
    return () => {
      generation.current += 1
      if (closeTimer.current) clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [actor, routeId, isOpen])

  // 抽屉打开时，用缓存数据预填充表单
  useEffect(() => {
    if (isOpen) {
      // The legacy global nickname has unknown ownership; never import it.
      try { setNickname(localStorage.getItem(nicknameKey) || '') } catch { setNickname('') }
      setHeight(bodyData.height)
      setReach(bodyData.reach)
    }
  }, [isOpen, actor, routeId, nicknameKey, bodyData.height, bodyData.reach])

  // 检测平台
  const detectedPlatform = url ? detectPlatformFromUrl(url) : null
  const platformInfo = detectedPlatform ? BETA_PLATFORMS[detectedPlatform] : null

  // 处理用户输入：从粘贴的文本中智能提取 URL
  const handleUrlChange = useCallback((input: string) => {
    const extracted = extractUrlFromText(input)
    if (extracted) {
      setUrl(extracted)
    } else {
      setUrl(input)
    }
  }, [])

  // 验证 URL
  const isValidUrl = useCallback((input: string) => {
    if (!input.trim()) return false
    try {
      new URL(input)
      return true
    } catch {
      try {
        new URL(`https://${input}`)
        return true
      } catch {
        return false
      }
    }
  }, [])

  // 重置表单
  const resetForm = useCallback(() => {
    setUrl('')
    setNickname('')
    setHeight('')
    setReach('')
    setError(null)
    setSuccess(false)
  }, [])

  // 关闭抽屉
  const handleClose = useCallback(() => {
    generation.current += 1
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
    setIsSubmitting(false)
    resetForm()
    onClose()
  }, [resetForm, onClose])

  // 提交表单
  const handleSubmit = async () => {
    if (!isValidUrl(url)) {
      setError('请输入有效的链接地址')
      return
    }

    if (!isXiaohongshuUrl(url)) {
      setError('目前仅支持小红书链接')
      return
    }

    setIsSubmitting(true)
    setError(null)
    const submittedGeneration = generation.current
    const isCurrent = () => generation.current === submittedGeneration

    try {
      const response = await fetch('/api/beta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routeId,
          url: url.startsWith('http') ? url : `https://${url}`,
          author: nickname.trim() || undefined,
          climberHeight: height ? parseInt(height, 10) : undefined,
          climberReach: reach ? parseInt(reach, 10) : undefined,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        const errorCode = data.code || data.error
        const translatedError = errorCode ? (API_ERROR_MESSAGES[errorCode] || '提交失败，请重试') : '提交失败，请重试'
        throw new Error(translatedError)
      }

      const data = await response.json()
      if (!isCurrent()) return
      setSuccess(true)
      try { if (nickname.trim()) localStorage.setItem(nicknameKey, nickname.trim()) } catch {}
      updateBodyData({ height, reach })
      closeTimer.current = setTimeout(() => {
        if (!isCurrent()) return
        handleClose()
        if (data.beta) onSuccess?.(data.beta as BetaLink)
      }, 1500)
    } catch (err) {
      if (isCurrent()) setError(err instanceof Error ? err.message : '提交失败，请重试')
    } finally {
      if (isCurrent()) setIsSubmitting(false)
    }
  }

  return (
    <Drawer
      isOpen={isOpen}
      onClose={handleClose}
      height="half"
      title={`分享 ${routeName} 的 Beta`}
      showCloseButton
    >
      <div className="px-4 pb-4 space-y-4">
        {/* 成功提示 */}
        {success && (
          <div
            className="flex items-center gap-3 p-4 animate-fade-in-up"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--theme-success) 15%, var(--theme-surface))',
              borderRadius: 'var(--theme-radius-xl)',
              border: '1px solid var(--theme-success)',
            }}
          >
            <Check className="w-5 h-5" style={{ color: 'var(--theme-success)' }} />
            <span style={{ color: 'var(--theme-success)' }}>Beta 分享成功！</span>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div
            className="flex items-center gap-3 p-4 animate-fade-in-up"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--theme-error) 15%, var(--theme-surface))',
              borderRadius: 'var(--theme-radius-xl)',
              border: '1px solid var(--theme-error)',
            }}
          >
            <AlertCircle className="w-5 h-5" style={{ color: 'var(--theme-error)' }} />
            <span style={{ color: 'var(--theme-error)' }}>{error}</span>
          </div>
        )}

        {/* 链接输入 */}
        <div>
          <label
            className="text-sm font-medium mb-2 block"
            style={{ color: 'var(--theme-on-surface)' }}
          >
            视频链接 <span style={{ color: 'var(--theme-error)' }}>*</span>
          </label>
          <div className="relative">
            <Link2
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5"
              style={{ color: 'var(--theme-on-surface-variant)' }}
            />
            <Input
              variant="unstyled"
              value={url}
              onChange={handleUrlChange}
              placeholder="直接粘贴小红书分享内容..."
              className="w-full pl-10 pr-4 py-3 text-sm outline-none glass-light"
              style={{
                borderRadius: 'var(--theme-radius-lg)',
                color: 'var(--theme-on-surface)',
              }}
              disabled={isSubmitting || success}
            />
          </div>
          {platformInfo && (
            <div
              className="flex items-center gap-2 mt-2 text-xs"
              style={{ color: platformInfo.color }}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: platformInfo.color }}
              />
              已识别为 {platformInfo.name} 链接
            </div>
          )}
        </div>

        {/* 昵称（可选） */}
        <div>
          <label
            className="text-sm font-medium mb-2 block"
            style={{ color: 'var(--theme-on-surface)' }}
          >
            昵称 <span className="text-xs font-normal" style={{ color: 'var(--theme-on-surface-variant)' }}>(选填)</span>
          </label>
          <div className="relative">
            <User
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5"
              style={{ color: 'var(--theme-on-surface-variant)' }}
            />
            <Input
              variant="unstyled"
              value={nickname}
              onChange={setNickname}
              placeholder="你的昵称"
              className="w-full pl-10 pr-4 py-3 text-sm outline-none glass-light"
              style={{
                borderRadius: 'var(--theme-radius-lg)',
                color: 'var(--theme-on-surface)',
              }}
              disabled={isSubmitting || success}
            />
          </div>
        </div>

        {/* 身体数据（可选） */}
        <div>
          <label
            className="text-sm font-medium mb-2 block"
            style={{ color: 'var(--theme-on-surface)' }}
          >
            身体数据 <span className="text-xs font-normal" style={{ color: 'var(--theme-on-surface-variant)' }}>(选填)</span>
          </label>
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Ruler
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                style={{ color: 'var(--theme-on-surface-variant)' }}
              />
              {/* eslint-disable-next-line no-restricted-syntax -- type="number" has no IME composition */}
              <input
                type="number"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                placeholder="身高"
                className="w-full pl-9 pr-10 py-3 text-sm outline-none glass-light"
                style={{
                  borderRadius: 'var(--theme-radius-lg)',
                  color: 'var(--theme-on-surface)',
                }}
                min={100}
                max={250}
                disabled={isSubmitting || success}
              />
              <span
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs"
                style={{ color: 'var(--theme-on-surface-variant)' }}
              >
                cm
              </span>
            </div>
            <div className="flex-1 relative">
              <MoveHorizontal
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                style={{ color: 'var(--theme-on-surface-variant)' }}
              />
              {/* eslint-disable-next-line no-restricted-syntax -- type="number" has no IME composition */}
              <input
                type="number"
                value={reach}
                onChange={(e) => setReach(e.target.value)}
                placeholder="臂展"
                className="w-full pl-9 pr-10 py-3 text-sm outline-none glass-light"
                style={{
                  borderRadius: 'var(--theme-radius-lg)',
                  color: 'var(--theme-on-surface)',
                }}
                min={100}
                max={250}
                disabled={isSubmitting || success}
              />
              <span
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs"
                style={{ color: 'var(--theme-on-surface-variant)' }}
              >
                cm
              </span>
            </div>
          </div>
          <p
            className="text-xs mt-2"
            style={{ color: 'var(--theme-on-surface-variant)' }}
          >
            提供身体数据可以帮助其他攀登者参考 Beta 的适用性
          </p>
        </div>

        {/* 提交按钮 */}
        <button
          onClick={handleSubmit}
          disabled={!url || isSubmitting || success}
          className="w-full py-3 text-sm font-medium transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            backgroundColor: 'var(--theme-primary)',
            color: 'var(--theme-on-primary)',
            borderRadius: 'var(--theme-radius-xl)',
          }}
        >
          {isSubmitting ? '提交中...' : success ? '已提交' : '贡献 Beta'}
        </button>
      </div>
    </Drawer>
  )
}
