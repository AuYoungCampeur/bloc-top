import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId, type Db } from 'mongodb'
import type { CragPermission } from '../types'
import { getCragGrantId, getCragGrantUserFilter, normalizeCragGrantUserId } from '../crag-grant'

const mockDatabase = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('../mongodb', () => ({ getDatabase: async () => mockDatabase.current }))
vi.mock('../logger', () => ({ createModuleLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) }))

import { createCragPermission, deleteCragPermission, getCragPermission, getCragPermissionsByUserId } from './index'

type Grant = CragPermission & { _id: string | ObjectId }
type UserMatch = ReturnType<typeof getCragGrantUserFilter>
type GrantFilter = { userId: UserMatch; cragId?: string }
const USER_ID = 'abcdef1234567890abcdef12'
const INPUT: Omit<CragPermission, 'createdAt'> = { userId: USER_ID, cragId: 'crag-1', role: 'manager', assignedBy: 'admin-1' }

function legacyGrant(overrides: Partial<Grant> = {}): Grant {
  return { ...INPUT, _id: new ObjectId(), createdAt: new Date('2025-01-01'), ...overrides }
}

function matches(doc: Grant, filter: GrantFilter): boolean {
  const userMatches = typeof filter.userId === 'string'
    ? doc.userId === filter.userId
    : filter.userId.$in.some(candidate => candidate instanceof RegExp ? candidate.test(doc.userId) : candidate === doc.userId)
  return userMatches && (filter.cragId === undefined || doc.cragId === filter.cragId)
}

/** Interpret the Mongo filter and $setOnInsert, with only the built-in _id constraint. */
function database(initial: Grant[] = [], race = false) {
  const records = [...initial]
  const updateOne = vi.fn(async (filter: GrantFilter, update: { $setOnInsert: Grant }, options: { upsert: boolean }) => {
    if (records.some(doc => matches(doc, filter))) {
      return { matchedCount: 1, modifiedCount: 0, upsertedCount: 0 }
    }
    // Model concurrent upserts that both found no legacy match before attempting insertion.
    if (race) await Promise.resolve()
    if (!options.upsert) throw new Error('Expected an upsert')
    const doc = update.$setOnInsert
    if (records.some(existing => existing._id === doc._id)) {
      throw Object.assign(new Error('E11000 duplicate key on _id'), { code: 11000 })
    }
    records.push({ ...doc })
    return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: doc._id }
  })
  const deleteMany = vi.fn(async (filter: GrantFilter) => {
    let deletedCount = 0
    for (let i = records.length - 1; i >= 0; i--) {
      if (matches(records[i], filter)) { records.splice(i, 1); deletedCount++ }
    }
    return { deletedCount }
  })
  const findOne = vi.fn(async (filter: GrantFilter) => records.find(doc => matches(doc, filter)) ?? null)
  const find = vi.fn((filter: GrantFilter) => ({ sort: () => ({ toArray: async () => records.filter(doc => matches(doc, filter)) }) }))
  const db = { collection: vi.fn((name: string) => {
    if (name !== 'crag_permissions') throw new Error(`Unexpected collection ${name}`)
    return { updateOne, deleteMany, findOne, find }
  }) } as unknown as Db
  mockDatabase.current = db
  return { records, updateOne, deleteMany, findOne, find }
}

beforeEach(() => { mockDatabase.current = null })

describe('crag grant identity', () => {
  it('canonicalizes ObjectId spelling and keeps opaque IDs case-sensitive', () => {
    expect(getCragGrantId(USER_ID.toUpperCase(), 'crag-1')).toBe(getCragGrantId(USER_ID, 'crag-1'))
    expect(normalizeCragGrantUserId('User-1')).toBe('User-1')
    expect(getCragGrantUserFilter('User-1')).toBe('User-1')
    expect(getCragGrantId('User-1', 'crag-1')).not.toBe(getCragGrantId('user-1', 'crag-1'))
  })

  it('keeps delimiter-containing identities distinct', () => {
    expect(getCragGrantId('a:b', 'c')).not.toBe(getCragGrantId('a', 'b:c'))
    expect(getCragGrantId('a%3Ab', 'c')).not.toBe(getCragGrantId('a:b', 'c'))
  })
})

