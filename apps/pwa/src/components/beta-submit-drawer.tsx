'use client'

import { useState, useCallback, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Link2, User, Ruler, MoveHorizontal, Check, AlertCircle, LogIn } from 'lucide-react'
import { Drawer } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Link, usePathname } from '@/i18n/navigation'
import { detectPlatformFromUrl, isXiaohongshuUrl, extractUrlFromText, BETA_PLATFORMS } from '@/lib/beta-constants'
import { useClimberBodyData } from '@/hooks/use-climber-body-data'
import { useSession } from '@/lib/auth-client'
import type { BetaLink } from '@/types'

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
  const t = useTranslations('Beta')
  const tAuth = useTranslations('Auth')
  const tApiError = useTranslations('APIError')
  const session = useSession()
  const isLoggedIn = !!session.data
  const pathname = usePathname()
  const { bodyData, updateBodyData } = useClimberBodyData()
  const [url, setUrl] = useState('')
  const [nickname, setNickname] = useState('')
  const [height, setHeight] = useState('')
  const [reach, setReach] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // 抽屉打开时，用缓存数据预填充表单
  useEffect(() => {
    if (isOpen) {
      setNickname(localStorage.getItem('beta_nickname') || '')
      setHeight(bodyData.height)
      setReach(bodyData.reach)
    }
  }, [isOpen, bodyData.height, bodyData.reach])

  // 检测平台
  const detectedPlatform = url ? detectPlatformFromUrl(url) : null
  const platformInfo = detectedPlatform ? BETA_PLATFORMS[detectedPlatform] : null

  // 处理用户输入：从粘贴的文本中智能提取 URL
  const handleUrlChange = useCallback((input: string) => {
    // 尝试从文本中提取 URL（处理小红书分享带的额外文字）
    const extracted = extractUrlFromText(input)
    if (extracted) {
      // 如果提取到 URL，使用提取的 URL
      setUrl(extracted)
    } else {
      // 否则保留原始输入（可能用户还在输入中）
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
      // 尝试添加 https:// 前缀
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
    resetForm()
    onClose()
  }, [resetForm, onClose])

  // 提交表单
  const handleSubmit = async () => {
    if (!isValidUrl(url)) {
      setError(t('invalidUrl'))
      return
    }

    // 验证是否为小红书链接
    if (!isXiaohongshuUrl(url)) {
      setError(t('onlyXiaohongshu'))
      return
    }

    setIsSubmitting(true)
    setError(null)

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
        // API 返回错误码，使用翻译器获取本地化消息
        const errorCode = data.code || data.error
        const translatedError = errorCode ? tApiError(errorCode) : t('submitError')
        throw new Error(translatedError)
      }

      const data = await response.json()
      setSuccess(true)
      // 使用 POST 返回的新记录立即更新当前线路，避免再读到缓存中的旧列表。
      if (data.beta) onSuccess?.(data.beta as BetaLink)
      // 提交成功后缓存昵称和身体数据
      if (nickname.trim()) localStorage.setItem('beta_nickname', nickname.trim())
      updateBodyData({ height, reach })
      setTimeout(() => {
        handleClose()
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('submitError'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Drawer
      isOpen={isOpen}
      onClose={handleClose}
      height="half"
      title={t('shareTitle', { name: routeName })}
      showCloseButton
    >
      <div className="px-4 pb-4 space-y-4">
        {/* 未登录提示 */}
        {!isLoggedIn && (
          <div
            className="flex flex-col items-center gap-4 py-8 animate-fade-in"
          >
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--theme-primary) 15%, var(--theme-surface))',
              }}
            >
              <LogIn className="w-7 h-7" style={{ color: 'var(--theme-primary)' }} />
            </div>
            <div className="text-center space-y-1">
              <p
                className="text-base font-medium"
                style={{ color: 'var(--theme-on-surface)' }}
              >
                {tAuth('loginRequired')}
              </p>
              <p
                className="text-sm"
                style={{ color: 'var(--theme-on-surface-variant)' }}
              >
                {t('loginToShare')}
              </p>
            </div>
            <Link
              href={`/login?callbackURL=${encodeURIComponent(pathname)}`}
              className="px-8 py-3 text-sm font-medium transition-all active:scale-[0.98]"
              style={{
                backgroundColor: 'var(--theme-primary)',
                color: 'var(--theme-on-primary)',
                borderRadius: 'var(--theme-radius-xl)',
              }}
              onClick={handleClose}
            >
              {tAuth('loginOrRegister')}
            </Link>
          </div>
        )}

        {/* 已登录：显示表单 */}
        {isLoggedIn && success && (
          <div
            className="flex items-center gap-3 p-4 animate-fade-in-up"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--theme-success) 15%, var(--theme-surface))',
              borderRadius: 'var(--theme-radius-xl)',
              border: '1px solid var(--theme-success)',
            }}
          >
            <Check className="w-5 h-5" style={{ color: 'var(--theme-success)' }} />
            <span style={{ color: 'var(--theme-success)' }}>{t('submitSuccess')}</span>
          </div>
        )}

        {/* 错误提示 */}
        {isLoggedIn && error && (
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
        {isLoggedIn && (<>
        <div>
          <label
            className="text-sm font-medium mb-2 block"
            style={{ color: 'var(--theme-on-surface)' }}
          >
            {t('urlLabel')} <span style={{ color: 'var(--theme-error)' }}>{t('urlRequired')}</span>
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
              placeholder={t('urlPlaceholder')}
              className="w-full pl-10 pr-4 py-3 text-sm outline-none glass-light"
              style={{
                borderRadius: 'var(--theme-radius-lg)',
                color: 'var(--theme-on-surface)',
              }}
              disabled={isSubmitting || success}
            />
          </div>
          {/* 平台检测提示 */}
          {platformInfo && (
            <div
              className="flex items-center gap-2 mt-2 text-xs"
              style={{ color: platformInfo.color }}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: platformInfo.color }}
              />
              {t('urlDetected', { platform: platformInfo.name })}
            </div>
          )}
        </div>

        {/* 昵称（可选） */}
        <div>
          <label
            className="text-sm font-medium mb-2 block"
            style={{ color: 'var(--theme-on-surface)' }}
          >
            {t('nicknameLabel')} <span className="text-xs font-normal" style={{ color: 'var(--theme-on-surface-variant)' }}>{t('nicknameOptional')}</span>
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
              placeholder={t('nicknamePlaceholder')}
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
            {t('bodyDataLabel')} <span className="text-xs font-normal" style={{ color: 'var(--theme-on-surface-variant)' }}>{t('bodyDataOptional')}</span>
          </label>
          <div className="flex gap-3">
            {/* 身高 */}
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
                placeholder={t('heightPlaceholder')}
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
            {/* 臂长 */}
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
                placeholder={t('reachPlaceholder')}
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
            {t('bodyDataHint')}
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
          {isSubmitting ? t('submitting') : success ? t('submitted') : t('submit')}
        </button>
        </>)}
      </div>
    </Drawer>
  )
}
