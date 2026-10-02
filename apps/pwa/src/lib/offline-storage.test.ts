/**
 * 离线存储层单元测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import type { Crag, Route } from '@/types'
import { getCragCoverUrl } from '@/lib/constants'
import {
  openDB,
  saveCragOffline,
  getCragOffline,
  getAllOfflineCrags,
  deleteCragOffline,
  isOfflineAvailable,
  getMeta,
  clearMeta,
  collectImageUrls,
  generateVersion,
  closeDB,
  getOfflineRouteById,
  META_STORAGE_KEY,
  type OfflineCragData,
} from './offline-storage'

// 测试数据
const mockCrag: Crag = {
  id: 'test-crag',
  name: '测试岩场',
  cityId: 'luoyuan',
  location: '测试位置',
  developmentTime: '2024',
  description: '测试描述',
  approach: '测试接近方式',
  coverImages: ['https://example.com/cover1.jpg', 'https://example.com/cover2.jpg'],
}

const mockRoutes: Route[] = [
  {
    id: 1,
    name: '线路1',
    grade: 'V3',
    cragId: 'test-crag',
    area: '区域A',
    image: 'https://example.com/route1.jpg',
  },
  {
    id: 2,
    name: '线路2',
    grade: 'V5',
    cragId: 'test-crag',
    area: '区域B',
    image: 'https://example.com/route2.jpg',
  },
  {
    id: 3,
    name: '线路3 (无图)',
    grade: 'V2',
    cragId: 'test-crag',
    area: '区域A',
    // 没有 image
  },
]

const mockOfflineData: OfflineCragData = {
  cragId: 'test-crag',
  crag: mockCrag,
  routes: mockRoutes,
  downloadedAt: '2024-01-01T00:00:00.000Z',
  version: 'test-crag-2024-01-01',
  imageCount: 4,
}

describe('offline-storage', () => {
  beforeEach(() => {
    // 清理 localStorage
    localStorage.clear()
    // 重置数据库连接
    closeDB()
  })

  afterEach(() => {
    // 清理
    closeDB()
    localStorage.clear()
  })

  // ==================== IndexedDB 操作测试 ====================

  describe('IndexedDB operations', () => {
    it('openDB should create database and object store', async () => {
      const db = await openDB()
      expect(db.name).toBe('offline-crags')
      expect(db.objectStoreNames.contains('crags')).toBe(true)
    })

    it('openDB should return same instance on multiple calls', async () => {
      const db1 = await openDB()
      const db2 = await openDB()
      expect(db1).toBe(db2)
    })

    it('saveCragOffline should save data to IndexedDB', async () => {
      await saveCragOffline(mockOfflineData)

      const retrieved = await getCragOffline('test-crag')
      expect(retrieved).not.toBeNull()
      expect(retrieved?.cragId).toBe('test-crag')
      expect(retrieved?.crag.name).toBe('测试岩场')
      expect(retrieved?.routes.length).toBe(3)
    })

    it('saveCragOffline should update metadata in localStorage', async () => {
      await saveCragOffline(mockOfflineData)

      const meta = getMeta()
      expect(meta.crags['test-crag']).toBeDefined()
      expect(meta.crags['test-crag'].cragName).toBe('测试岩场')
      expect(meta.crags['test-crag'].routeCount).toBe(3)
    })

    it('does not publish a successful request if its transaction subsequently aborts', async () => {
      await saveCragOffline(mockOfflineData)
      const db = await openDB()
      const original = db.transaction.bind(db)
      const spy = vi.spyOn(db, 'transaction').mockImplementation((...args: Parameters<IDBDatabase['transaction']>) => {
        const tx = original(...args)
        if (args[1] === 'readwrite') {
          const store = tx.objectStore('crags')
          const put = store.put.bind(store)
          vi.spyOn(store, 'put').mockImplementation((...putArgs: Parameters<IDBObjectStore['put']>) => {
            const request = put(...putArgs)
            request.addEventListener('success', () => tx.abort())
            return request
          })
          vi.spyOn(tx, 'objectStore').mockReturnValue(store)
        }
        return tx
      })
      await expect(saveCragOffline({ ...mockOfflineData, version: 'failed-update' })).rejects.toThrow('aborted')
      spy.mockRestore()
      expect((await getCragOffline('test-crag'))?.version).toBe(mockOfflineData.version)
      expect(getMeta().crags['test-crag'].downloadedAt).toBe(mockOfflineData.downloadedAt)
    })

    it('getCragOffline should return null for non-existent crag', async () => {
      const result = await getCragOffline('non-existent')
      expect(result).toBeNull()
    })

    it('getAllOfflineCrags should return all saved crags', async () => {
      await saveCragOffline(mockOfflineData)
      await saveCragOffline({
        ...mockOfflineData,
        cragId: 'test-crag-2',
        crag: { ...mockCrag, id: 'test-crag-2', name: '测试岩场2' },
      })

      const all = await getAllOfflineCrags()
      expect(all.length).toBe(2)
    })

    it('deleteCragOffline should remove data from IndexedDB', async () => {
      await saveCragOffline(mockOfflineData)
      await deleteCragOffline('test-crag')

      const result = await getCragOffline('test-crag')
      expect(result).toBeNull()
    })

    it('deleteCragOffline should remove metadata from localStorage', async () => {
      await saveCragOffline(mockOfflineData)
      await deleteCragOffline('test-crag')

      const meta = getMeta()
      expect(meta.crags['test-crag']).toBeUndefined()
    })
  })

  // ==================== localStorage 元数据测试 ====================

  describe('localStorage metadata operations', () => {
    it('getMeta should return empty object when no data', () => {
      const meta = getMeta()
      expect(meta.crags).toEqual({})
      expect(meta.lastUpdated).toBe('')
    })

    it('getMeta should return stored metadata', () => {
      const testMeta = {
        crags: {
          'test-crag': {
            cragName: '测试',
            routeCount: 5,
            downloadedAt: '2024-01-01',
            imageCount: 10,
          },
        },
        lastUpdated: '2024-01-01',
      }
      localStorage.setItem(META_STORAGE_KEY, JSON.stringify(testMeta))

      const meta = getMeta()
      expect(meta.crags['test-crag'].cragName).toBe('测试')
    })

    it('getMeta should handle malformed JSON gracefully', () => {
      localStorage.setItem(META_STORAGE_KEY, 'invalid json')
      const meta = getMeta()
      expect(meta.crags).toEqual({})
    })

    it('clearMeta should remove all metadata', async () => {
      await saveCragOffline(mockOfflineData)
      clearMeta()

      const meta = getMeta()
      expect(meta.crags).toEqual({})
    })

    it('isOfflineAvailable should return true for downloaded crag', async () => {
      await saveCragOffline(mockOfflineData)
      expect(isOfflineAvailable('test-crag')).toBe(true)
    })

    it('isOfflineAvailable should return false for non-downloaded crag', () => {
      expect(isOfflineAvailable('non-existent')).toBe(false)
    })
  })

  // ==================== 图片收集测试 ====================

  describe('collectImageUrls', () => {
    it('should collect cover images and generate TOPO URLs for all routes', () => {
      const urls = collectImageUrls(mockCrag, mockRoutes)

      // 封面图片
      expect(urls).toContain(getCragCoverUrl('test-crag', 0))
      expect(urls).toContain(getCragCoverUrl('test-crag', 1))

      // 线路 TOPO 图 - 所有线路都会生成 URL（使用 getRouteTopoUrl）
      // 格式: https://img.bouldering.top/{cragId}/{routeName}.jpg?v=1
      expect(urls.some((u) => u.includes('test-crag') && u.includes(encodeURIComponent('线路1')))).toBe(true)
      expect(urls.some((u) => u.includes('test-crag') && u.includes(encodeURIComponent('线路2')))).toBe(true)
      expect(urls.some((u) => u.includes('test-crag') && u.includes(encodeURIComponent('线路3 (无图)')))).toBe(true)

      expect(urls.length).toBe(5) // 2 covers + 3 route TOPO URLs (all routes get a URL)
    })

    it('should handle crag without cover images', () => {
      const cragWithoutCover = { ...mockCrag, coverImages: undefined }
      const urls = collectImageUrls(cragWithoutCover, mockRoutes)

      expect(urls.length).toBe(3) // Only route TOPO URLs
    })

    it('should generate TOPO URL for every route', () => {
      // 即使 route.image 是 undefined，也会生成 TOPO URL
      const routesWithoutImageField: Route[] = mockRoutes.map((r) => ({
        ...r,
        image: undefined,
      }))
      const urls = collectImageUrls(mockCrag, routesWithoutImageField)

      // 2 covers + 3 route TOPO URLs
      expect(urls.length).toBe(5)
    })

    it('should handle empty routes array', () => {
      const urls = collectImageUrls(mockCrag, [])
      expect(urls.length).toBe(2) // Only cover images
    })
  })

  // ==================== getOfflineRouteById 测试 ====================

  describe('getOfflineRouteById', () => {
    it('should find route in downloaded crag data', async () => {
      await saveCragOffline(mockOfflineData)

      const result = await getOfflineRouteById(1)

      expect(result).not.toBeNull()
      expect(result?.route.id).toBe(1)
      expect(result?.route.name).toBe('线路1')
      expect(result?.crag.id).toBe('test-crag')
    })

    it('should return null for non-existent route', async () => {
      await saveCragOffline(mockOfflineData)

      const result = await getOfflineRouteById(999)

      expect(result).toBeNull()
    })

    it('should return null when no offline data exists', async () => {
      // 确保数据库是空的 - 删除可能存在的数据
      const existingCrags = await getAllOfflineCrags()
      for (const crag of existingCrags) {
        await deleteCragOffline(crag.cragId)
      }

      const result = await getOfflineRouteById(1)

      expect(result).toBeNull()
    })

    it('should find route across multiple crags', async () => {
      // 保存第一个岩场
      await saveCragOffline(mockOfflineData)

      // 保存第二个岩场，包含不同的线路
      const secondCragData: OfflineCragData = {
        cragId: 'test-crag-2',
        crag: { ...mockCrag, id: 'test-crag-2', name: '测试岩场2' },
        routes: [
          {
            id: 100,
            name: '线路100',
            grade: 'V4',
            cragId: 'test-crag-2',
            area: '区域C',
          },
        ],
        downloadedAt: '2024-01-02T00:00:00.000Z',
        version: 'test-crag-2-2024-01-02',
        imageCount: 1,
      }
      await saveCragOffline(secondCragData)

      // 查找第二个岩场的线路
      const result = await getOfflineRouteById(100)

      expect(result).not.toBeNull()
      expect(result?.route.name).toBe('线路100')
      expect(result?.crag.name).toBe('测试岩场2')
    })
  })

  // ==================== 工具函数测试 ====================

  describe('generateVersion', () => {
    it('should generate version with cragId and date', () => {
      const version = generateVersion('test-crag')

      expect(version).toMatch(/^test-crag-\d{4}-\d{2}-\d{2}$/)
    })

    it('should generate same date for same day', () => {
      const version1 = generateVersion('crag1')
      const version2 = generateVersion('crag2')

      // 版本格式: cragId-YYYY-MM-DD
      // 提取日期部分 (最后三段)
      const date1 = version1.split('-').slice(-3).join('-')
      const date2 = version2.split('-').slice(-3).join('-')
      expect(date1).toBe(date2)
    })
  })
})
