import { describe, expect, it } from 'vitest'
import type { Db, Document } from 'mongodb'
import { allocateRouteId } from './route-id'

function database(routeIds: number[], initial?: number) {
  let counter: Document | null = initial === undefined ? null : { _id: 'route-id', seq: initial }
  let bootstrapReads = 0
  const counters = {
    findOne: async () => counter ? { ...counter } : null,
    insertOne: async (doc: Document) => {
      if (counter) throw Object.assign(new Error('Duplicate initializer'), { code: 11000 })
      counter = { ...doc }; return { insertedId: doc._id }
    },
    findOneAndUpdate: async (filter: Document, update: Document) => {
      // Interpret $gte/$lt and $inc atomically, just as the server command does.
      if (!counter || counter._id !== filter._id || counter.seq < filter.seq.$gte || counter.seq >= filter.seq.$lt) return null
      counter.seq += update.$inc.seq
      return { ...counter }
    },
  }
  const routes = { find: () => {
    bootstrapReads++
    return { sort: () => ({ limit: () => ({ toArray: async () => routeIds.length ? [{ _id: Math.max(...routeIds) }] : [] }) }) }
  } }
  const db = { collection: (name: string) => name === 'counters' ? counters : routes } as unknown as Db
  return { db, routeIds, reads: () => bootstrapReads, counter: () => counter }
}

describe('durable route ID allocation', () => {
  it('concurrent first-time allocation handles duplicate initialization and returns unique IDs', async () => {
    const fixture = database([1, 100])
    const ids = await Promise.all(Array.from({ length: 32 }, () => allocateRouteId(fixture.db)))
    expect([...ids].sort((a, b) => a - b)).toEqual(Array.from({ length: 32 }, (_, i) => i + 101))
    expect(new Set(ids).size).toBe(32)
    expect(fixture.counter()?.seq).toBe(132)
  })
  it('deleting the highest route does not reuse an allocated ID or rebootstrap from current max', async () => {
    const fixture = database([1, 100])
    expect(await allocateRouteId(fixture.db)).toBe(101)
    fixture.routeIds.length = 0
    expect(await allocateRouteId(fixture.db)).toBe(102)
    expect(fixture.reads()).toBe(1)
  })
  it('failed caller insert leaves an intentional gap, never releasing the reservation', async () => {
    const fixture = database([], 500)
    const unused = await allocateRouteId(fixture.db)
    expect(unused).toBe(501)
    expect(await allocateRouteId(fixture.db)).toBe(502)
    expect(fixture.reads()).toBe(0)
  })
  it('empty legacy database starts at 1; unknown historical deleted IDs are outside bootstrap evidence', async () => {
    expect(await allocateRouteId(database([]).db)).toBe(1)
  })
  it('refuses exhaustion rather than producing unsafe or duplicate numbers', async () => {
    const fixture = database([], Number.MAX_SAFE_INTEGER)
    await expect(allocateRouteId(fixture.db)).rejects.toThrow('invalid or exhausted')
    expect(fixture.counter()?.seq).toBe(Number.MAX_SAFE_INTEGER)
  })
})
