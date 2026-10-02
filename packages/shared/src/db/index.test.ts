/**
 * 数据访问层 (db/index.ts) 单元测试
 *
 * 覆盖: Crag / Route / City / Prefecture / CragPermission CRUD
 * 策略: mock getDatabase() 返回链式 MongoDB collection 方法
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- MongoDB mock ----
const mockInsertOne = vi.fn()
const mockFindOne = vi.fn()
const mockFindOneAndUpdate = vi.fn()
const mockDeleteOne = vi.fn()
const mockDeleteMany = vi.fn()
const mockUpdateOne = vi.fn()
const mockCountDocuments = vi.fn()
const mockCreateIndex = vi.fn()
const mockToArray = vi.fn()

const mockSort = vi.fn(() => ({ toArray: mockToArray, limit: vi.fn(() => ({ toArray: mockToArray })) }))
const mockLimit = vi.fn(() => ({ toArray: mockToArray }))
const mockFind = vi.fn(() => ({ sort: mockSort, toArray: mockToArray, limit: mockLimit }))

const mockCollection = vi.fn(() => ({
  find: mockFind,
  findOne: mockFindOne,
  insertOne: mockInsertOne,
  findOneAndUpdate: mockFindOneAndUpdate,
  deleteOne: mockDeleteOne,
  deleteMany: mockDeleteMany,
  updateOne: mockUpdateOne,
  countDocuments: mockCountDocuments,
  createIndex: mockCreateIndex,
}))

const mockDb = { collection: mockCollection }

vi.mock('../mongodb', () => ({
  getDatabase: vi.fn(() => Promise.resolve(mockDb)),
}))

vi.mock('../logger', () => ({
  createModuleLogger: () => ({
    info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
  }),
}))

// Need to mock react cache as passthrough for tests
vi.mock('react', async () => {
  const actual = await vi.importActual('react')
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return { ...actual, cache: (fn: Function) => fn }
})

import {
  getAllCrags,
  getCragById,
  getCragsByCityId,
  createCrag,
  updateCrag,
  getAllRoutes,
  getRouteById,
  getRoutesByCragId,
  getRouteCountByCragId,
  createRoute,
  updateRoute,
  deleteRoute,
  updateCragAreas,
  createFeedback,
  recordVisit,
  getVisitStats,
  getAllCities,
  getAllPrefectures,
  createCity,
  updateCity,
  deleteCity,
  createPrefecture,
  updatePrefecture,
  deletePrefecture,
  getCragPermission,
  getCragPermissionsByCragId,
  getCragPermissionsByUserId,
  createCragPermission,
  deleteCragPermission,
  ensureCragPermissionIndexes,
} from './index'

beforeEach(() => {
  vi.clearAllMocks()
  // Reset chain mocks
  mockCollection.mockReturnValue({
    find: mockFind,
    findOne: mockFindOne,
    insertOne: mockInsertOne,
    findOneAndUpdate: mockFindOneAndUpdate,
    deleteOne: mockDeleteOne,
    deleteMany: mockDeleteMany,
    updateOne: mockUpdateOne,
    countDocuments: mockCountDocuments,
    createIndex: mockCreateIndex,
  })
  mockFind.mockReturnValue({ sort: mockSort, toArray: mockToArray, limit: mockLimit })
  mockSort.mockReturnValue({ toArray: mockToArray, limit: vi.fn(() => ({ toArray: mockToArray })) })
})

// ============ Crag ============

describe('Crag operations', () => {
  const CRAG_DOC = { _id: 'yuan-tong-si', name: '源通寺', cityId: 'luoyuan', createdAt: new Date(), updatedAt: new Date() }

  it('getAllCrags should return crags with id mapped from _id', async () => {
    mockToArray.mockResolvedValue([CRAG_DOC])
    const crags = await getAllCrags()
    expect(mockCollection).toHaveBeenCalledWith('crags')
    expect(crags).toHaveLength(1)
    expect(crags[0].id).toBe('yuan-tong-si')
    expect(crags[0].name).toBe('源通寺')
    expect((crags[0] as unknown as Record<string, unknown>)._id).toBeUndefined()
  })

  it('getCragById should return crag when found', async () => {
    mockFindOne.mockResolvedValue(CRAG_DOC)
    const crag = await getCragById('yuan-tong-si')
    expect(crag).not.toBeNull()
    expect(crag!.id).toBe('yuan-tong-si')
  })

  it('getCragById should return null when not found', async () => {
    mockFindOne.mockResolvedValue(null)
    const crag = await getCragById('nonexistent')
    expect(crag).toBeNull()
  })

  it('getCragsByCityId should filter by cityId', async () => {
    mockToArray.mockResolvedValue([CRAG_DOC])
    const crags = await getCragsByCityId('luoyuan')
    expect(mockFind).toHaveBeenCalledWith({ cityId: 'luoyuan' })
    expect(crags).toHaveLength(1)
  })

  it('createCrag should throw when ID already exists', async () => {
    mockFindOne.mockResolvedValue(CRAG_DOC)
    await expect(
      createCrag({ id: 'yuan-tong-si', name: '源通寺', cityId: 'luoyuan', location: '', developmentTime: '', description: '', approach: '' })
    ).rejects.toThrow('岩场 ID "yuan-tong-si" 已存在')
  })

  it('createCrag should insert and return crag', async () => {
    mockFindOne.mockResolvedValue(null)
    mockInsertOne.mockResolvedValue({ insertedId: 'new-crag' })
    const crag = await createCrag({ id: 'new-crag', name: '新岩场', cityId: 'city1', location: '某地', developmentTime: '2024', description: '描述', approach: '方法' })
    expect(crag.id).toBe('new-crag')
    expect(crag.name).toBe('新岩场')
    expect(mockInsertOne).toHaveBeenCalled()
  })

  it('updateCrag should return updated crag', async () => {
    const updatedDoc = { ...CRAG_DOC, name: '新名字' }
    mockFindOneAndUpdate.mockResolvedValue(updatedDoc)
    const crag = await updateCrag('yuan-tong-si', { name: '新名字' })
    expect(crag).not.toBeNull()
    expect(crag!.name).toBe('新名字')
  })

  it('updateCrag should return null when crag not found', async () => {
    mockFindOneAndUpdate.mockResolvedValue(null)
    const crag = await updateCrag('nonexistent', { name: 'x' })
    expect(crag).toBeNull()
  })

  it('updateCragAreas should update and return areas', async () => {
    mockFindOneAndUpdate.mockResolvedValue({ areas: ['区域A', '区域B'] })
    const areas = await updateCragAreas('yuan-tong-si', ['区域A', '区域B'])
    expect(areas).toEqual(['区域A', '区域B'])
  })
})

// ============ Route ============

describe('Route operations', () => {
  const ROUTE_DOC = { _id: 42, name: '线路A', grade: 'V3', cragId: 'crag-1', area: '区域1', createdAt: new Date(), updatedAt: new Date() }

  it('getAllRoutes should return routes with id mapped from _id', async () => {
    mockToArray.mockResolvedValue([ROUTE_DOC])
    const routes = await getAllRoutes()
    expect(mockCollection).toHaveBeenCalledWith('routes')
    expect(routes[0].id).toBe(42)
    expect((routes[0] as unknown as Record<string, unknown>)._id).toBeUndefined()
  })

  it('getRouteById should return route when found', async () => {
    mockFindOne.mockResolvedValue(ROUTE_DOC)
    const route = await getRouteById(42)
    expect(route).not.toBeNull()
    expect(route!.id).toBe(42)
  })

  it('getRouteById should return null when not found', async () => {
    mockFindOne.mockResolvedValue(null)
    expect(await getRouteById(999)).toBeNull()
  })

  it('getRoutesByCragId should filter by cragId', async () => {
    mockToArray.mockResolvedValue([ROUTE_DOC])
    const routes = await getRoutesByCragId('crag-1')
    expect(mockFind).toHaveBeenCalledWith({ cragId: 'crag-1' })
    expect(routes).toHaveLength(1)
  })

  it('getRouteCountByCragId should return count', async () => {
    mockCountDocuments.mockResolvedValue(5)
    const count = await getRouteCountByCragId('crag-1')
    expect(count).toBe(5)
    expect(mockCountDocuments).toHaveBeenCalledWith({ cragId: 'crag-1' })
  })

  it('createRoute should auto-increment id', async () => {
    mockFindOne.mockResolvedValue(null)
    mockFindOneAndUpdate.mockResolvedValue({ _id: 'route-id', seq: 101 })
    mockToArray.mockResolvedValue([{ _id: 100 }])
    mockInsertOne.mockResolvedValue({ insertedId: 101 })
    const route = await createRoute({ name: '新线路', grade: 'V5', cragId: 'crag-1', area: '区域1' })
    expect(route.id).toBe(101)
    expect(route.topoVersion).toBe(0)
    expect(mockInsertOne).toHaveBeenLastCalledWith(expect.objectContaining({ _id: 101, topoVersion: 0 }))
  })

  it('createRoute should use id 1 when collection is empty', async () => {
    mockFindOne.mockResolvedValue(null)
    mockFindOneAndUpdate.mockResolvedValue({ _id: 'route-id', seq: 1 })
    mockToArray.mockResolvedValue([])
    mockInsertOne.mockResolvedValue({ insertedId: 1 })
    const route = await createRoute({ name: '首条线路', grade: 'V0', cragId: 'crag-1', area: '区域1' })
    expect(route.id).toBe(1)
  })

  it('updateRoute should return updated route', async () => {
    const updatedDoc = { ...ROUTE_DOC, grade: 'V5' }
    mockFindOneAndUpdate.mockResolvedValue(updatedDoc)
    const route = await updateRoute(42, { grade: 'V5' })
    expect(route).not.toBeNull()
    expect(route!.grade).toBe('V5')
  })

  it('updateRoute should return null when not found', async () => {
    mockFindOneAndUpdate.mockResolvedValue(null)
    expect(await updateRoute(999, { grade: 'V5' })).toBeNull()
  })

  it('updateRoute truly unsets all compatibility fields for an empty annotation array', async () => {
    mockFindOne.mockResolvedValue({ ...ROUTE_DOC, faceId: 'wall', faceArea: 'A', topoLine: [{ x: 0, y: 0 }, { x: 1, y: 1 }], topoTension: 0.5 })
    mockFindOneAndUpdate.mockResolvedValue({ ...ROUTE_DOC, topoAnnotations: [], topoVersion: 1 })
    await updateRoute(42, { topoAnnotations: [] }, { expectedTopoVersion: 0 })
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({ _id: 42, topoVersion: { $exists: false } }), {
      $set: { topoAnnotations: [], updatedAt: expect.any(Date) },
      $unset: { faceId: '', faceArea: '', topoLine: '', topoTension: '' },
      $inc: { topoVersion: 1 },
    }, { returnDocument: 'after' })
  })

  it('deleteRoute should return true when deleted', async () => {
    mockDeleteOne.mockResolvedValue({ deletedCount: 1 })
    expect(await deleteRoute(42)).toBe(true)
  })

  it('deleteRoute should return false when not found', async () => {
    mockDeleteOne.mockResolvedValue({ deletedCount: 0 })
    expect(await deleteRoute(999)).toBe(false)
  })
})

// ============ City ============

describe('City operations', () => {
  const CITY_DOC = { _id: 'luoyuan', name: '罗源', shortName: '罗源', adcode: '350123', coordinates: { lng: 119, lat: 26 }, available: true, sortOrder: 1, createdAt: new Date(), updatedAt: new Date() }

  it('getAllCities should return cities sorted', async () => {
    mockToArray.mockResolvedValue([CITY_DOC])
    const cities = await getAllCities()
    expect(mockCollection).toHaveBeenCalledWith('cities')
    expect(cities[0].id).toBe('luoyuan')
  })

  it('createCity should throw when ID exists', async () => {
    mockFindOne.mockResolvedValue(CITY_DOC)
    await expect(
      createCity({ id: 'luoyuan', name: '罗源', shortName: '罗源', adcode: '350123', coordinates: { lng: 119, lat: 26 }, available: true })
    ).rejects.toThrow('城市 ID "luoyuan" 已存在')
  })

  it('createCity should insert with default sortOrder', async () => {
    mockFindOne.mockResolvedValue(null)
    mockInsertOne.mockResolvedValue({ insertedId: 'new-city' })
    const city = await createCity({ id: 'new-city', name: '新城市', shortName: '新', adcode: '999', coordinates: { lng: 0, lat: 0 }, available: true })
    expect(city.sortOrder).toBe(0)
  })

  it('updateCity should return updated city', async () => {
    mockFindOneAndUpdate.mockResolvedValue({ ...CITY_DOC, name: '新名' })
    const city = await updateCity('luoyuan', { name: '新名' })
    expect(city).not.toBeNull()
    expect(city!.id).toBe('luoyuan')
  })

  it('updateCity should return null when not found', async () => {
    mockFindOneAndUpdate.mockResolvedValue(null)
    expect(await updateCity('x', { name: 'y' })).toBeNull()
  })

  it('deleteCity should return true/false based on match', async () => {
    mockDeleteOne.mockResolvedValue({ deletedCount: 1 })
    expect(await deleteCity('luoyuan')).toBe(true)
    mockDeleteOne.mockResolvedValue({ deletedCount: 0 })
    expect(await deleteCity('x')).toBe(false)
  })
})

// ============ Prefecture ============

describe('Prefecture operations', () => {
  const PREF_DOC = { _id: 'fuzhou', name: '福州市', shortName: '福州', districts: ['luoyuan'], defaultDistrict: 'luoyuan', sortOrder: 1, createdAt: new Date(), updatedAt: new Date() }

  it('getAllPrefectures should return prefectures', async () => {
    mockToArray.mockResolvedValue([PREF_DOC])
    const prefs = await getAllPrefectures()
    expect(prefs[0].id).toBe('fuzhou')
  })

  it('createPrefecture should throw when ID exists', async () => {
    mockFindOne.mockResolvedValue(PREF_DOC)
    await expect(
      createPrefecture({ id: 'fuzhou', name: '福州市', shortName: '福州', districts: ['luoyuan'], defaultDistrict: 'luoyuan' })
    ).rejects.toThrow('地级市 ID "fuzhou" 已存在')
  })

  it('createPrefecture should insert with default sortOrder', async () => {
    mockFindOne.mockResolvedValue(null)
    mockInsertOne.mockResolvedValue({ insertedId: 'x' })
    const pref = await createPrefecture({ id: 'new-pref', name: '新市', shortName: '新', districts: [], defaultDistrict: 'a' })
    expect(pref.sortOrder).toBe(0)
  })

  it('updatePrefecture should return updated prefecture', async () => {
    mockFindOneAndUpdate.mockResolvedValue({ ...PREF_DOC, name: '新名' })
    const pref = await updatePrefecture('fuzhou', { name: '新名' })
    expect(pref).not.toBeNull()
  })

  it('updatePrefecture should return null when not found', async () => {
    mockFindOneAndUpdate.mockResolvedValue(null)
    expect(await updatePrefecture('x', { name: 'y' })).toBeNull()
  })

  it('deletePrefecture should return true/false', async () => {
    mockDeleteOne.mockResolvedValue({ deletedCount: 1 })
    expect(await deletePrefecture('fuzhou')).toBe(true)
    mockDeleteOne.mockResolvedValue({ deletedCount: 0 })
    expect(await deletePrefecture('x')).toBe(false)
  })
})

// ============ CragPermission ============

describe('CragPermission operations', () => {
  const PERM_DOC = { _id: 'auto', userId: 'user-1', cragId: 'crag-1', role: 'manager', assignedBy: 'admin-1', createdAt: new Date() }

  it('getCragPermission should return permission when found', async () => {
    mockFindOne.mockResolvedValue(PERM_DOC)
    const perm = await getCragPermission('user-1', 'crag-1')
    expect(perm).not.toBeNull()
    expect(perm!.role).toBe('manager')
    expect(mockFindOne).toHaveBeenCalledWith({ userId: 'user-1', cragId: 'crag-1' })
  })

  it('getCragPermission should return null when not found', async () => {
    mockFindOne.mockResolvedValue(null)
    expect(await getCragPermission('x', 'y')).toBeNull()
  })

  it('getCragPermissionsByCragId should filter by cragId', async () => {
    mockToArray.mockResolvedValue([PERM_DOC])
    const perms = await getCragPermissionsByCragId('crag-1')
    expect(perms).toHaveLength(1)
    expect(perms[0].userId).toBe('user-1')
    expect(mockFind).toHaveBeenCalledWith({ cragId: 'crag-1' })
  })

  it('getCragPermissionsByUserId should filter by userId', async () => {
    mockToArray.mockResolvedValue([PERM_DOC])
    const perms = await getCragPermissionsByUserId('user-1')
    expect(perms).toHaveLength(1)
    expect(perms[0].cragId).toBe('crag-1')
    expect(mockFind).toHaveBeenCalledWith({ userId: 'user-1' })
  })

  it('createCragPermission should upsert with a stable ID and return permission', async () => {
    mockUpdateOne.mockResolvedValue({ upsertedCount: 1 })
    const perm = await createCragPermission({ userId: 'u1', cragId: 'c1', role: 'manager', assignedBy: 'admin' })
    expect(perm.userId).toBe('u1')
    expect(perm.createdAt).toBeInstanceOf(Date)
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { userId: 'u1', cragId: 'c1' },
      { $setOnInsert: expect.objectContaining({ _id: 'crag-grant:u1:c1', userId: 'u1', cragId: 'c1' }) },
      { upsert: true }
    )
    expect(mockInsertOne).not.toHaveBeenCalled()
  })

  it('deleteCragPermission should return true when deleted', async () => {
    mockDeleteMany.mockResolvedValue({ deletedCount: 3 })
    expect(await deleteCragPermission('u1', 'c1')).toBe(true)
    expect(mockDeleteMany).toHaveBeenCalledWith({ userId: 'u1', cragId: 'c1' })
    expect(mockDeleteOne).not.toHaveBeenCalled()
  })

  it('deleteCragPermission should return false when not found', async () => {
    mockDeleteMany.mockResolvedValue({ deletedCount: 0 })
    expect(await deleteCragPermission('x', 'y')).toBe(false)
  })

  it('ensureCragPermissionIndexes should create indexes', async () => {
    mockCreateIndex.mockResolvedValue('ok')
    await ensureCragPermissionIndexes()
    expect(mockCreateIndex).toHaveBeenCalledTimes(2)
    expect(mockCreateIndex).toHaveBeenCalledWith({ userId: 1, cragId: 1 }, { unique: true })
    expect(mockCreateIndex).toHaveBeenCalledWith({ cragId: 1 })
  })
})

// ============ Feedback & Visit ============

describe('Feedback and Visit operations', () => {
  it('createFeedback should insert and return feedback', async () => {
    mockInsertOne.mockResolvedValue({ insertedId: { toString: () => 'fb-123' } })
    const fb = await createFeedback('很好的应用！')
    expect(fb.content).toBe('很好的应用！')
    expect(fb.id).toBe('fb-123')
    expect(mockCollection).toHaveBeenCalledWith('feedbacks')
  })

  it('recordVisit should upsert visit count', async () => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 })
    await recordVisit('福建省')
    expect(mockCollection).toHaveBeenCalledWith('visits')
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: 'visit_stats' },
      expect.objectContaining({
        $inc: { 'provinces.福建省': 1, total: 1 },
      }),
      { upsert: true }
    )
  })

  it('getVisitStats should return stats when found', async () => {
    mockFindOne.mockResolvedValue({ provinces: { 福建省: 10 }, total: 10, lastUpdated: new Date() })
    const stats = await getVisitStats()
    expect(stats.total).toBe(10)
  })

  it('getVisitStats should return empty stats when not found', async () => {
    mockFindOne.mockResolvedValue(null)
    const stats = await getVisitStats()
    expect(stats.total).toBe(0)
    expect(stats.provinces).toEqual({})
  })
})

// ============ Error handling ============

describe('Error handling', () => {
  it('getAllCrags should rethrow database errors', async () => {
    mockToArray.mockRejectedValue(new Error('Connection failed'))
    await expect(getAllCrags()).rejects.toThrow('Connection failed')
  })

  it('createCrag should rethrow insert errors', async () => {
    mockFindOne.mockResolvedValue(null)
    mockInsertOne.mockRejectedValue(new Error('Insert failed'))
    await expect(
      createCrag({ id: 'x', name: 'x', cityId: 'x', location: '', developmentTime: '', description: '', approach: '' })
    ).rejects.toThrow('Insert failed')
  })
})
