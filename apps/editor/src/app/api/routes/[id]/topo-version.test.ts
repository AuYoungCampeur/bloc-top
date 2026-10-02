import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { isDeepStrictEqual } from 'node:util'
import type { Db, Document } from 'mongodb'
import { createFaceManagement, type FaceObjectStore } from '@bloctop/shared/face-management'

const state = vi.hoisted(() => ({ db: null as unknown, authenticated: true, allowed: true }))
vi.mock('@bloctop/shared/mongodb', () => ({ getDatabase: async () => state.db }))
vi.mock('@/lib/require-auth', () => ({ requireAuth: async () => state.authenticated
  ? { userId: 'fixture-user', role: 'user' } : NextResponse.json({ success: false }, { status: 401 }) }))
vi.mock('@bloctop/shared/permissions', () => ({ canEditCrag: async () => state.allowed }))
vi.mock('@bloctop/shared/logger', () => ({ createModuleLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) }))
vi.mock('@/lib/revalidate-pwa', () => ({ revalidateCragPages: vi.fn(async () => {}) }))

// Keep the real handler, Topo parser, DAL and face service; only Mongo transport,
// authentication and publication are fixtures. Mongo predicates execute below.
import { GET, PATCH } from './route'

const line = [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.9 }]
const annotation = { faceId: 'wall', area: 'B', topoLine: line }
const face = { cragId: 'fixture-crag', area: 'B', faceId: 'wall' }
const context = () => ({ params: Promise.resolve({ id: '42' }) })
function request(body: unknown) {
  return new NextRequest('http://localhost/api/routes/42', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
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
function fixture(version?: number) {
  const docs: Document[] = [{ _id: 42, name: 'Fixture', grade: 'V1', cragId: face.cragId, area: 'A',
    faceId: 'wall', faceArea: 'B', topoLine: line, topoAnnotations: [annotation], ...(version === undefined ? {} : { topoVersion: version }) }]
  const updates: Document[] = []
  const routes = {
    findOne: async (filter: Document) => structuredClone(docs.find(doc => matches(doc, filter)) ?? null),
    find: (filter: Document) => ({ toArray: async () => structuredClone(docs.filter(doc => matches(doc, filter))) }),
    findOneAndUpdate: async (filter: Document, update: Document) => {
      const doc = docs.find(doc => matches(doc, filter))
      if (!doc) return null
      updates.push(update)
      Object.assign(doc, structuredClone(update.$set))
      for (const field of Object.keys(update.$unset ?? {})) delete doc[field]
      for (const [field, value] of Object.entries(update.$inc ?? {})) doc[field] = (doc[field] ?? 0) + (value as number)
      return structuredClone(doc)
    },
  }
  const db = { collection: (name: string) => name === 'routes' ? routes : { updateOne: async () => ({ matchedCount: 1 }) } } as unknown as Db
  state.db = db
  const objects = new Map([['fixture-crag/B/wall.jpg', { etag: 'original', contentType: 'image/jpeg' }]])
  const store: FaceObjectStore = {
    head: async key => objects.get(key) ?? null, list: async () => ({ keys: [...objects.keys()] }),
    copy: async (source, target) => { objects.set(target, { ...objects.get(source)!, etag: 'copied' }) },
    put: async () => {}, delete: async key => { objects.delete(key) },
  }
  const management = createFaceManagement({ getDatabase: async () => db, getObjectStore: () => store })
  return { docs, updates, management }
}

beforeEach(() => { state.authenticated = true; state.allowed = true; state.db = null })

describe('route Topo protocol through the real NextRequest wrapper', () => {
  it('GET exposes historical 0 without modifying the stored document', async () => {
    const f = fixture()
    const response = await GET(new NextRequest('http://localhost/api/routes/42'), context())
    expect((await response.json()).route.topoVersion).toBe(0)
    expect(f.docs[0]).not.toHaveProperty('topoVersion')
  })
  it.each(['rename', 'delete'] as const)('rejects the late old draft after face %s and returns the authoritative record', async operation => {
    const f = fixture()
    if (operation === 'rename') await f.management.rename(face, 'new-wall')
    else await f.management.remove(face)
    const committed = structuredClone(f.docs[0])
    const response = await PATCH(request({ expectedTopoVersion: 0, topoAnnotations: [annotation] }), context())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ success: false, code: 'TOPO_VERSION_CONFLICT', topoVersion: 1,
      route: { topoVersion: 1, topoAnnotations: committed.topoAnnotations } })
    expect(f.docs[0]).toEqual(committed)
  })
  it('rejects a changed Topo without a version, but permits metadata without incrementing it', async () => {
    const f = fixture(5)
    const rejected = await PATCH(request({ topoAnnotations: [] }), context())
    expect(rejected.status).toBe(428)
    expect((await rejected.json()).code).toBe('TOPO_VERSION_REQUIRED')
    expect(f.updates).toHaveLength(0)
    const accepted = await PATCH(request({ name: 'New name' }), context())
    expect(accepted.status).toBe(200)
    expect((await accepted.json()).route).toMatchObject({ name: 'New name', topoVersion: 5 })
    expect(f.docs[0].topoAnnotations).toEqual([annotation])
  })
  it('increments one version on a successful clear, including legacy unsets', async () => {
    const f = fixture()
    const response = await PATCH(request({ expectedTopoVersion: 0, topoAnnotations: [] }), context())
    expect(response.status).toBe(200)
    expect((await response.json()).route).toMatchObject({ topoVersion: 1, topoAnnotations: [] })
    expect(f.docs[0]).not.toHaveProperty('faceId')
    expect(f.docs[0]).not.toHaveProperty('topoLine')
  })
  it('allows exactly one of two drafts with the same expected version', async () => {
    fixture()
    const responses = await Promise.all([
      PATCH(request({ expectedTopoVersion: 0, topoAnnotations: [] }), context()),
      PATCH(request({ expectedTopoVersion: 0, topoAnnotations: [{ ...annotation, topoTension: 0.8 }] }), context()),
    ])
    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
  })
  it('checks authentication and crag permission before permitting a Topo write', async () => {
    const f = fixture()
    state.authenticated = false
    expect((await PATCH(request({ expectedTopoVersion: 0, topoAnnotations: [] }), context())).status).toBe(401)
    state.authenticated = true; state.allowed = false
    expect((await PATCH(request({ expectedTopoVersion: 0, topoAnnotations: [] }), context())).status).toBe(403)
    expect(f.updates).toHaveLength(0)
  })
})
