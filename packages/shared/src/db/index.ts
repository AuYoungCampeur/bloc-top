import { cache } from 'react'
import { getDatabase } from '../mongodb'
import { createModuleLogger } from '../logger'
import type { Crag, Route, Feedback, VisitStats, CityConfig, PrefectureConfig, CragPermission, CragPermissionRole } from '../types'
import { ObjectId } from 'mongodb'
import type { WithId, Document } from 'mongodb'
import { normalizeRouteTopoUpdates } from '../face-references'
import { allocateRouteId } from '../route-id'
import { getRouteTopoVersion, hasRouteTopoChanges, hasRouteTopoUpdates, ROUTE_TOPO_FIELDS, TopoVersionError } from '../route-topo-version'
import { normalizeCragGrantUserId, CragPermissionConflictError, getCragGrantId, getCragGrantUserFilter, assertCragGrantIdentity } from '../crag-grant'

// 创建数据库模块专用 logger
const log = createModuleLogger('DB')

// ============ 类型转换辅助函数 ============

/**
 * 将业务 ID 转换为 MongoDB _id 类型
 * MongoDB 原生驱动使用 _id: ObjectId，但本项目使用字符串/数字作为 _id
 */
function toMongoId(id: string | number): Document['_id'] {
  return id as Document['_id']
}

/**
 * 将 MongoDB 文档转换为 Crag 类型
 * MongoDB 使用 _id 作为主键，需要转换为业务 id
 */
function toCrag(doc: WithId<Document>): Crag {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, createdAt, updatedAt, ...rest } = doc
  return { id: _id as unknown as string, ...rest } as Crag
}

/**
 * 将 MongoDB 文档转换为 Route 类型
 */
function toRoute(doc: WithId<Document>): Route {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, createdAt, updatedAt, ...rest } = doc
  return { id: _id as unknown as number, ...rest, topoVersion: getRouteTopoVersion(rest as Route) } as Route
}

/**
 * 将 MongoDB 文档转换为 CityConfig 类型
 */
function toCity(doc: WithId<Document>): CityConfig {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, createdAt, updatedAt, ...rest } = doc
  return { id: _id as unknown as string, ...rest } as CityConfig
}

/**
 * 将 MongoDB 文档转换为 PrefectureConfig 类型
 */
function toPrefecture(doc: WithId<Document>): PrefectureConfig {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, createdAt, updatedAt, ...rest } = doc
  return { id: _id as unknown as string, ...rest } as PrefectureConfig
}


// ============ Crag 相关操作 ============

/**
 * 获取所有岩场
 */
async function _getAllCrags(): Promise<Crag[]> {
  const start = Date.now()

  try {
    const db = await getDatabase()
    const docs = await db
      .collection('crags')
      .find({})
      .sort({ createdAt: -1 })
      .toArray()

    log.info(`Fetched ${docs.length} crags`, {
      action: 'getAllCrags',
      duration: Date.now() - start,
    })

    return docs.map(toCrag)
  } catch (error) {
    log.error('Failed to fetch crags', error, {
      action: 'getAllCrags',
      duration: Date.now() - start,
    })
    throw error
  }
}
export const getAllCrags = cache(_getAllCrags)

/**
 * 根据城市 ID 获取岩场列表
 */
async function _getCragsByCityId(cityId: string): Promise<Crag[]> {
  const start = Date.now()

  try {
    const db = await getDatabase()
    const docs = await db
      .collection('crags')
      .find({ cityId })
      .sort({ createdAt: -1 })
      .toArray()

    log.info(`Fetched ${docs.length} crags for city: ${cityId}`, {
      action: 'getCragsByCityId',
      duration: Date.now() - start,
      metadata: { cityId },
    })

    return docs.map(toCrag)
  } catch (error) {
    log.error(`Failed to fetch crags for city: ${cityId}`, error, {
      action: 'getCragsByCityId',
      duration: Date.now() - start,
      metadata: { cityId },
    })
    throw error
  }
}
export const getCragsByCityId = cache(_getCragsByCityId)

/**
 * 根据 ID 获取单个岩场
 */
async function _getCragById(id: string): Promise<Crag | null> {
  const start = Date.now()

  try {
    const db = await getDatabase()
    const doc = await db.collection('crags').findOne({ _id: toMongoId(id) })

    if (!doc) {
      log.info(`Crag not found: ${id}`, {
        action: 'getCragById',
        duration: Date.now() - start,
      })
      return null
    }

    log.debug(`Fetched crag: ${id}`, {
      action: 'getCragById',
      duration: Date.now() - start,
    })

    return toCrag(doc)
  } catch (error) {
    log.error(`Failed to fetch crag: ${id}`, error, {
      action: 'getCragById',
      duration: Date.now() - start,
      metadata: { cragId: id },
    })
    throw error
  }
}
export const getCragById = cache(_getCragById)

