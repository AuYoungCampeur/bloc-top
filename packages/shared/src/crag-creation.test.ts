import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const findOne = vi.fn()
  const insertOne = vi.fn()
  const updateOne = vi.fn()
  const session = { withTransaction: vi.fn(), endSession: vi.fn() }
  const client = { startSession: vi.fn(() => session) }
  const db = { collection: vi.fn((name: string) =>
    name === 'crags' ? { findOne, insertOne } : { updateOne }) }
  return { findOne, insertOne, updateOne, session, client, db }
})
vi.mock('./mongodb', () => ({
  getClientPromise: vi.fn(async () => mocks.client),
  getDatabase: vi.fn(async () => mocks.db),
}))
import { createCragWithCreatorPermission, CragCreationConflictError } from './crag-creation'

const input = { id: 'new-crag', name: 'New crag', cityId: 'luoyuan', location: 'Village', description: 'Rock', approach: 'Walk' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findOne.mockResolvedValue(null)
  mocks.insertOne.mockResolvedValue({ acknowledged: true })
  mocks.updateOne.mockResolvedValue({ acknowledged: true })
  mocks.session.withTransaction.mockImplementation(async (callback: () => Promise<unknown>) => callback())
})

describe('transactional crag creation contract', () => {
  it('associates both writes and the existence read with one session', async () => {
    const result = await createCragWithCreatorPermission(input, 'creator')
    expect(result).toMatchObject({ crag: { ...input, createdBy: 'creator', areas: [] }, replayed: false })
    expect(mocks.findOne).toHaveBeenCalledWith({ _id: input.id }, { session: mocks.session })
    expect(mocks.insertOne).toHaveBeenCalledWith(expect.objectContaining({ _id: input.id }), { session: mocks.session })
    expect(mocks.updateOne).toHaveBeenCalledWith(
      { userId: 'creator', cragId: input.id },
      { $setOnInsert: expect.objectContaining({ _id: 'crag-grant:creator:new-crag', userId: 'creator', cragId: input.id, role: 'manager', assignedBy: 'creator' }) },
      { upsert: true, session: mocks.session },
    )
    expect(mocks.session.endSession).toHaveBeenCalledOnce()
  })

  it('propagates a grant failure out of the transaction and releases the session', async () => {
    const failure = new Error('grant unavailable')
    mocks.updateOne.mockRejectedValueOnce(failure)
    await expect(createCragWithCreatorPermission(input, 'creator')).rejects.toBe(failure)
    expect(mocks.session.withTransaction).toHaveBeenCalledOnce()
    expect(mocks.session.endSession).toHaveBeenCalledOnce()
  })

  it('recovers a matching retry without replacing existing content or media revision', async () => {
    const stored = { ...input, _id: input.id, createdBy: 'creator', areas: ['A'], mediaRevision: 'v2' }
    mocks.findOne.mockResolvedValueOnce(stored)
    const result = await createCragWithCreatorPermission(input, 'creator')
    expect(result).toMatchObject({ crag: { areas: ['A'], mediaRevision: 'v2' }, replayed: true })
    expect(mocks.insertOne).not.toHaveBeenCalled()
    expect(mocks.updateOne).toHaveBeenCalledOnce()
  })

  it.each([
    { createdBy: 'someone-else' }, { name: 'Different' }, { cityId: 'another-city' },
    { coordinates: { lng: 10, lat: 20 } },
  ])('rejects an occupied slug without writing: %j', async change => {
    mocks.findOne.mockResolvedValueOnce({ ...input, _id: input.id, createdBy: 'creator', ...change })
    await expect(createCragWithCreatorPermission(input, 'creator')).rejects.toBeInstanceOf(CragCreationConflictError)
    expect(mocks.insertOne).not.toHaveBeenCalled()
    expect(mocks.updateOne).not.toHaveBeenCalled()
  })

  it('re-reads a competing duplicate insert and returns a matching replay', async () => {
    mocks.insertOne.mockRejectedValueOnce({ code: 11000 })
    mocks.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...input, _id: input.id, createdBy: 'creator' })
    const result = await createCragWithCreatorPermission(input, 'creator')
    expect(result.replayed).toBe(true)
    expect(mocks.session.withTransaction).toHaveBeenCalledTimes(2)
    expect(mocks.updateOne).toHaveBeenCalledOnce()
  })

  it('propagates a commit failure and does not report creation success', async () => {
    mocks.session.withTransaction.mockRejectedValueOnce(new Error('commit failed'))
    await expect(createCragWithCreatorPermission(input, 'creator')).rejects.toThrow('commit failed')
    expect(mocks.session.endSession).toHaveBeenCalledOnce()
  })
})