describe('grant creation without a compound unique index', () => {
  it('persists canonical fields explicitly, returns the public shape, and reads the stable ID record', async () => {
    const fixture = database()
    const created = await createCragPermission({ ...INPUT, userId: USER_ID.toUpperCase() })
    expect(created).toEqual({ ...INPUT, createdAt: expect.any(Date) })
    expect(created).not.toHaveProperty('_id')
    expect(fixture.records).toEqual([{ ...created, _id: getCragGrantId(USER_ID, INPUT.cragId) }])
    expect(fixture.updateOne).toHaveBeenCalledWith(
      { userId: getCragGrantUserFilter(USER_ID), cragId: INPUT.cragId },
      { $setOnInsert: { ...created, _id: getCragGrantId(USER_ID, INPUT.cragId) } },
      { upsert: true }
    )
    expect(await getCragPermission(USER_ID, INPUT.cragId)).toEqual(created)
  })

  it('concurrent equivalent ObjectId requests create exactly one grant; losing requests are conflicts', async () => {
    const fixture = database([], true)
    const results = await Promise.allSettled(Array.from({ length: 16 }, (_, i) => createCragPermission({
      ...INPUT, userId: i % 2 ? USER_ID.toUpperCase() : USER_ID,
    })))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.filter(result => result.status === 'rejected')
    expect(rejected).toHaveLength(15)
    for (const result of rejected) {
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ name: 'CragPermissionConflictError', code: 11000 })
    }
    expect(fixture.records).toHaveLength(1)
    expect(fixture.records[0]._id).toBe(getCragGrantId(USER_ID, INPUT.cragId))
  })

  it.each([USER_ID, USER_ID.toUpperCase(), 'AbCdEf1234567890aBcDeF12'])('rejects an existing legacy ObjectId grant with spelling %s without altering it', async spelling => {
    const existing = legacyGrant({ userId: spelling })
    const fixture = database([existing])
    await expect(createCragPermission(INPUT)).rejects.toMatchObject({ code: 11000, message: '权限记录已存在' })
    expect(fixture.records).toEqual([existing])
    expect(await getCragPermission(USER_ID, INPUT.cragId)).toEqual({
      userId: spelling, cragId: INPUT.cragId, role: existing.role, assignedBy: existing.assignedBy, createdAt: existing.createdAt,
    })
  })

  it('a sequential duplicate does not change who assigned the grant or when', async () => {
    const fixture = database()
    await createCragPermission(INPUT)
    const existing = { ...fixture.records[0] }
    await expect(createCragPermission({ ...INPUT, assignedBy: 'different-admin' })).rejects.toMatchObject({ code: 11000 })
    expect(fixture.records).toEqual([existing])
  })

  it('allows the same user at another crag and another user at the same crag', async () => {
    const fixture = database([legacyGrant()])
    await createCragPermission({ ...INPUT, cragId: 'crag-2' })
    await createCragPermission({ ...INPUT, userId: '1234567890abcdef12345678' })
    expect(fixture.records).toHaveLength(3)
  })

  it('propagates database failures instead of misreporting them as duplicates', async () => {
    const fixture = database()
    fixture.updateOne.mockRejectedValueOnce(new Error('Database unavailable'))
    await expect(createCragPermission(INPUT)).rejects.toThrow('Database unavailable')
    expect(fixture.records).toHaveLength(0)
  })
})

describe('legacy grant reads', () => {
  it.each([USER_ID, USER_ID.toUpperCase(), 'AbCdEf1234567890aBcDeF12'])('lists historical grants for canonical login ID when stored as %s', async spelling => {
    const first = legacyGrant({ userId: spelling })
    const second = legacyGrant({ userId: spelling, cragId: 'crag-2' })
    database([first, second, legacyGrant({ userId: '1234567890abcdef12345678' })])
    expect(await getCragPermissionsByUserId(USER_ID)).toEqual([first, second].map(({ _id, ...grant }) => grant))
  })

  it('does not broaden opaque user IDs while reading', async () => {
    database([legacyGrant({ userId: 'User-1' })])
    expect(await getCragPermission('user-1', INPUT.cragId)).toBeNull()
    expect(await getCragPermissionsByUserId('user-1')).toEqual([])
  })
})

describe('complete grant revocation', () => {
  it.each([USER_ID, USER_ID.toUpperCase(), 'AbCdEf1234567890aBcDeF12'])('removes all legacy duplicate spellings for %s and preserves other users/crags', async requested => {
    const otherCrag = legacyGrant({ cragId: 'crag-2' })
    const otherUser = legacyGrant({ userId: '1234567890abcdef12345678' })
    const prefixedUser = legacyGrant({ userId: `prefix-${USER_ID}` })
    const suffixedUser = legacyGrant({ userId: `${USER_ID}-suffix` })
    const fixture = database([
      legacyGrant(), legacyGrant({ userId: USER_ID.toUpperCase() }), legacyGrant({ userId: 'AbCdEf1234567890aBcDeF12' }),
      legacyGrant({ _id: getCragGrantId(USER_ID, INPUT.cragId) }), otherCrag, otherUser, prefixedUser, suffixedUser,
    ])
    expect(await deleteCragPermission(requested, INPUT.cragId)).toBe(true)
    expect(fixture.records).toEqual([otherCrag, otherUser, prefixedUser, suffixedUser])
    expect(await getCragPermission(USER_ID, INPUT.cragId)).toBeNull()
    expect(await deleteCragPermission(requested, INPUT.cragId)).toBe(false)
  })

  it('opaque IDs remain case-sensitive and all exact duplicates are removed', async () => {
    const preserved = legacyGrant({ userId: 'user-1' })
    const fixture = database([legacyGrant({ userId: 'User-1' }), legacyGrant({ userId: 'User-1' }), preserved])
    expect(await deleteCragPermission('User-1', INPUT.cragId)).toBe(true)
    expect(fixture.records).toEqual([preserved])
    expect(fixture.deleteMany).toHaveBeenCalledWith({ userId: 'User-1', cragId: INPUT.cragId })
  })

  it('propagates revocation failures rather than returning success', async () => {
    const fixture = database([legacyGrant()])
    fixture.deleteMany.mockRejectedValueOnce(new Error('Database unavailable'))
    await expect(deleteCragPermission(USER_ID, INPUT.cragId)).rejects.toThrow('Database unavailable')
    expect(fixture.records).toHaveLength(1)
  })
})