/**
 * 创建新岩场
 * 使用 crag.id 作为 MongoDB _id
 */
export async function createCrag(
  crag: Omit<Crag, 'coverImages' | 'approachPaths' | 'areas' | 'credits'>
): Promise<Crag> {
  const start = Date.now()

  try {
    const db = await getDatabase()

    // 检查 ID 唯一性
    const existing = await db.collection('crags').findOne({ _id: toMongoId(crag.id) })
    if (existing) {
      throw new Error(`岩场 ID "${crag.id}" 已存在`)
    }

    const { id, ...fields } = crag
    const doc = {
      _id: toMongoId(id),
      ...fields,
      areas: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    await db.collection('crags').insertOne(doc)

    log.info(`Created crag: ${id}`, {
      action: 'createCrag',
      duration: Date.now() - start,
      metadata: { cragId: id, name: crag.name },
    })

    return { ...crag, areas: [] } as Crag
  } catch (error) {
    log.error('Failed to create crag', error, {
      action: 'createCrag',
      duration: Date.now() - start,
      metadata: { cragId: crag.id },
    })
    throw error
  }
}

/**
 * 更新岩场信息
 * 支持部分更新，不允许修改 id
 */
export async function updateCrag(
  id: string,
  updates: Partial<Omit<Crag, 'id'>>
): Promise<Crag | null> {
  const start = Date.now()

  try {
    const db = await getDatabase()

    const updateData = {
      ...updates,
      updatedAt: new Date(),
    }

    const result = await db.collection('crags').findOneAndUpdate(
      { _id: toMongoId(id) },
      { $set: updateData },
      { returnDocument: 'after' }
    )

    if (!result) {
      log.info(`Crag not found for update: ${id}`, {
        action: 'updateCrag',
        duration: Date.now() - start,
      })
      return null
    }

    log.info(`Updated crag: ${id}`, {
      action: 'updateCrag',
      duration: Date.now() - start,
      metadata: { cragId: id, fields: Object.keys(updates) },
    })

    return toCrag(result)
  } catch (error) {
    log.error(`Failed to update crag: ${id}`, error, {
      action: 'updateCrag',
      duration: Date.now() - start,
      metadata: { cragId: id },
    })
    throw error
  }
}

// ============ Route 相关操作 ============

/**
 * 获取所有线路
 */
async function _getAllRoutes(): Promise<Route[]> {
  const start = Date.now()

  try {
    const db = await getDatabase()
    const docs = await db
      .collection('routes')
      .find({})
      .toArray()

    log.info(`Fetched ${docs.length} routes`, {
      action: 'getAllRoutes',
      duration: Date.now() - start,
    })

    return docs.map(toRoute)
  } catch (error) {
    log.error('Failed to fetch routes', error, {
      action: 'getAllRoutes',
      duration: Date.now() - start,
    })
    throw error
  }
}
export const getAllRoutes = cache(_getAllRoutes)

/**
 * 根据 ID 获取单条线路
 */
async function _getRouteById(id: number): Promise<Route | null> {
  const start = Date.now()

  try {
    const db = await getDatabase()
    const doc = await db.collection('routes').findOne({ _id: toMongoId(id) })

    if (!doc) {
      log.info(`Route not found: ${id}`, {
        action: 'getRouteById',
        duration: Date.now() - start,
      })
      return null
    }

    log.debug(`Fetched route: ${id}`, {
      action: 'getRouteById',
      duration: Date.now() - start,
    })

    return toRoute(doc)
  } catch (error) {
    log.error(`Failed to fetch route: ${id}`, error, {
      action: 'getRouteById',
      duration: Date.now() - start,
      metadata: { routeId: id },
    })
    throw error
  }
}
export const getRouteById = cache(_getRouteById)

/**
 * 获取指定岩场的所有线路
 */
async function _getRoutesByCragId(cragId: string): Promise<Route[]> {
  const start = Date.now()

  try {
    const db = await getDatabase()
    const docs = await db
      .collection('routes')
      .find({ cragId })
      .toArray()

    log.info(`Fetched ${docs.length} routes for crag: ${cragId}`, {
      action: 'getRoutesByCragId',
      duration: Date.now() - start,
      metadata: { cragId },
    })

    return docs.map(toRoute)
  } catch (error) {
    log.error(`Failed to fetch routes for crag: ${cragId}`, error, {
      action: 'getRoutesByCragId',
      duration: Date.now() - start,
      metadata: { cragId },
    })
    throw error
  }
}
export const getRoutesByCragId = cache(_getRoutesByCragId)

/**
 * 根据城市 ID 获取所有线路
 * 两步查询：先获取城市的岩场列表，再用 $in 查询这些岩场的线路
 */
async function _getRoutesByCityId(cityId: string): Promise<Route[]> {
  const start = Date.now()

  try {
    const crags = await getCragsByCityId(cityId)
    const cragIds = crags.map((c) => c.id)

    const db = await getDatabase()
    const docs = await db
      .collection('routes')
      .find({ cragId: { $in: cragIds } })
      .toArray()

    log.info(`Fetched ${docs.length} routes for city: ${cityId}`, {
      action: 'getRoutesByCityId',
      duration: Date.now() - start,
      metadata: { cityId, cragCount: cragIds.length },
    })

    return docs.map(toRoute)
  } catch (error) {
    log.error(`Failed to fetch routes for city: ${cityId}`, error, {
      action: 'getRoutesByCityId',
      duration: Date.now() - start,
      metadata: { cityId },
    })
    throw error
  }
}
export const getRoutesByCityId = cache(_getRoutesByCityId)

/**
 * 根据地级市 ID 获取所有岩场（聚合该地级市下所有区/县）
 */
async function _getCragsByPrefectureId(prefectureId: string): Promise<Crag[]> {
  const start = Date.now()

  try {
    const db = await getDatabase()
    const prefDoc = await db.collection('prefectures').findOne({ _id: toMongoId(prefectureId) })
    if (!prefDoc) return []

    const districts = prefDoc.districts as string[]
    const docs = await db
      .collection('crags')
      .find({ cityId: { $in: districts } })
      .sort({ cityId: 1, createdAt: -1 })
      .toArray()

    log.info(`Fetched ${docs.length} crags for prefecture: ${prefectureId}`, {
      action: 'getCragsByPrefectureId',
      duration: Date.now() - start,
      metadata: { prefectureId, districts },
    })

    return docs.map(toCrag)
  } catch (error) {
    log.error(`Failed to fetch crags for prefecture: ${prefectureId}`, error, {
      action: 'getCragsByPrefectureId',
      duration: Date.now() - start,
      metadata: { prefectureId },
    })
    throw error
  }
}
export const getCragsByPrefectureId = cache(_getCragsByPrefectureId)

/**
 * 根据地级市 ID 获取所有线路（聚合该地级市下所有岩场的线路）
 */
async function _getRoutesByPrefectureId(prefectureId: string): Promise<Route[]> {
  const start = Date.now()

  try {
    const crags = await getCragsByPrefectureId(prefectureId)
    const cragIds = crags.map((c) => c.id)

    const db = await getDatabase()
    const docs = await db
      .collection('routes')
      .find({ cragId: { $in: cragIds } })
      .toArray()

    log.info(`Fetched ${docs.length} routes for prefecture: ${prefectureId}`, {
      action: 'getRoutesByPrefectureId',
      duration: Date.now() - start,
      metadata: { prefectureId, cragCount: cragIds.length },
    })

    return docs.map(toRoute)
  } catch (error) {
    log.error(`Failed to fetch routes for prefecture: ${prefectureId}`, error, {
      action: 'getRoutesByPrefectureId',
      duration: Date.now() - start,
      metadata: { prefectureId },
    })
    throw error
  }
}
export const getRoutesByPrefectureId = cache(_getRoutesByPrefectureId)

/**
 * 获取指定岩场的线路数量 (轻量查询，用于 stale 检测)
 */
export async function getRouteCountByCragId(cragId: string): Promise<number> {
  const start = Date.now()

  try {
    const db = await getDatabase()
    const count = await db
      .collection('routes')
      .countDocuments({ cragId })

    log.info(`Counted ${count} routes for crag: ${cragId}`, {
      action: 'getRouteCountByCragId',
      duration: Date.now() - start,
      metadata: { cragId },
    })

    return count
  } catch (error) {
    log.error(`Failed to count routes for crag: ${cragId}`, error, {
      action: 'getRouteCountByCragId',
      duration: Date.now() - start,
      metadata: { cragId },
    })
    throw error
  }
}

/**
 * 更新线路信息
 * 支持部分更新，只更新传入的字段
 */
export async function updateRoute(
  id: number,
  updates: Partial<Omit<Route, 'id' | 'topoVersion'>>,
  options: { expectedTopoVersion?: number } = {},
): Promise<Route | null> {
  const start = Date.now()

  try {
    const db = await getDatabase()
    if (Object.hasOwn(updates, 'topoVersion')) throw new TypeError('Topo 版本由服务器维护')
    const expectedVersion = options.expectedTopoVersion
    if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)) {
      throw new TypeError('expectedTopoVersion 必须是非负安全整数')
    }
    const collection = db.collection('routes')
    const topoRequested = hasRouteTopoUpdates(updates)
    // Area changes may materialize a legacy faceArea while preserving its image
    // identity. Guard that derived write too, without advancing the Topo version.
    const needsSnapshot = topoRequested || Object.hasOwn(updates, 'area')
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = needsSnapshot ? await collection.findOne({ _id: toMongoId(id) }) : null
      if (needsSnapshot && !current) return null
      const route = current ? toRoute(current) : undefined
      const normalized = normalizeRouteTopoUpdates(updates, route)
      const changed = !!route && topoRequested && hasRouteTopoChanges(route, normalized)
      if (topoRequested && route) {
        if (expectedVersion !== undefined && expectedVersion !== getRouteTopoVersion(route)) throw new TopoVersionError(409, route)
        if (changed && expectedVersion === undefined) throw new TopoVersionError(428, route)
        // An unchanged old payload must never write a stale Topo snapshot later.
        if (!changed) for (const field of ROUTE_TOPO_FIELDS) delete normalized[field]
      }
      const filter: Document = { _id: toMongoId(id) }
      if (current) {
        filter.cragId = current.cragId; filter.area = current.area
        filter.topoVersion = Object.hasOwn(current, 'topoVersion') ? current.topoVersion : { $exists: false }
        for (const field of ROUTE_TOPO_FIELDS) filter[field] = Object.hasOwn(current, field) ? current[field] : { $exists: false }
      }
      const set: Document = { updatedAt: new Date() }
      const unset: Document = {}
      for (const [field, value] of Object.entries(normalized)) {
        if (value === undefined) unset[field] = ''
        else set[field] = value
      }
      if (changed && getRouteTopoVersion(route!) >= Number.MAX_SAFE_INTEGER) throw new TopoVersionError(409, route!)
      const result = await collection.findOneAndUpdate(filter, {
        $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}),
        ...(changed ? { $inc: { topoVersion: 1 } } : {}),
      }, { returnDocument: 'after' })
      if (result) {
        log.info(`Updated route: ${id}`, {
          action: 'updateRoute', duration: Date.now() - start,
          metadata: { routeId: id, fields: Object.keys(updates) },
        })
        return toRoute(result)
      }
      if (!needsSnapshot) return null
    }
    const latest = await collection.findOne({ _id: toMongoId(id) })
    if (!latest) return null
    throw new TopoVersionError(409, toRoute(latest))
  } catch (error) {
    log.error(`Failed to update route: ${id}`, error, {
      action: 'updateRoute',
      duration: Date.now() - start,
      metadata: { routeId: id },
    })
    throw error
  }
}

