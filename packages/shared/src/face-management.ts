import { randomUUID } from 'node:crypto'
import type { Db, Document, Filter } from 'mongodb'
import type { Route } from './types'
import { getFaceIdentityKey, transformRouteFaceReferences, type FaceIdentity, type FaceReferenceOperation } from './face-references'

export interface StoredFace { etag: string; contentType?: string }
export interface FaceObjectStore {
  head(key: string): Promise<StoredFace | null>
  list(prefix: string, continuationToken?: string): Promise<{ keys: string[]; continuationToken?: string }>
  /** Must protect both the source version and destination absence. */
  copy(source: string, destination: string, sourceEtag: string): Promise<void>
  put(key: string, body: Uint8Array, options: { contentType: string; ifMatch?: string; ifNoneMatch?: '*' }): Promise<void>
  delete(key: string): Promise<void>
}

export interface FaceOperationResult {
  success: true
  routes: Route[]
  routesUpdated: number
  routesCleared: number
  topoLinesCleared: number
  mediaRevision?: string
  partial?: true
  cleanupPending?: true
  revisionPending?: true
  warning?: string
}

export class FaceOperationError extends Error {
  constructor(public status: number, public code: string, message: string,
    public details: { partial?: boolean; referencesChanged?: boolean; referencesPending?: boolean; imageChanged?: boolean; imageChangeUnknown?: boolean; targetCreated?: boolean; cleanupPending?: boolean } = {}) {
    super(message)
  }
}

/** Reject unsafe/colliding input instead of silently changing its identity. */
export function validateStorageSegment(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 160 || /[\/%\\\x00-\x1f\x7f]/.test(value) || value === '.' || value === '..') {
    throw new FaceOperationError(400, 'INVALID_FACE_IDENTITY', `${name} 格式无效`)
  }
  return value
}

export function parseFaceIdentity(input: Record<string, unknown>): FaceIdentity {
  return { cragId: validateStorageSegment(input.cragId, 'cragId'), area: validateStorageSegment(input.area, 'area'), faceId: validateStorageSegment(input.faceId, 'faceId') }
}

const TOPO_FIELDS = ['faceId', 'faceArea', 'topoLine', 'topoTension', 'topoAnnotations'] as const
const asRoute = (doc: Document): Route => {
  const rest = { ...doc }
  delete rest._id; delete rest.createdAt; delete rest.updatedAt
  return { ...rest, id: doc._id } as Route
}

/** Compare only Topo fields; unrelated concurrent Beta/metadata writes survive. */
async function transformReferences(db: Db, face: FaceIdentity, operation: FaceReferenceOperation): Promise<Route[]> {
  const collection = db.collection('routes')
  const documents = await collection.find({ cragId: face.cragId, $or: [
    { topoAnnotations: { $elemMatch: { area: face.area, faceId: face.faceId } } },
    { faceId: face.faceId },
  ] }).toArray()
  const changed: Route[] = []
  try {
    for (const original of documents) {
      let current: Document | null = original
      let completed = false
      for (let attempt = 0; attempt < 4; attempt++) {
        if (!current) { completed = true; break }
        const updates = transformRouteFaceReferences(asRoute(current), face, operation)
        if (!Object.keys(updates).length) { completed = true; break }
        const expected: Document = { _id: current._id, cragId: face.cragId, area: current.area }
        for (const field of TOPO_FIELDS) expected[field] = Object.hasOwn(current, field) ? current[field] : { $exists: false }
        const set: Document = { updatedAt: new Date() }
        const unset: Document = {}
        for (const [key, value] of Object.entries(updates)) {
          if (value === undefined) unset[key] = ''
          else set[key] = value
        }
        const updated = await collection.findOneAndUpdate(expected as Filter<Document>, {
          $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}),
        }, { returnDocument: 'after' })
        if (updated) { changed.push(asRoute(updated)); completed = true; break }
        current = await collection.findOne({ _id: original._id, cragId: face.cragId })
      }
      if (!completed) throw new Error('Concurrent Topo changes prevented the reference update')
    }
    return changed
  } catch {
    throw new FaceOperationError(503, 'FACE_REFERENCE_UPDATE_FAILED', '线路引用更新未完成，请刷新后恢复操作', {
      // An errored Mongo reply does not establish that its write never committed.
      partial: true, ...(changed.length ? { referencesChanged: true } : {}), referencesPending: true, imageChanged: false,
    })
  }
}

