import { getTopoImageUrl, getFaceTopoUrl } from '@bloctop/shared/constants'
import type { FaceKey, ImageSource } from './types'
import { getFaceIdentityKey, getPrimaryFaceIdentity } from '@bloctop/shared/face-references'

/**
 * 统一岩面图片缓存服务
 *
 * 职责:
 * 1. 统一的图片 URL 生成 (带版本管理)
 * 2. CRUD 后精确缓存失效 (版本递增 → URL 变化 → 浏览器自动获取新图)
 * 3. 事件订阅 (组件自动响应缓存失效)
 * 4. 图片预加载
 *
 * 与现有缓存层的协同:
 * - SW CacheFirst 负责磁盘级缓存 (r2-images)
 * - 本服务通过 URL 版本号控制缓存命中/失效
 * - 版本变化 → URL 变化 → SW 视为新请求 → 从网络获取
 */
export class FaceImageCacheService {
  /** 版本追踪: faceKey → timestamp (用于 cache busting) */
  private versions = new Map<FaceKey, number>()
  /** 事件订阅: faceKey → 回调集合 */
  private subscribers = new Map<FaceKey, Set<() => void>>()
  /** 前缀订阅: prefix → 回调集合 (用于列表级组件) */
  private prefixSubscribers = new Map<string, Set<() => void>>()

  /**
   * 从 Route 或 FaceImageSource 生成 face key
   * Face key 与 R2 存储路径一致 (不含 .jpg 后缀)
   */
  static getFaceKey(source: ImageSource): FaceKey | null {
    if ('id' in source) {
      // Route 对象
      const face = getPrimaryFaceIdentity(source)
      if (face) return getFaceIdentityKey(face)
      // Legacy: 无 faceId 的线路，使用线路名称
      return `${source.cragId}/${source.name}`
    }
    // FaceImageSource
    return getFaceIdentityKey(source)
  }

  /**
   * 获取图片 URL (带版本管理)
   *
   * 正常情况: 返回 ?v={IMAGE_VERSION} 的 URL
   * 失效后: 返回 ?t={timestamp} 的 URL (绕过所有缓存层)
   */
  getImageUrl(source: ImageSource): string {
    const key = FaceImageCacheService.getFaceKey(source)
    const version = key ? this.versions.get(key) : undefined

    if ('id' in source) {
      return getTopoImageUrl(source, version)
    }
    return getFaceTopoUrl(source.cragId, source.area, source.faceId, version)
  }

  /**
   * 精确失效: 使指定 faceKey 的缓存失效
   *
   * 工作原理:
   * 1. 设置新版本号 (当前时间戳)
   * 2. 通知所有订阅该 faceKey 的组件
   * 3. 组件重新渲染 → getImageUrl 返回带新时间戳的 URL → 缓存失效
   */
  invalidate(faceKey: FaceKey): void {
    this.versions.set(faceKey, Date.now())
    this.notify(faceKey)
  }

  /**
   * 前缀失效: 使所有匹配前缀的缓存失效
   * 常用于岩场级别的批量更新: invalidateByPrefix('yuan-tong-si/')
   *
   * 注意: 只处理已在 versions/subscribers Map 中注册的 key。
   * 若无匹配 key，前缀订阅者也不会被通知。
   * 对于单个 face 的 CRUD，优先使用 invalidate(faceKey)，
   * 它总是通知匹配的前缀订阅者 (通过 notify)。
   */
  invalidateByPrefix(prefix: string): void {
    const timestamp = Date.now()

    // 收集所有匹配的 keys (来自 versions 和 subscribers)
    const keysToInvalidate = new Set<FaceKey>()
    for (const key of this.versions.keys()) {
      if (key.startsWith(prefix)) keysToInvalidate.add(key)
    }
    for (const key of this.subscribers.keys()) {
      if (key.startsWith(prefix)) keysToInvalidate.add(key)
    }

    for (const key of keysToInvalidate) {
      this.versions.set(key, timestamp)
      this.notify(key)
    }
  }

  /**
   * 预加载图片 (预热浏览器 + SW 缓存)
   */
  prefetch(urls: string[]): void {
    if (typeof window === 'undefined') return
    for (const url of urls) {
      const img = new window.Image()
      img.src = url
    }
  }

  /**
   * 订阅 faceKey 的缓存变化事件
   * 返回取消订阅函数
   */
  subscribe(faceKey: FaceKey, callback: () => void): () => void {
    let subs = this.subscribers.get(faceKey)
    if (!subs) {
      subs = new Set()
      this.subscribers.set(faceKey, subs)
    }
    subs.add(callback)

    return () => {
      subs.delete(callback)
      if (subs.size === 0) this.subscribers.delete(faceKey)
    }
  }

  /**
   * 前缀订阅: 当任意匹配 prefix 的 faceKey 失效时触发回调
   *
   * 用于列表级组件 (如 FaceThumbnailStrip), 监听某个岩场下所有岩面的变化
   * @example cache.subscribeByPrefix('yuan-tong-si/', () => forceRerender())
   */
  subscribeByPrefix(prefix: string, callback: () => void): () => void {
    let subs = this.prefixSubscribers.get(prefix)
    if (!subs) {
      subs = new Set()
      this.prefixSubscribers.set(prefix, subs)
    }
    subs.add(callback)

    return () => {
      subs.delete(callback)
      if (subs.size === 0) this.prefixSubscribers.delete(prefix)
    }
  }

  private notify(faceKey: FaceKey): void {
    // 精确匹配订阅者
    const subs = this.subscribers.get(faceKey)
    if (subs) {
      for (const cb of subs) cb()
    }
    // 前缀匹配订阅者
    for (const [prefix, prefixSubs] of this.prefixSubscribers) {
      if (faceKey.startsWith(prefix)) {
        for (const cb of prefixSubs) cb()
      }
    }
  }
}