/**
 * 创建新线路
 * 使用持久计数器分配递增 ID；删除不回收 ID
 */
export async function createRoute(
  data: Omit<Route, 'id' | 'topoVersion' | 'topoLine' | 'betaLinks' | 'image'>
): Promise<Route> {
  const start = Date.now()

  try {
    const db = await getDatabase()
    const collection = db.collection('routes')

    const newId = await allocateRouteId(db)
    const normalized = normalizeRouteTopoUpdates(data)
    const fields = Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== undefined))

    const doc = {
      _id: toMongoId(newId),
      ...fields,
      topoVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    await collection.insertOne(doc)

    log.info(`Created route: ${newId}`, {
      action: 'createRoute',
      duration: Date.now() - start,
      metadata: { routeId: newId, name: data.name, cragId: data.cragId },
    })

    return { id: newId, ...fields, topoVersion: 0 } as Route
  } catch (error) {
    log.error('Failed to create route', error, {
      action: 'createRoute',
      duration: Date.now() - start,
    })
    throw error
  }
}

/**
 * 删除线路 (含内嵌的 betaLinks、topoLine 等)
 */
export async function deleteRoute(id: number): Promise<boolean> {
  const start = Date.now()

  try {
    const db = await getDatabase()
    const result = await db.collection('routes').deleteOne({
      _id: toMongoId(id),
    })

    log.info(`Deleted route: ${id} (matched: ${result.deletedCount})`, {
      action: 'deleteRoute',
      duration: Date.now() - start,
    })

    return result.deletedCount > 0
  } catch (error) {
    log.error(`Failed to delete route: ${id}`, error, {
      action: 'deleteRoute',
      duration: Date.now() - start,
    })
    throw error
  }
}