export function createFaceManagement(deps: { getDatabase(): Promise<Db>; getObjectStore(): FaceObjectStore }) {
  async function publish(db: Db, cragId: string, routes: Route[]): Promise<FaceOperationResult> {
    const result: FaceOperationResult = { success: true, routes, routesUpdated: routes.length, routesCleared: routes.length, topoLinesCleared: routes.length }
    try {
      const mediaRevision = randomUUID()
      const update = await db.collection('crags').updateOne({ _id: cragId as unknown as Document['_id'] }, { $set: { mediaRevision, updatedAt: new Date() } })
      if (!update.matchedCount) throw new Error('Missing crag')
      result.mediaRevision = mediaRevision
    } catch {
      result.partial = true; result.revisionPending = true
      result.warning = '内容已更新，但图片版本通知未完成，请刷新核对'
    }
    return result
  }

  return {
    async list(cragId: string): Promise<{ faceId: string; area: string; etag?: string }[]> {
      const store = deps.getObjectStore()
      const faces: { faceId: string; area: string }[] = []
      const prefix = `${cragId}/`
      let token: string | undefined
      do {
        const page = await store.list(prefix, token)
        for (const key of page.keys) {
          const parts = key.slice(prefix.length).split('/')
          if (!key.startsWith(prefix) || parts.length !== 2 || parts[0] === 'faces' || !parts[1].endsWith('.jpg')) continue
          const faceId = parts[1].slice(0, -4)
          if (faceId) faces.push({ area: parts[0], faceId })
        }
        token = page.continuationToken
      } while (token)
      return faces
    },

    async check(key: string): Promise<StoredFace | null> { return deps.getObjectStore().head(key) },

    async rename(face: FaceIdentity, newFaceId: string): Promise<FaceOperationResult> {
      const db = await deps.getDatabase()
      const store = deps.getObjectStore()
      const source = `${getFaceIdentityKey(face)}.jpg`
      const destination = `${getFaceIdentityKey({ ...face, faceId: newFaceId })}.jpg`
      const original = await store.head(source)
      if (!original) throw new FaceOperationError(404, 'FACE_NOT_FOUND', '岩面不存在')
      if (await store.head(destination)) throw new FaceOperationError(409, 'FACE_TARGET_EXISTS', '目标岩面已存在')
      await store.copy(source, destination, original.etag)
      let routes: Route[]
      try { routes = await transformReferences(db, face, { kind: 'rename', newFaceId }) }
      catch (error) {
        // Keep both objects: updateMany/CAS may already have changed some routes.
        await publish(db, face.cragId, [])
        if (error instanceof FaceOperationError) {
          error.details.partial = true; error.details.targetCreated = true
        }
        throw error
      }
      const result = await publish(db, face.cragId, routes)
      try {
        const latest = await store.head(source)
        if (latest && latest.etag !== original.etag) throw new Error('Source changed during rename')
        await store.delete(source)
      } catch {
        result.partial = true; result.cleanupPending = true
        result.warning = '引用已改名，旧图片尚未清理，请刷新后核对'
      }
      return result
    },

    async remove(face: FaceIdentity): Promise<FaceOperationResult> {
      const db = await deps.getDatabase()
      const store = deps.getObjectStore()
      const key = `${getFaceIdentityKey(face)}.jpg`
      const original = await store.head(key)
      // Missing files still need their existing DB references removed.
      let routes: Route[]
      try { routes = await transformReferences(db, face, { kind: 'delete' }) }
      catch (error) { await publish(db, face.cragId, []); throw error }
      const result = await publish(db, face.cragId, routes)
      try {
        const latest = await store.head(key)
        if (latest && (!original || latest.etag !== original.etag)) throw new Error('Image changed during delete')
        if (latest) await store.delete(key)
      } catch {
        result.partial = true; result.cleanupPending = true
        result.warning = '线路引用已清除，图片尚未删除，请刷新后核对'
      }
      return result
    },

    async upload(input: { key: string; cragId: string; face?: FaceIdentity; body: Uint8Array; contentType: string; overwrite: boolean; expectedEtag?: string; clearTopo: boolean }): Promise<FaceOperationResult> {
      const db = await deps.getDatabase()
      const store = deps.getObjectStore()
      const original = await store.head(input.key)
      if (original && !input.overwrite) throw new FaceOperationError(409, 'FACE_TARGET_EXISTS', '图片已存在，请确认覆盖')
      if (input.overwrite && (!original || !input.expectedEtag || original.etag !== input.expectedEtag)) {
        throw new FaceOperationError(409, 'FACE_VERSION_CONFLICT', '图片已变化，请刷新后重新确认覆盖')
      }
      let routes: Route[] = []
      if (input.clearTopo && input.face) {
        try { routes = await transformReferences(db, input.face, { kind: 'clearTopo' }) }
        catch (error) { await publish(db, input.cragId, []); throw error }
      }
      try {
        await store.put(input.key, input.body, { contentType: input.contentType,
          ...(original ? { ifMatch: original.etag } : { ifNoneMatch: '*' as const }) })
      } catch (error) {
        if (error instanceof FaceOperationError && !routes.length) throw error
        // A network failure can arrive after R2 committed the object. Publish a
        // fresh revision and expose uncertainty instead of claiming a rollback.
        await publish(db, input.cragId, routes)
        throw new FaceOperationError(error instanceof FaceOperationError ? error.status : 503,
          'FACE_UPLOAD_PARTIAL', routes.length
            ? '标注已清除，图片替换状态未确认，请刷新后核对'
            : '图片写入状态未确认，请刷新后核对', {
            partial: true, ...(routes.length ? { referencesChanged: true } : {}),
            ...(error instanceof FaceOperationError ? { imageChanged: false } : { imageChangeUnknown: true }),
          })
      }
      return publish(db, input.cragId, routes)
    },
  }
}
