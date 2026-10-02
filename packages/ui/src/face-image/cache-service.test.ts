import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FaceImageCacheService } from './cache-service'
import type { Route } from '@bloctop/shared/types'

describe('FaceImageCacheService', () => {
  let cache: FaceImageCacheService

  beforeEach(() => {
    cache = new FaceImageCacheService()
  })

  describe('getFaceKey', () => {
    it('应该从 FaceImageSource 生成 key', () => {
      const key = FaceImageCacheService.getFaceKey({
        cragId: 'yuan-tong-si',
        area: '左侧',
        faceId: 'face-1',
      })
      expect(key).toBe('yuan-tong-si/左侧/face-1')
    })

    it('应该从 Route (有 faceId) 生成 key', () => {
      const route = {
        id: 1,
        cragId: 'yuan-tong-si',
        name: '月光',
        area: '左侧',
        faceId: 'face-1',
        grade: 'V3',
      } as Route
      const key = FaceImageCacheService.getFaceKey(route)
      expect(key).toBe('yuan-tong-si/左侧/face-1')
    })

    it('应该从 Route (无 faceId) 回退到线路名称', () => {
      const route = {
        id: 1,
        cragId: 'yuan-tong-si',
        name: '月光',
        grade: 'V3',
      } as Route
      const key = FaceImageCacheService.getFaceKey(route)
      expect(key).toBe('yuan-tong-si/月光')
    })

    it('Route 无 area 时也应回退到线路名称', () => {
      const route = {
        id: 1,
        cragId: 'c1',
        name: 'r1',
        faceId: 'f1',
        grade: 'V0',
      } as Route
      const key = FaceImageCacheService.getFaceKey(route)
      expect(key).toBe('c1/r1')
    })
  })

  describe('getImageUrl', () => {
    it('first annotation cross-area URL and cache identity invalidate together, without changing the other same-named face', () => {
      const route: Route = { id: 1, cragId: 'c1', name: 'route', grade: 'V1', area: 'A', faceId: 'wrong', faceArea: 'A',
        topoAnnotations: [{ area: 'B', faceId: 'wall', topoLine: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }] }
      const other = { cragId: 'c1', area: 'A', faceId: 'wall' }
      const before = cache.getImageUrl(other)
      expect(FaceImageCacheService.getFaceKey(route)).toBe('c1/B/wall')
      expect(cache.getImageUrl(route)).toContain('/c1/B/wall.jpg?v=')
      const callback = vi.fn()
      cache.subscribe(FaceImageCacheService.getFaceKey(route)!, callback)
      cache.invalidate('c1/B/wall')
      expect(callback).toHaveBeenCalledOnce()
      expect(cache.getImageUrl(route)).toMatch(/\/c1\/B\/wall.jpg\?t=\d+/)
      expect(cache.getImageUrl(other)).toBe(before)
    })

    it('legacy faceArea is used by both the image URL and precise version key', () => {
      const route: Route = { id: 1, cragId: 'c1', name: 'route', grade: 'V1', area: 'A', faceId: 'wall', faceArea: 'B' }
      expect(FaceImageCacheService.getFaceKey(route)).toBe('c1/B/wall')
      cache.invalidate('c1/B/wall')
      expect(cache.getImageUrl(route)).toMatch(/\/c1\/B\/wall.jpg\?t=\d+/)
    })

    it('正常情况下应返回带 v 参数的 URL', () => {
      const url = cache.getImageUrl({
        cragId: 'c1',
        area: 'a1',
        faceId: 'f1',
      })
      expect(url).toContain('c1')
      expect(url).toContain('f1.jpg')
      expect(url).toMatch(/\?v=/)
    })

    it('invalidate 后应返回带 t 参数的 URL', () => {
      const source = { cragId: 'c1', area: 'a1', faceId: 'f1' }
      const urlBefore = cache.getImageUrl(source)
      expect(urlBefore).toMatch(/\?v=/)

      cache.invalidate('c1/a1/f1')
      const urlAfter = cache.getImageUrl(source)
      expect(urlAfter).toMatch(/\?t=\d+/)
      expect(urlAfter).not.toContain('?v=')
    })

    it('invalidate 不相关 key 时 URL 不应变化', () => {
      const source = { cragId: 'c1', area: 'a1', faceId: 'f1' }
      const urlBefore = cache.getImageUrl(source)

      cache.invalidate('c2/a2/f2')
      const urlAfter = cache.getImageUrl(source)
      expect(urlAfter).toBe(urlBefore)
    })
  })

  describe('invalidate', () => {
    it('应该通知精确订阅者', () => {
      const cb = vi.fn()
      cache.subscribe('c1/a1/f1', cb)

      cache.invalidate('c1/a1/f1')
      expect(cb).toHaveBeenCalledOnce()
    })

    it('应该通知前缀订阅者', () => {
      const cb = vi.fn()
      cache.subscribeByPrefix('c1/', cb)

      cache.invalidate('c1/a1/f1')
      expect(cb).toHaveBeenCalledOnce()
    })

    it('不应通知不匹配的订阅者', () => {
      const exactCb = vi.fn()
      const prefixCb = vi.fn()
      cache.subscribe('c2/a2/f2', exactCb)
      cache.subscribeByPrefix('c2/', prefixCb)

      cache.invalidate('c1/a1/f1')
      expect(exactCb).not.toHaveBeenCalled()
      expect(prefixCb).not.toHaveBeenCalled()
    })

    it('同时通知精确和前缀订阅者', () => {
      const exactCb = vi.fn()
      const prefixCb = vi.fn()
      cache.subscribe('c1/a1/f1', exactCb)
      cache.subscribeByPrefix('c1/', prefixCb)

      cache.invalidate('c1/a1/f1')
      expect(exactCb).toHaveBeenCalledOnce()
      expect(prefixCb).toHaveBeenCalledOnce()
    })
  })

  describe('invalidateByPrefix', () => {
    it('应该使匹配前缀的所有 key 失效', () => {
      const source1 = { cragId: 'c1', area: 'a1', faceId: 'f1' }
      const source2 = { cragId: 'c1', area: 'a2', faceId: 'f2' }

      // 预先 invalidate 个别 key 使其进入 versions Map
      cache.invalidate('c1/a1/f1')
      cache.invalidate('c1/a2/f2')

      const cb1 = vi.fn()
      const cb2 = vi.fn()
      cache.subscribe('c1/a1/f1', cb1)
      cache.subscribe('c1/a2/f2', cb2)

      cache.invalidateByPrefix('c1/')
      expect(cb1).toHaveBeenCalledOnce()
      expect(cb2).toHaveBeenCalledOnce()

      // URL 应该包含新的时间戳
      expect(cache.getImageUrl(source1)).toMatch(/\?t=\d+/)
      expect(cache.getImageUrl(source2)).toMatch(/\?t=\d+/)
    })

    it('不应影响其他 crag 的 key', () => {
      cache.invalidate('c1/a1/f1')
      cache.invalidate('c2/a1/f1')

      const cb = vi.fn()
      cache.subscribe('c2/a1/f1', cb)

      cache.invalidateByPrefix('c1/')
      expect(cb).not.toHaveBeenCalled()
    })
  })

  describe('subscribe', () => {
    it('返回取消订阅函数', () => {
      const cb = vi.fn()
      const unsub = cache.subscribe('c1/a1/f1', cb)

      cache.invalidate('c1/a1/f1')
      expect(cb).toHaveBeenCalledOnce()

      unsub()
      cache.invalidate('c1/a1/f1')
      expect(cb).toHaveBeenCalledOnce() // 不再增加
    })

    it('支持同一 key 多个订阅者', () => {
      const cb1 = vi.fn()
      const cb2 = vi.fn()
      cache.subscribe('c1/a1/f1', cb1)
      cache.subscribe('c1/a1/f1', cb2)

      cache.invalidate('c1/a1/f1')
      expect(cb1).toHaveBeenCalledOnce()
      expect(cb2).toHaveBeenCalledOnce()
    })

    it('取消一个订阅不影响其他订阅', () => {
      const cb1 = vi.fn()
      const cb2 = vi.fn()
      const unsub1 = cache.subscribe('c1/a1/f1', cb1)
      cache.subscribe('c1/a1/f1', cb2)

      unsub1()
      cache.invalidate('c1/a1/f1')
      expect(cb1).not.toHaveBeenCalled()
      expect(cb2).toHaveBeenCalledOnce()
    })
  })

  describe('subscribeByPrefix', () => {
    it('应该响应前缀下的任意 key 失效', () => {
      const cb = vi.fn()
      cache.subscribeByPrefix('c1/', cb)

      cache.invalidate('c1/a1/f1')
      cache.invalidate('c1/a2/f2')
      expect(cb).toHaveBeenCalledTimes(2)
    })

    it('返回取消订阅函数', () => {
      const cb = vi.fn()
      const unsub = cache.subscribeByPrefix('c1/', cb)

      cache.invalidate('c1/a1/f1')
      expect(cb).toHaveBeenCalledOnce()

      unsub()
      cache.invalidate('c1/a2/f2')
      expect(cb).toHaveBeenCalledOnce() // 不再增加
    })

    it('不应响应不匹配前缀的 key', () => {
      const cb = vi.fn()
      cache.subscribeByPrefix('c1/', cb)

      cache.invalidate('c2/a1/f1')
      expect(cb).not.toHaveBeenCalled()
    })

    it('支持多个前缀订阅', () => {
      const cb1 = vi.fn()
      const cb2 = vi.fn()
      cache.subscribeByPrefix('c1/', cb1)
      cache.subscribeByPrefix('c2/', cb2)

      cache.invalidate('c1/a1/f1')
      expect(cb1).toHaveBeenCalledOnce()
      expect(cb2).not.toHaveBeenCalled()

      cache.invalidate('c2/a1/f1')
      expect(cb2).toHaveBeenCalledOnce()
    })

    it('嵌套前缀订阅应同时触发', () => {
      const cragCb = vi.fn()
      const areaCb = vi.fn()
      cache.subscribeByPrefix('c1/', cragCb)
      cache.subscribeByPrefix('c1/a1/', areaCb)

      cache.invalidate('c1/a1/f1')
      expect(cragCb).toHaveBeenCalledOnce()
      expect(areaCb).toHaveBeenCalledOnce()

      // 不同 area 的 key 只触发 crag 级别订阅
      cache.invalidate('c1/a2/f2')
      expect(cragCb).toHaveBeenCalledTimes(2)
      expect(areaCb).toHaveBeenCalledOnce() // 不匹配 c1/a1/ 前缀
    })
  })

  describe('invalidateByPrefix 边缘用例', () => {
    it('无匹配 key 时不通知任何订阅者', () => {
      const prefixCb = vi.fn()
      cache.subscribeByPrefix('c1/', prefixCb)

      // versions 和 subscribers Map 中没有以 c1/ 开头的 key
      cache.invalidateByPrefix('c1/')
      expect(prefixCb).not.toHaveBeenCalled()
    })

    it('invalidate (非 prefix) 总是通知前缀订阅者', () => {
      const prefixCb = vi.fn()
      cache.subscribeByPrefix('c1/', prefixCb)

      // 即使从未 getImageUrl 或 subscribe 过该 key
      cache.invalidate('c1/a1/f1')
      expect(prefixCb).toHaveBeenCalledOnce()
    })
  })

  describe('prefetch', () => {
    it('应该创建 Image 元素并设置 src', () => {
      const instances: Array<{ src: string }> = []
      const OriginalImage = window.Image
      window.Image = class MockImage {
        src = ''
        constructor() { instances.push(this) }
      } as unknown as typeof Image

      cache.prefetch([
        'https://img.bouldering.top/c1/a1/f1.jpg',
        'https://img.bouldering.top/c1/a2/f2.jpg',
      ])

      expect(instances).toHaveLength(2)
      expect(instances[0].src).toBe('https://img.bouldering.top/c1/a1/f1.jpg')
      expect(instances[1].src).toBe('https://img.bouldering.top/c1/a2/f2.jpg')

      window.Image = OriginalImage
    })
  })
})
