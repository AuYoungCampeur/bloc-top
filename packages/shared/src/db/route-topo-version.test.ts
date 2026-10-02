import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isDeepStrictEqual } from 'node:util'
import type { Db, Document } from 'mongodb'
import type { Route } from '../types'
import { createFaceManagement, type FaceObjectStore } from '../face-management'
import { getRouteTopoVersion, hasRouteTopoChanges } from '../route-topo-version'

const mockDatabase = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('../mongodb', () => ({ getDatabase: async () => mockDatabase.current }))
vi.mock('../logger', () => ({ createModuleLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) }))
import { getRouteById, updateRoute } from './index'

const line = [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.9 }]
const changedLine = [{ x: 0.2, y: 0.3 }, { x: 0.7, y: 0.8 }]
const face = { cragId: 'crag', area: 'B', faceId: 'wall' }
const annotation = { area: 'B', faceId: 'wall', topoLine: line }
const record = (overrides: Document = {}): Document => ({ _id: 42, cragId: 'crag', area: 'A', name: 'Route', grade: 'V1',
  faceId: 'wall', faceArea: 'B', topoLine: line, topoAnnotations: [annotation], ...overrides })

function matches(doc: Document, filter: Document): boolean {
  return Object.entries(filter).every(([field, expected]) => {
    if (field === '$or') return expected.some((branch: Document) => matches(doc, branch))
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if ('$exists' in expected) return Object.hasOwn(doc, field) === expected.$exists
      if ('$elemMatch' in expected) return Array.isArray(doc[field]) && doc[field].some((item: Document) => matches(item, expected.$elemMatch))
    }
    return isDeepStrictEqual(doc[field], expected)
  })
}

/** Execute the actual Mongo predicates, $set/$unset and atomic $inc used by both writers. */
function database(initial = [record()]) {
  const docs = structuredClone(initial)
  const controls: { beforeUpdate?: () => void | Promise<void> } = {}
  const routes = {
    findOne: vi.fn(async (filter: Document) => structuredClone(docs.find(doc => matches(doc, filter)) ?? null)),
    find: (filter: Document) => ({ toArray: async () => structuredClone(docs.filter(doc => matches(doc, filter))) }),
    findOneAndUpdate: vi.fn(async (filter: Document, update: Document) => {
      const before = controls.beforeUpdate
      controls.beforeUpdate = undefined
      await before?.()
      const target = docs.find(doc => matches(doc, filter))
      if (!target) return null
      Object.assign(target, structuredClone(update.$set))
      for (const field of Object.keys(update.$unset ?? {})) delete target[field]
      for (const [field, amount] of Object.entries(update.$inc ?? {})) target[field] = (target[field] ?? 0) + (amount as number)
      return structuredClone(target)
    }),
  }
  const objects = new Map([['crag/B/wall.jpg', { etag: 'original', contentType: 'image/jpeg' }]])
  const store: FaceObjectStore = {
    head: async key => objects.get(key) ?? null,
    list: async () => ({ keys: [...objects.keys()] }),
    copy: async (source, target) => { objects.set(target, { ...objects.get(source)!, etag: 'copied' }) },
    put: async () => {}, delete: async key => { objects.delete(key) },
  }
  const db = { collection: (name: string) => name === 'routes' ? routes : { updateOne: async () => ({ matchedCount: 1 }) } } as unknown as Db
  mockDatabase.current = db
  return { docs, routes, controls, management: createFaceManagement({ getDatabase: async () => db, getObjectStore: () => store }) }
}

beforeEach(() => { mockDatabase.current = null })

describe('Topo version compatibility', () => {
  it('returns historical version 0 without writing a backfill', async () => {
    const fixture = database()
    expect((await getRouteById(42))?.topoVersion).toBe(0)
    expect(fixture.docs[0]).not.toHaveProperty('topoVersion')
    expect(fixture.routes.findOneAndUpdate).not.toHaveBeenCalled()
  })
  it('advances historical missing version and explicit zero to 1 in the same document write', async () => {
    for (const overrides of [{}, { topoVersion: 0 }]) {
      const fixture = database([record(overrides)])
      const route = await updateRoute(42, { topoAnnotations: [{ ...annotation, topoLine: changedLine }] }, { expectedTopoVersion: 0 })
      expect(route?.topoVersion).toBe(1)
      expect(fixture.docs[0].topoLine).toEqual(changedLine)
      expect(fixture.routes.findOneAndUpdate.mock.calls[0][1].$inc).toEqual({ topoVersion: 1 })
    }
  })
  it('rejects an actual legacy Topo mutation without a version, with an authoritative 428', async () => {
    const fixture = database([record({ topoVersion: 3 })])
    await expect(updateRoute(42, { topoLine: changedLine })).rejects.toMatchObject({ status: 428, code: 'TOPO_VERSION_REQUIRED', route: { topoVersion: 3 } })
    expect(fixture.routes.findOneAndUpdate).not.toHaveBeenCalled()
    expect(fixture.docs[0].topoLine).toEqual(line)
  })
  it('keeps metadata-only changes and repeated identical Topo payloads at the existing version', async () => {
    const fixture = database([record({ topoVersion: 3 })])
    expect((await updateRoute(42, { name: 'New name' }, { expectedTopoVersion: 0 }))?.topoVersion).toBe(3)
    expect((await updateRoute(42, { name: 'Another name', topoAnnotations: [annotation] }))?.topoVersion).toBe(3)
    expect(fixture.docs[0].name).toBe('Another name')
    for (const [, update] of fixture.routes.findOneAndUpdate.mock.calls) {
      expect(update).not.toHaveProperty('$inc')
      expect(update.$set).not.toHaveProperty('topoAnnotations')
    }
  })
  it('rejects an explicitly stale version even when its Topo payload happens to equal the current one', async () => {
    database([record({ topoVersion: 3 })])
    await expect(updateRoute(42, { topoAnnotations: [annotation] }, { expectedTopoVersion: 2 })).rejects.toMatchObject({ status: 409, route: { topoVersion: 3 } })
  })
  it('ignores object property order when determining whether an unchanged Topo payload needs a version', () => {
    const route = { id: 42, ...record() } as unknown as Route
    expect(hasRouteTopoChanges(route, { topoAnnotations: [{ topoLine: line.map(p => ({ y: p.y, x: p.x })), faceId: 'wall', area: 'B' }] })).toBe(false)
    expect(getRouteTopoVersion(route)).toBe(0)
  })
  it.each([-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1])('refuses invalid expected version %s', async expectedTopoVersion => {
    database()
    await expect(updateRoute(42, { topoLine: changedLine }, { expectedTopoVersion })).rejects.toThrow('非负安全整数')
  })
})