/**
 * 更新岩场的区域列表
 */
export async function updateCragAreas(cragId: string, areas: string[]): Promise<string[]> {
  const start = Date.now()

  try {
    const db = await getDatabase()
    const result = await db.collection('crags').findOneAndUpdate(
      { _id: toMongoId(cragId) },
      { $set: { areas, updatedAt: new Date() } },
      { returnDocument: 'after' }
    )

    if (!result) {
      log.info(`Crag not found for areas update: ${cragId}`, {
        action: 'updateCragAreas',
        duration: Date.now() - start,
      })
      return areas
    }

    log.info(`Updated crag areas: ${cragId}`, {
      action: 'updateCragAreas',
      duration: Date.now() - start,
      metadata: { cragId, areaCount: areas.length },
    })

    return (result.areas as string[]) || areas
  } catch (error) {
    log.error(`Failed to update crag areas: ${cragId}`, error, {
      action: 'updateCragAreas',
      duration: Date.now() - start,
      metadata: { cragId },
    })
    throw error
  }
}

// ============ Feedback 相关操作 ============

/**
 * 创建用户反馈
 */
export async function createFeedback(content: string): Promise<Feedback> {
  const start = Date.now()

  try {
    const db = await getDatabase()
    const doc = {
      content,
      createdAt: new Date(),
    }

    const result = await db.collection('feedbacks').insertOne(doc)

    log.info('Feedback created', {
      action: 'createFeedback',
      duration: Date.now() - start,
      metadata: { feedbackId: result.insertedId.toString() },
    })

    return {
      id: result.insertedId.toString(),
      content,
      createdAt: doc.createdAt,
    }
  } catch (error) {
    log.error('Failed to create feedback', error, {
      action: 'createFeedback',
      duration: Date.now() - start,
    })
    throw error
  }
}

