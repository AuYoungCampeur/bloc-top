import { describe, expect, it, vi } from 'vitest'
import { isDeepStrictEqual } from 'node:util'
import type { Db, Document } from 'mongodb'
import { createFaceManagement, FaceOperationError, parseFaceIdentity, type FaceObjectStore } from './face-management'

const line = [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }]
const face = { cragId: 'crag', area: 'B', faceId: 'wall' }
const source = 'crag/B/wall.jpg'
const destination = 'crag/B/new.jpg'
const annotation = (area: string, faceId = 'wall') => ({ area, faceId, topoLine: line })
const record = (id: number, overrides: Document = {}): Document => ({ _id: id, cragId: 'crag', area: 'A', name: `route${id}`, grade: 'V1', ...overrides })

/** Interpret the actual Mongo filter/update operators used by the service. */
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

function fixture(initial: Document[]) {
  const docs = structuredClone(initial)
  const objects = new Map<string, { etag: string; contentType: string }>([[source, { etag: 'original', contentType: 'image/png' }]])
  const events: string[] = []
  const controls: { beforeUpdate?: (doc: Document) => void; failUpdateAt?: number; failDelete?: boolean; failPut?: boolean; raceCopy?: boolean; failRevision?: boolean } = {}
  let updates = 0
  const routes = {
    find: (query: Document) => ({ toArray: async () => structuredClone(docs.filter(d => matches(d, query))) }),
    findOne: async (query: Document) => structuredClone(docs.find(d => matches(d, query)) ?? null),
    findOneAndUpdate: vi.fn(async (query: Document, update: Document) => {
      events.push('db-update'); updates++
      if (controls.failUpdateAt === updates) throw new Error('Mongo update failed')
      const candidate = docs.find(d => d._id === query._id)
      if (candidate) controls.beforeUpdate?.(candidate)
      const target = docs.find(d => matches(d, query))
      if (!target) return null
      Object.assign(target, structuredClone(update.$set))
      for (const field of Object.keys(update.$unset ?? {})) delete target[field]
      for (const [field, amount] of Object.entries(update.$inc ?? {})) target[field] = (target[field] ?? 0) + (amount as number)
      return structuredClone(target)
    }),
  }
  const crags = { updateOne: vi.fn(async () => {
    events.push('revision')
    if (controls.failRevision) throw new Error('Revision write failed')
    return { matchedCount: 1 }
  }) }
  const db = { collection: (name: string) => name === 'routes' ? routes : crags } as unknown as Db
  const store: FaceObjectStore = {
    head: vi.fn(async key => objects.get(key) ?? null),
    list: vi.fn(async () => ({ keys: [...objects.keys()] })),
    copy: vi.fn(async (from, to, etag) => {
      events.push('copy')
      if (controls.raceCopy) objects.set(to, { etag: 'someone-else', contentType: 'image/jpeg' })
      if (objects.get(from)?.etag !== etag || objects.has(to)) throw new FaceOperationError(409, 'FACE_VERSION_CONFLICT', 'Conflict')
      objects.set(to, { ...objects.get(from)!, etag: 'copied' })
    }),
    put: vi.fn(async (key, _body, options) => {
      events.push('put')
      if (controls.failPut) throw new Error('R2 put failed')
      if ((options.ifNoneMatch && objects.has(key)) || (options.ifMatch && objects.get(key)?.etag !== options.ifMatch)) throw new FaceOperationError(409, 'FACE_VERSION_CONFLICT', 'Conflict')
      objects.set(key, { etag: 'uploaded', contentType: options.contentType })
    }),
    delete: vi.fn(async key => { events.push('delete'); if (controls.failDelete) throw new Error('R2 delete failed'); objects.delete(key) }),
  }
  return { management: createFaceManagement({ getDatabase: async () => db, getObjectStore: () => store }), db, routes, crags, store, docs, objects, controls, events }
}

