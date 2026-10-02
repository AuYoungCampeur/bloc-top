'use client'

import { useEffect, useCallback, useRef } from 'react'
import { useRouter, usePathname } from '@/i18n/navigation'
import { useLocale } from 'next-intl'
import type { Locale } from '@/i18n/routing'

/**
 * 语言偏好缓存 key
 * 存储在 localStorage 中，永久保存
 */
const LOCALE_CACHE_KEY = 'preferred-locale'

/**
 * 标记是否已完成首次语言检测
 * 存储在 sessionStorage 中，避免每次导航都触发检测
 */
const LOCALE_DETECTED_KEY = 'locale-detected'

/**
 * 获取缓存的语言偏好
 */
function getCachedLocale(): Locale | null {
  if (typeof window === 'undefined') return null
  try {
    const cached = localStorage.getItem(LOCALE_CACHE_KEY)
    if (cached === 'zh' || cached === 'en' || cached === 'fr') return cached
  } catch { /* Storage preferences are optional. */ }
  return null
}

/**
 * 设置语言偏好缓存
 */
function setCachedLocale(locale: Locale): void {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(LOCALE_CACHE_KEY, locale) } catch { /* Continue navigation without persistence. */ }
}

/**
 * 检查是否已在本次会话中完成检测
 */
function isDetected(): boolean {
  if (typeof window === 'undefined') return false
  try { return sessionStorage.getItem(LOCALE_DETECTED_KEY) === 'true' } catch { return false }
}

/**
 * 标记本次会话已完成检测
 */
function markDetected(): void {
  if (typeof window === 'undefined') return
  try { sessionStorage.setItem(LOCALE_DETECTED_KEY, 'true') } catch { /* Detection still works for this mount. */ }
}

/**
 * 根据 IP 检测推荐语言
 * 中国 IP 返回 'zh'，其他返回 'en'
 */
async function detectLocaleByIP(): Promise<Locale> {
  try {
    const response = await fetch('/api/geo')
    if (!response.ok) {
      return 'en' // 检测失败默认英文（国际用户）
    }

    const data = await response.json()
    // 如果有 province 字段说明是中国 IP（高德只返回中国地区数据）
    // 或检查 detected 为 true 也说明是中国
    const isChina = !!(data.province || data.detected)
    return isChina ? 'zh' : 'en'
  } catch {
    return 'en' // 网络错误默认英文
  }
}

/**
 * 语言偏好管理 Hook
 *
 * 实现逻辑:
 * 1. 首次访问：检查 localStorage 缓存
 *    - 有缓存：使用缓存的语言
 *    - 无缓存：调用 /api/geo 检测 IP 位置
 *      - 中国 IP：使用中文
 *      - 其他地区：使用英文
 * 2. 用户切换语言：更新 localStorage 缓存
 * 3. 后续访问：直接使用缓存
 */
export function useLocalePreference() {
  const currentLocale = useLocale() as Locale
  const router = useRouter()
  const pathname = usePathname()
  const detectingRef = useRef(false)
  const hrefWithQuery = useCallback(() => `${pathname}${window.location.search}${window.location.hash}`, [pathname])

  /**
   * 切换语言并更新缓存
   */
  const switchLocale = useCallback((newLocale: Locale) => {
    setCachedLocale(newLocale)
    router.replace(hrefWithQuery(), { locale: newLocale })
  }, [router, hrefWithQuery])

  /**
   * 首次加载时检测语言偏好
   */
  useEffect(() => {
    // 已经在本次会话中检测过，跳过
    if (isDetected()) {
      return
    }

    // A cold offline navigation must keep its cached shell and local detail parameters.
    if (!navigator.onLine) { markDetected(); return }

    // 检查缓存
    const cachedLocale = getCachedLocale()

    if (cachedLocale) {
      // 有缓存，使用缓存的语言
      markDetected()
      if (cachedLocale !== currentLocale) {
        router.replace(hrefWithQuery(), { locale: cachedLocale })
      }
      return
    }

    // 防止重复检测
    if (detectingRef.current) {
      return
    }
    detectingRef.current = true

    // 无缓存，需要通过 IP 检测
    let active = true
    detectLocaleByIP().then((detectedLocale) => {
      if (!active || !navigator.onLine) return
      markDetected()
      setCachedLocale(detectedLocale)
      if (detectedLocale !== currentLocale) {
        router.replace(hrefWithQuery(), { locale: detectedLocale })
      }
    }).finally(() => { if (active) detectingRef.current = false })
    return () => { active = false; detectingRef.current = false }
  }, [currentLocale, router, hrefWithQuery])

  return {
    /** 当前语言 */
    locale: currentLocale,
    /** 切换语言（会更新缓存） */
    switchLocale,
    /** 获取缓存的语言偏好 */
    getCachedLocale,
    /** 手动设置缓存（不会触发导航） */
    setCachedLocale,
  }
}