// ============ Visit 相关操作 ============

const VISIT_STATS_ID = 'visit_stats'

/**
 * 记录一次 App 打开
 * 使用 $inc 原子操作更新省份计数和总数
 * 不去重，每次打开都会计数
 *
 * @param province 省份名称（如「福建省」、「海外」）
 */
export async function recordVisit(province: string): Promise<void> {
  const start = Date.now()

  try {
    const db = await getDatabase()

    // 使用 upsert + $inc 实现原子更新
    await db.collection('visits').updateOne(
      { _id: toMongoId(VISIT_STATS_ID) },
      {
        $inc: {
          [`provinces.${province}`]: 1,
          total: 1,
        },
        $set: { lastUpdated: new Date() },
      },
      { upsert: true }
    )

    log.info(`Visit recorded: ${province}`, {
      action: 'recordVisit',
      duration: Date.now() - start,
      metadata: { province },
    })
  } catch (error) {
    log.error('Failed to record visit', error, {
      action: 'recordVisit',
      duration: Date.now() - start,
      metadata: { province },
    })
    throw error
  }
}

/**
 * 获取访问统计数据
 */
export async function getVisitStats(): Promise<VisitStats> {
  const start = Date.now()

  try {
    const db = await getDatabase()
    const doc = await db.collection('visits').findOne({
      _id: toMongoId(VISIT_STATS_ID),
    })

    if (!doc) {
      log.debug('No visit stats found, returning empty', {
        action: 'getVisitStats',
        duration: Date.now() - start,
      })
      return {
        provinces: {},
        total: 0,
        lastUpdated: new Date(),
      }
    }

    log.debug(`Fetched visit stats: ${doc.total} total visits`, {
      action: 'getVisitStats',
      duration: Date.now() - start,
    })

    return {
      provinces: doc.provinces || {},
      total: doc.total || 0,
      lastUpdated: doc.lastUpdated || new Date(),
    }
  } catch (error) {
    log.error('Failed to fetch visit stats', error, {
      action: 'getVisitStats',
      duration: Date.now() - start,
    })
    throw error
  }
}

// ============ City 相关操作 ============

/**
 * 获取所有城市（按 sortOrder 排序）
 */
async function _getAllCities(): Promise<CityConfig[]> {
  const start = Date.now()

  try {
    const db = await getDatabase()
    const docs = await db
      .collection('cities')
      .find({})
      .sort({ sortOrder: 1, _id: 1 })
      .toArray()

    log.info(`Fetched ${docs.length} cities`, {
      action: 'getAllCities',
      duration: Date.now() - start,
    })

    return docs.map(toCity)
  } catch (error) {
    log.error('Failed to fetch cities', error, {
      action: 'getAllCities',
      duration: Date.now() - start,
    })
    throw error
  }
}
export const getAllCities = cache(_getAllCities)

/**
 * 获取所有地级市（按 sortOrder 排序）
 */
async function _getAllPrefectures(): Promise<PrefectureConfig[]> {
  const start = Date.now()

  try {
    const db = await getDatabase()
    const docs = await db
      .collection('prefectures')
      .find({})
      .sort({ sortOrder: 1, _id: 1 })
      .toArray()

    log.info(`Fetched ${docs.length} prefectures`, {
      action: 'getAllPrefectures',
      duration: Date.now() - start,
    })

    return docs.map(toPrefecture)
  } catch (error) {
    log.error('Failed to fetch prefectures', error, {
      action: 'getAllPrefectures',
      duration: Date.now() - start,
    })
    throw error
  }
}
export const getAllPrefectures = cache(_getAllPrefectures)

/**
 * 创建城市
 */
