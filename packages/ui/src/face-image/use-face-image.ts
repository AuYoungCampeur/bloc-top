'use client'

import { useState, useEffect, useCallback, useContext, useRef } from 'react'
import { FaceImageCacheContext } from './face-image-provider'
import { FaceImageCacheService } from './cache-service'
import type { ImageSource, FaceImageStatus, UseFaceImageResult } from './types'

/**
 * 统一的岩面图片 Hook
 *
 * 替代各组件中分散的 imageLoading/imageError 状态管理,
 * 提供统一的加载状态 + 自动响应 CRUD 缓存失效
 *
 * @example
 * // 使用 Route 对象 (最常见)
 * const { src, isLoading, isError, onLoad, onError } = useFaceImage(route)
 *
 * @example
 * // 使用 FaceImageSource (缩略图等场景)
 * const { src, isLoading, isError, onLoad, onError } = useFaceImage({ cragId, area, faceId })
 *
 * @example
 * // 配合 Next.js Image
 * <Image src={src!} onLoad={onLoad} onError={onError} />
 *
 * @example
 * // 配合原生 img
 * <img src={src!} onLoad={onLoad} onError={onError} />
 */
export function useFaceImage(source: ImageSource | null, mediaRevision?: string): UseFaceImageResult {
  const cache = useContext(FaceImageCacheContext)
  const [status, setStatus] = useState<FaceImageStatus>('idle')
  // 递增值用于强制 re-render (缓存失效时触发)
  const [, setRenderKey] = useState(0)
  const prevSrcRef = useRef<string | null>(null)

  // 计算 face key
  const faceKey = source ? FaceImageCacheService.getFaceKey(source) : null

  // 计算图片 URL (每次 render 从 cache service 获取最新版本号)
  const src = source ? cache.getImageUrl(source, mediaRevision) : null

  // URL 变化时重置加载状态 (渲染期间调整状态，非 effect)
  // See: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  if (src !== prevSrcRef.current) {
    prevSrcRef.current = src
    const nextStatus = src ? 'loading' : 'idle'
    if (status !== nextStatus) {
      setStatus(nextStatus)
    }
  }

  // 订阅缓存失效事件
  useEffect(() => {
    if (!faceKey) return

    return cache.subscribe(faceKey, () => {
      // 强制 re-render → src 重新计算 → URL 带新版本号
      setRenderKey(k => k + 1)
      setStatus('loading')
    })
  }, [faceKey, cache])

  const onLoad = useCallback(() => {
    if (prevSrcRef.current === src) setStatus('loaded')
  }, [src])
  const onError = useCallback(() => {
    if (prevSrcRef.current === src) setStatus('error')
  }, [src])
  const retry = useCallback(() => {
    setRenderKey(k => k + 1)
    setStatus('loading')
  }, [])

  return {
    src,
    status,
    isLoading: status === 'loading',
    isError: status === 'error',
    onLoad,
    onError,
    retry,
  }
}

/**
 * 获取缓存服务实例 (用于 URL 生成和 CRUD 后失效缓存)
 *
 * 始终返回可用实例 (非 null), 即使没有 Provider 也有 fallback
 *
 * @example
 * const cache = useFaceImageCache()
 * // URL 生成
 * cache.getImageUrl({ cragId, area, faceId })
 * // CRUD 后失效
 * cache.invalidate(`${cragId}/${area}/${faceId}`)
 */
export function useFaceImageCache(): FaceImageCacheService {
  return useContext(FaceImageCacheContext)
}