describe('late drafts and concurrent writers', () => {
  it.each(['rename', 'delete'] as const)('a late draft cannot restore references after face %s', async operation => {
    const fixture = database()
    if (operation === 'rename') await fixture.management.rename(face, 'new-wall')
    else await fixture.management.remove(face)
    const committed = structuredClone(fixture.docs[0])
    expect(committed.topoVersion).toBe(1)
    await expect(updateRoute(42, { topoAnnotations: [annotation] }, { expectedTopoVersion: 0 })).rejects.toMatchObject({ status: 409, code: 'TOPO_VERSION_CONFLICT', route: { topoVersion: 1 } })
    await expect(updateRoute(42, { topoAnnotations: [annotation] })).rejects.toMatchObject({ status: 428 })
    expect(fixture.docs[0]).toEqual(committed)
  })
  it('detects face deletion between the draft read and its conditional write', async () => {
    const fixture = database()
    fixture.controls.beforeUpdate = () => fixture.management.remove(face).then(() => {})
    await expect(updateRoute(42, { topoAnnotations: [{ ...annotation, topoLine: changedLine }] }, { expectedTopoVersion: 0 })).rejects.toMatchObject({ status: 409, route: { topoVersion: 1, topoAnnotations: [] } })
    expect(fixture.docs[0]).not.toHaveProperty('faceId')
    expect(fixture.docs[0].topoAnnotations).toEqual([])
  })
  it('allows one of two drafts with the same baseline and rejects the other', async () => {
    const fixture = database()
    const results = await Promise.allSettled([
      updateRoute(42, { topoAnnotations: [{ ...annotation, topoLine: changedLine }] }, { expectedTopoVersion: 0 }),
      updateRoute(42, { topoAnnotations: [{ ...annotation, topoTension: 0.8 }] }, { expectedTopoVersion: 0 }),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toMatchObject([{ reason: { status: 409 } }])
    expect(fixture.docs[0].topoVersion).toBe(1)
  })
  it('preserves a concurrent Beta write without advancing Topo twice', async () => {
    const fixture = database()
    fixture.controls.beforeUpdate = () => { fixture.docs[0].betaLinks = [{ id: 'new-beta' }] }
    await updateRoute(42, { topoAnnotations: [{ ...annotation, topoLine: changedLine }] }, { expectedTopoVersion: 0 })
    expect(fixture.docs[0]).toMatchObject({ topoVersion: 1, betaLinks: [{ id: 'new-beta' }] })
  })
  it('an area metadata write retries legacy faceArea materialization after a concurrent rename', async () => {
    const legacy = record()
    delete legacy.faceArea; delete legacy.topoAnnotations
    legacy.area = 'B'
    const fixture = database([legacy])
    fixture.controls.beforeUpdate = () => fixture.management.rename(face, 'new-wall').then(() => {})
    const route = await updateRoute(42, { area: 'C' })
    expect(route).toMatchObject({ area: 'C', faceArea: 'B', faceId: 'new-wall', topoVersion: 1 })
    expect(fixture.docs[0].topoVersion).toBe(1)
  })
  it('a metadata-only area change materializes legacy identity without incrementing its version', async () => {
    const legacy = record()
    delete legacy.faceArea; delete legacy.topoAnnotations
    legacy.area = 'B'
    const fixture = database([legacy])
    expect(await updateRoute(42, { area: 'C' })).toMatchObject({ area: 'C', faceArea: 'B', topoVersion: 0 })
    expect(fixture.docs[0]).not.toHaveProperty('topoVersion')
  })
  it('returns missing-route null when a concurrent deletion removes the document', async () => {
    const fixture = database()
    fixture.controls.beforeUpdate = () => { fixture.docs.splice(0) }
    expect(await updateRoute(42, { topoLine: changedLine }, { expectedTopoVersion: 0 })).toBeNull()
  })
})