export async function createCity(
  data: Omit<CityConfig, 'sortOrder'> & { sortOrder?: number }
): Promise<CityConfig> {
  const start = Date.now()

  try {
    const db = await getDatabase()

    const existing = await db.collection('cities').findOne({ _id: toMongoId(data.id) })
    if (existing) {
      throw new Error(`城市 ID "${data.id}" 已存在`)
    }

    const { id, ...fields } = data
    const doc = {
      _id: toMongoId(id),
      ...fields,
      sortOrder: fields.sortOrder ?? 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    await db.collection('cities').insertOne(doc)

    log.info(`Created city: ${id}`, {
      action: 'createCity',
      duration: Date.now() - start,
      metadata: { cityId: id, name: data.name },
    })

    return { ...data, id, sortOrder: doc.sortOrder }
  } catch (error) {
    log.error('Failed to create city', error, {
      action: 'createCity',
      duration: Date.now() - start,
      metadata: { cityId: data.id },
    })
    throw error
  }
}

/**
 * 更新城市
 */
export async function updateCity(
  id: string,
  updates: Partial<Omit<CityConfig, 'id'>>
): Promise<CityConfig | null> {
  const start = Date.now()

  try {
    const db = await getDatabase()

    const result = await db.collection('cities').findOneAndUpdate(
      { _id: toMongoId(id) },
      { $set: { ...updates, updatedAt: new Date() } },
      { returnDocument: 'after' }
    )

    if (!result) {
      log.info(`City not found for update: ${id}`, {
        action: 'updateCity',
        duration: Date.now() - start,
      })
      return null
    }

    log.info(`Updated city: ${id}`, {
      action: 'updateCity',
      duration: Date.now() - start,
      metadata: { cityId: id, fields: Object.keys(updates) },
    })

    return toCity(result)
  } catch (error) {
    log.error(`Failed to update city: ${id}`, error, {
      action: 'updateCity',
      duration: Date.now() - start,
      metadata: { cityId: id },
    })
    throw error
  }
}

/**
 * 删除城市
 */
export async function deleteCity(id: string): Promise<boolean> {
  const start = Date.now()

  try {
    const db = await getDatabase()
    const result = await db.collection('cities').deleteOne({ _id: toMongoId(id) })

    log.info(`Deleted city: ${id} (matched: ${result.deletedCount})`, {
      action: 'deleteCity',
      duration: Date.now() - start,
    })

    return result.deletedCount > 0
  } catch (error) {
    log.error(`Failed to delete city: ${id}`, error, {
      action: 'deleteCity',
      duration: Date.now() - start,
    })
    throw error
  }
}

/**
 * 创建地级市
 */
export async function createPrefecture(
  data: Omit<PrefectureConfig, 'sortOrder'> & { sortOrder?: number }
): Promise<PrefectureConfig> {
  const start = Date.now()

  try {
    const db = await getDatabase()

    const existing = await db.collection('prefectures').findOne({ _id: toMongoId(data.id) })
    if (existing) {
      throw new Error(`地级市 ID "${data.id}" 已存在`)
    }

    const { id, ...fields } = data
    const doc = {
      _id: toMongoId(id),
      ...fields,
      sortOrder: fields.sortOrder ?? 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    await db.collection('prefectures').insertOne(doc)

    log.info(`Created prefecture: ${id}`, {
      action: 'createPrefecture',
      duration: Date.now() - start,
      metadata: { prefectureId: id, name: data.name },
    })

    return { ...data, id, sortOrder: doc.sortOrder }
  } catch (error) {
    log.error('Failed to create prefecture', error, {
      action: 'createPrefecture',
      duration: Date.now() - start,
      metadata: { prefectureId: data.id },
    })
    throw error
  }
}

/**
 * 更新地级市
 */
export async function updatePrefecture(
  id: string,
  updates: Partial<Omit<PrefectureConfig, 'id'>>
): Promise<PrefectureConfig | null> {
  const start = Date.now()

  try {
    const db = await getDatabase()

    const result = await db.collection('prefectures').findOneAndUpdate(
      { _id: toMongoId(id) },
      { $set: { ...updates, updatedAt: new Date() } },
      { returnDocument: 'after' }
    )

    if (!result) {
      log.info(`Prefecture not found for update: ${id}`, {
        action: 'updatePrefecture',
        duration: Date.now() - start,
      })
      return null
    }

    log.info(`Updated prefecture: ${id}`, {
      action: 'updatePrefecture',
      duration: Date.now() - start,
      metadata: { prefectureId: id, fields: Object.keys(updates) },
    })

    return toPrefecture(result)
  } catch (error) {
    log.error(`Failed to update prefecture: ${id}`, error, {
      action: 'updatePrefecture',
      duration: Date.now() - start,
      metadata: { prefectureId: id },
    })
    throw error
  }
}

/**
 * 删除地级市
 */
export async function deletePrefecture(id: string): Promise<boolean> {
  const start = Date.now()

  try {
    const db = await getDatabase()
    const result = await db.collection('prefectures').deleteOne({ _id: toMongoId(id) })

    log.info(`Deleted prefecture: ${id} (matched: ${result.deletedCount})`, {
      action: 'deletePrefecture',
      duration: Date.now() - start,
    })

    return result.deletedCount > 0
  } catch (error) {
    log.error(`Failed to delete prefecture: ${id}`, error, {
      action: 'deletePrefecture',
      duration: Date.now() - start,
    })
    throw error
  }
}

// ============ Avatar 相关操作 ============

/**
 * 上传或更新用户头像
 * 使用 upsert：同一用户只保留最新头像
 */
export async function upsertAvatar(
  userId: string,
  data: Buffer,
  contentType: string
): Promise<void> {
  const start = Date.now()

  try {
    const db = await getDatabase()

    await db.collection('avatars').updateOne(
      { userId },
      {
        $set: {
          data,
          contentType,
          size: data.length,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    )

    // 同步更新 better-auth user 文档的 image 字段
    // better-auth 的 MongoDB adapter 用 ObjectId 存储 _id，必须转换
    const avatarUrl = `/api/user/avatar/${userId}?t=${Date.now()}`
    const userResult = await db.collection('user').updateOne(
      { _id: new ObjectId(userId) },
      { $set: { image: avatarUrl } }
    )
    if (userResult.matchedCount === 0) {
      log.warn(`User document not found for avatar sync: ${userId}`, {
        action: 'upsertAvatar',
      })
    }

    log.info(`Upserted avatar for user: ${userId}`, {
      action: 'upsertAvatar',
      duration: Date.now() - start,
      metadata: { userId, size: data.length, contentType },
    })
  } catch (error) {
    log.error(`Failed to upsert avatar for user: ${userId}`, error, {
      action: 'upsertAvatar',
      duration: Date.now() - start,
      metadata: { userId },
    })
    throw error
  }
}

/**
 * 获取用户头像数据
 */
export async function getAvatar(
  userId: string
): Promise<{ data: Buffer; contentType: string; updatedAt: Date } | null> {
  const start = Date.now()

  try {
    const db = await getDatabase()
    const doc = await db.collection('avatars').findOne({ userId })

    if (!doc) {
      log.debug(`Avatar not found for user: ${userId}`, {
        action: 'getAvatar',
        duration: Date.now() - start,
      })
      return null
    }

    log.debug(`Fetched avatar for user: ${userId}`, {
      action: 'getAvatar',
      duration: Date.now() - start,
    })

    return {
      data: doc.data.buffer ? Buffer.from(doc.data.buffer) : doc.data,
      contentType: doc.contentType,
      updatedAt: doc.updatedAt,
    }
  } catch (error) {
    log.error(`Failed to fetch avatar for user: ${userId}`, error, {
      action: 'getAvatar',
      duration: Date.now() - start,
      metadata: { userId },
    })
    throw error
  }
}

/**
 * 删除用户头像
 */
export async function deleteAvatar(userId: string): Promise<boolean> {
  const start = Date.now()

  try {
    const db = await getDatabase()

    const result = await db.collection('avatars').deleteOne({ userId })

    // 清空 user 文档的 image 字段
    // better-auth 的 MongoDB adapter 用 ObjectId 存储 _id，必须转换
    await db.collection('user').updateOne(
      { _id: new ObjectId(userId) },
      { $set: { image: null } }
    )

    log.info(`Deleted avatar for user: ${userId} (matched: ${result.deletedCount})`, {
      action: 'deleteAvatar',
      duration: Date.now() - start,
    })

    return result.deletedCount > 0
  } catch (error) {
    log.error(`Failed to delete avatar for user: ${userId}`, error, {
      action: 'deleteAvatar',
      duration: Date.now() - start,
      metadata: { userId },
    })
    throw error
  }
}

// ============ CragPermission 相关操作 ============

/**
 * 将 MongoDB 文档转换为 CragPermission 类型
 */
function toCragPermission(doc: WithId<Document>): CragPermission {
  return {
    userId: doc.userId as string,
    cragId: doc.cragId as string,
    role: doc.role as CragPermissionRole,
    assignedBy: doc.assignedBy as string,
    createdAt: doc.createdAt as Date,
  }
}

/**
 * 查询单条岩场权限记录
 */
export async function getCragPermission(
  userId: string,
  cragId: string
): Promise<CragPermission | null> {
  const start = Date.now()

  try {
    assertCragGrantIdentity(userId, cragId)
    const db = await getDatabase()
    const doc = await db.collection('crag_permissions').findOne({ userId: getCragGrantUserFilter(userId), cragId })

    if (!doc) return null

    log.debug(`Fetched crag permission: ${userId} → ${cragId}`, {
      action: 'getCragPermission',
      duration: Date.now() - start,
    })

    return toCragPermission(doc)
  } catch (error) {
    log.error(`Failed to get crag permission: ${userId} → ${cragId}`, error, {
      action: 'getCragPermission',
      duration: Date.now() - start,
    })
    throw error
  }
}

/**
 * 获取指定岩场的所有权限记录
 */
export async function getCragPermissionsByCragId(
  cragId: string
): Promise<CragPermission[]> {
  const start = Date.now()

  try {
    const db = await getDatabase()
    const docs = await db
      .collection('crag_permissions')
      .find({ cragId })
      .sort({ createdAt: 1 })
      .toArray()

    log.debug(`Fetched ${docs.length} permissions for crag: ${cragId}`, {
      action: 'getCragPermissionsByCragId',
      duration: Date.now() - start,
    })

    return docs.map(toCragPermission)
  } catch (error) {
    log.error(`Failed to get permissions for crag: ${cragId}`, error, {
      action: 'getCragPermissionsByCragId',
      duration: Date.now() - start,
    })
    throw error
  }
}

/**
 * 获取指定用户的所有岩场权限记录
 */
export async function getCragPermissionsByUserId(
  userId: string
): Promise<CragPermission[]> {
  const start = Date.now()

  try {
    const db = await getDatabase()
    const docs = await db
      .collection('crag_permissions')
      .find({ userId: getCragGrantUserFilter(userId) })
      .sort({ createdAt: 1 })
      .toArray()

    log.debug(`Fetched ${docs.length} permissions for user: ${userId}`, {
      action: 'getCragPermissionsByUserId',
      duration: Date.now() - start,
    })

    return docs.map(toCragPermission)
  } catch (error) {
    log.error(`Failed to get permissions for user: ${userId}`, error, {
      action: 'getCragPermissionsByUserId',
      duration: Date.now() - start,
    })
    throw error
  }
}

/**
 * 创建岩场权限记录
 * 原子 upsert 匹配旧记录；稳定 _id 依靠 MongoDB 内置唯一约束防止并发重复。
 */
export async function createCragPermission(
  data: Omit<CragPermission, 'createdAt'>
): Promise<CragPermission> {
  const start = Date.now()

  try {
    assertCragGrantIdentity(data.userId, data.cragId)
    const db = await getDatabase()
    const doc = {
      ...data,
      userId: normalizeCragGrantUserId(data.userId),
      createdAt: new Date(),
    }

    const result = await db.collection<CragPermission & { _id: string | ObjectId }>('crag_permissions').updateOne(
      { userId: getCragGrantUserFilter(data.userId), cragId: data.cragId },
      { $setOnInsert: { ...doc, _id: getCragGrantId(data.userId, data.cragId) } },
      { upsert: true }
    )
    if (result.upsertedCount !== 1) throw new CragPermissionConflictError()

    log.info(`Created crag permission: ${data.userId} → ${data.cragId} (${data.role})`, {
      action: 'createCragPermission',
      duration: Date.now() - start,
      metadata: { userId: data.userId, cragId: data.cragId, role: data.role },
    })

    return doc
  } catch (error) {
    log.error(`Failed to create crag permission: ${data.userId} → ${data.cragId}`, error, {
      action: 'createCragPermission',
      duration: Date.now() - start,
    })
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 11000) {
      throw new CragPermissionConflictError()
    }
    throw error
  }
}

/**
 * 撤销该用户在此岩场的全部授权，包括历史重复记录。
 */
export async function deleteCragPermission(
  userId: string,
  cragId: string
): Promise<boolean> {
  const start = Date.now()

  try {
    assertCragGrantIdentity(userId, cragId)
    const db = await getDatabase()
    const result = await db.collection('crag_permissions').deleteMany({
      userId: getCragGrantUserFilter(userId),
      cragId,
    })

    log.info(`Deleted crag permission: ${userId} → ${cragId} (matched: ${result.deletedCount})`, {
      action: 'deleteCragPermission',
      duration: Date.now() - start,
    })

    return result.deletedCount > 0
  } catch (error) {
    log.error(`Failed to delete crag permission: ${userId} → ${cragId}`, error, {
      action: 'deleteCragPermission',
      duration: Date.now() - start,
    })
    throw error
  }
}

/**
 * 确保 crag_permissions collection 的索引存在
 * 在迁移脚本或应用启动时调用
 */
export async function ensureCragPermissionIndexes(): Promise<void> {
  const db = await getDatabase()
  await db.collection('crag_permissions').createIndex(
    { userId: 1, cragId: 1 },
    { unique: true }
  )
  await db.collection('crag_permissions').createIndex({ cragId: 1 })
  log.info('Ensured crag_permissions indexes', {
    action: 'ensureCragPermissionIndexes',
  })
}