describe('face management identity, concurrency and partial failure', () => {
  it('renames cross-area first and later annotations without touching same names elsewhere', async () => {
    const f = fixture([record(1, { faceId: 'wall', topoAnnotations: [annotation('B'), annotation('C')] }),
      record(2, { faceId: 'wall', topoLine: line }), record(3, { topoAnnotations: [annotation('A'), annotation('B')] })])
    const result = await f.management.rename(face, 'new')
    expect(result.routesUpdated).toBe(2)
    expect(f.docs[0]).toMatchObject({ faceId: 'new', faceArea: 'B', topoAnnotations: [{ area: 'B', faceId: 'new' }, { area: 'C', faceId: 'wall' }] })
    expect(f.docs[1]).toEqual(record(2, { faceId: 'wall', topoLine: line }))
    expect(f.docs[2].topoAnnotations[1].faceId).toBe('new')
    expect(result.routes.map(route => route.topoVersion)).toEqual([1, 1])
    expect(f.docs[1]).not.toHaveProperty('topoVersion')
    expect(f.objects.has(source)).toBe(false)
    expect(f.events.indexOf('db-update')).toBeGreaterThan(f.events.indexOf('copy'))
    expect(f.events.indexOf('delete')).toBeGreaterThan(f.events.lastIndexOf('db-update'))
  })
  it('a Beta change between read and CAS survives the reference update', async () => {
    const f = fixture([record(1, { topoAnnotations: [annotation('B')] })])
    f.controls.beforeUpdate = doc => { doc.betaLinks = [{ id: 'concurrent-beta' }] }
    await f.management.rename(face, 'new')
    expect(f.docs[0].betaLinks).toEqual([{ id: 'concurrent-beta' }])
    expect(f.routes.findOneAndUpdate.mock.calls[0][0]).not.toHaveProperty('betaLinks')
  })
  it('retries a changed Topo snapshot instead of overwriting a concurrently added third image', async () => {
    const f = fixture([record(1, { topoAnnotations: [annotation('B'), annotation('C')] })])
    f.controls.beforeUpdate = doc => { doc.topoAnnotations.push(annotation('D')); f.controls.beforeUpdate = undefined }
    await f.management.rename(face, 'new')
    expect(f.routes.findOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(f.docs[0].topoAnnotations.map((a: Document) => a.area)).toEqual(['B', 'C', 'D'])
  })
  it('deletes only target annotations and projects surviving first, retaining other areas', async () => {
    const f = fixture([record(1, { faceId: 'wall', topoLine: line, topoTension: 0.8, topoAnnotations: [annotation('B'), annotation('C', 'other')] }), record(2, { faceId: 'wall', topoLine: line })])
    await f.management.remove(face)
    expect(f.docs[0]).toMatchObject({ faceId: 'other', faceArea: 'C', topoAnnotations: [annotation('C', 'other')] })
    expect(f.docs[0]).not.toHaveProperty('topoTension')
    expect(f.docs[1].topoLine).toEqual(line)
    expect(f.events.indexOf('db-update')).toBeLessThan(f.events.indexOf('delete'))
  })
  it('removes all compatibility fields when deleting the last image', async () => {
    const f = fixture([record(1, { faceId: 'wall', faceArea: 'B', topoLine: line, topoTension: 0.7, topoAnnotations: [annotation('B')] })])
    await f.management.remove(face)
    for (const key of ['faceId', 'faceArea', 'topoLine', 'topoTension']) expect(f.docs[0]).not.toHaveProperty(key)
    expect(f.docs[0].topoAnnotations).toEqual([])
    expect(f.docs[0].topoVersion).toBe(1)
  })
  it('DB rename failure keeps both files and exposes a partial target creation', async () => {
    const f = fixture([record(1, { topoAnnotations: [annotation('B')] })])
    f.controls.failUpdateAt = 1
    await expect(f.management.rename(face, 'new')).rejects.toMatchObject({ status: 503, details: { partial: true, targetCreated: true, imageChanged: false } })
    expect(f.objects.has(source)).toBe(true)
    expect(f.objects.has(destination)).toBe(true)
    expect(f.store.delete).not.toHaveBeenCalled()
  })
  it('partial DB deletion keeps the file and exposes changed references', async () => {
    const f = fixture([record(1, { topoAnnotations: [annotation('B')] }), record(2, { topoAnnotations: [annotation('B')] })])
    f.controls.failUpdateAt = 2
    await expect(f.management.remove(face)).rejects.toMatchObject({ details: { partial: true, referencesChanged: true, imageChanged: false } })
    expect(f.objects.has(source)).toBe(true)
    expect(f.store.delete).not.toHaveBeenCalled()
    expect(f.crags.updateOne).toHaveBeenCalled()
  })
  it.each(['rename', 'remove'] as const)('R2 cleanup failure after %s reports committed references instead of total failure', async operation => {
    const f = fixture([record(1, { topoAnnotations: [annotation('B')] })])
    f.controls.failDelete = true
    const result = operation === 'rename' ? await f.management.rename(face, 'new') : await f.management.remove(face)
    expect(result).toMatchObject({ success: true, partial: true, cleanupPending: true, routesUpdated: 1 })
    expect(result.routes).toHaveLength(1)
  })
  it('existing rename target is 409 without modifying either file or any route', async () => {
    const f = fixture([record(1, { topoAnnotations: [annotation('B')] })])
    f.objects.set(destination, { etag: 'target', contentType: 'image/jpeg' })
    await expect(f.management.rename(face, 'new')).rejects.toMatchObject({ status: 409, code: 'FACE_TARGET_EXISTS' })
    expect(f.store.copy).not.toHaveBeenCalled()
    expect(f.routes.findOneAndUpdate).not.toHaveBeenCalled()
  })
  it('destination race is blocked by copy condition after a successful HEAD absence check', async () => {
    const f = fixture([record(1, { topoAnnotations: [annotation('B')] })])
    f.controls.raceCopy = true
    await expect(f.management.rename(face, 'new')).rejects.toMatchObject({ status: 409 })
    expect(f.objects.get(destination)?.etag).toBe('someone-else')
    expect(f.routes.findOneAndUpdate).not.toHaveBeenCalled()
  })
  it('creating cannot silently overwrite; an explicit stale confirmation is also rejected', async () => {
    const f = fixture([])
    const upload = { key: source, cragId: 'crag', face, body: new Uint8Array([1]), contentType: 'image/webp', overwrite: false, clearTopo: false }
    await expect(f.management.upload(upload)).rejects.toMatchObject({ status: 409 })
    await expect(f.management.upload({ ...upload, overwrite: true, expectedEtag: 'stale' })).rejects.toMatchObject({ code: 'FACE_VERSION_CONFLICT' })
    expect(f.store.put).not.toHaveBeenCalled()
  })
  it('clears geometry before conditional overwrite, keeps other images and actual content type', async () => {
    const f = fixture([record(1, { topoAnnotations: [annotation('B'), annotation('C')] })])
    const result = await f.management.upload({ key: source, cragId: 'crag', face, body: new Uint8Array([1]), contentType: 'image/webp', overwrite: true, expectedEtag: 'original', clearTopo: true })
    expect(f.docs[0].topoAnnotations).toEqual([annotation('C')])
    expect(f.store.put).toHaveBeenCalledWith(source, new Uint8Array([1]), { contentType: 'image/webp', ifMatch: 'original' })
    expect(f.events.indexOf('db-update')).toBeLessThan(f.events.indexOf('put'))
    expect(result.mediaRevision).toEqual(expect.any(String))
  })
  it('clear succeeded but image replacement failed is explicitly partial, with old image intact', async () => {
    const f = fixture([record(1, { topoAnnotations: [annotation('B')] })])
    f.controls.failPut = true
    await expect(f.management.upload({ key: source, cragId: 'crag', face, body: new Uint8Array([1]), contentType: 'image/jpeg', overwrite: true, expectedEtag: 'original', clearTopo: true })).rejects.toMatchObject({ code: 'FACE_UPLOAD_PARTIAL', details: { partial: true, referencesChanged: true, imageChangeUnknown: true } })
    expect(f.objects.get(source)?.etag).toBe('original')
    expect(f.docs[0]).toMatchObject({ faceId: 'wall', faceArea: 'B', topoAnnotations: [] })
    expect(f.docs[0]).not.toHaveProperty('topoLine')
  })
  it('revision publication failure is visible after a successful image write', async () => {
    const f = fixture([])
    f.controls.failRevision = true
    const result = await f.management.upload({ key: 'crag/B/another.jpg', cragId: 'crag', face, body: new Uint8Array([1]), contentType: 'image/jpeg', overwrite: false, clearTopo: false })
    expect(result).toMatchObject({ success: true, partial: true, revisionPending: true })
    expect(f.objects.has('crag/B/another.jpg')).toBe(true)
    expect(f.store.put).toHaveBeenCalledWith('crag/B/another.jpg', expect.any(Uint8Array), { contentType: 'image/jpeg', ifNoneMatch: '*' })
  })
  it('listing follows continuation tokens and preserves raw Unicode identities', async () => {
    const f = fixture([])
    vi.mocked(f.store.list).mockResolvedValueOnce({ keys: ['crag/北 区/岩面.jpg'], continuationToken: 'next' }).mockResolvedValueOnce({ keys: ['crag/B/wall.jpg'] })
    expect(await f.management.list('crag')).toEqual([{ area: '北 区', faceId: '岩面' }, { area: 'B', faceId: 'wall' }])
    expect(f.store.list).toHaveBeenLastCalledWith('crag/', 'next')
  })
  it.each(['../a', 'a/b', 'a\\b', '%2f', '', ' padded ', null, {}])('rejects unsafe identity %j before building a storage key', invalid => {
    expect(() => parseFaceIdentity({ ...face, area: invalid })).toThrow(FaceOperationError)
  })
})
