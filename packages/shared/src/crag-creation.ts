import type { Crag, CragPermission } from './types'
import type { ObjectId } from 'mongodb'
import { getClientPromise, getDatabase } from './mongodb'
import { normalizeCragGrantUserId, getCragGrantId, getCragGrantUserFilter } from './crag-grant'

export type NewCragInput = Pick<Crag,
  'id' | 'name' | 'cityId' | 'location' | 'description' | 'approach' | 'coordinates'>

export class CragCreationConflictError extends Error {
  readonly code = 'CRAG_ID_CONFLICT'

  constructor(id: string) {
    super(`岩场 ID "${id}" 已存在`)
    this.name = 'CragCreationConflictError'
  }
}

type StoredCrag = Omit<Crag, 'id'> & { _id: string }
type CreationResult = { crag: Crag; replayed: boolean }

function matchesCreation(existing: StoredCrag, input: NewCragInput, creatorId: string) {
  const fields = ['name', 'cityId', 'location', 'description', 'approach'] as const
  return existing.createdBy === creatorId
    && fields.every(field => existing[field] === input[field])
    && existing.coordinates?.lng === input.coordinates?.lng
    && existing.coordinates?.lat === input.coordinates?.lat
}

/**
 * Create the crag and its creator grant in one MongoDB transaction.
 * A lost response can be retried with the same slug, creator and initial fields.
 * Existing unrelated crags are never replaced. Requires a transaction-capable DB.
 */
export async function createCragWithCreatorPermission(
  input: NewCragInput,
  creatorId: string,
): Promise<CreationResult> {
  const client = await getClientPromise()
  const db = await getDatabase()
  const session = client.startSession()
  try {
    // A competing insert can report duplicate key instead of a retryable write
    // conflict. Re-read once in a fresh transaction to resolve it as a replay or
    // an occupied slug; no external side effects occur in this callback.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await session.withTransaction(async () => {
          const crags = db.collection<StoredCrag>('crags')
          const existing = await crags.findOne({ _id: input.id }, { session })
          if (existing && !matchesCreation(existing, input, creatorId)) {
            throw new CragCreationConflictError(input.id)
          }
          const now = new Date()
          const stored: StoredCrag = existing ?? {
            _id: input.id,
            name: input.name,
            cityId: input.cityId,
            location: input.location,
            description: input.description,
            approach: input.approach,
            ...(input.coordinates ? { coordinates: input.coordinates } : {}),
            createdBy: creatorId,
            areas: [],
            createdAt: now,
            updatedAt: now,
          }
          if (!existing) await crags.insertOne(stored, { session })
          await db.collection<CragPermission & { _id: string | ObjectId }>('crag_permissions').updateOne(
            { userId: getCragGrantUserFilter(creatorId), cragId: input.id },
            { $setOnInsert: {
              // Built-in _id uniqueness protects simultaneous repairs even
              // when the optional userId/cragId index has not been installed.
              // Existing grants of either ID type still match the filter.
              _id: getCragGrantId(creatorId, input.id),
              userId: normalizeCragGrantUserId(creatorId), cragId: input.id,
              role: 'manager', assignedBy: creatorId, createdAt: now,
            } },
            { upsert: true, session },
          )
          const { _id, ...fields } = stored
          return { crag: { id: _id, ...fields }, replayed: Boolean(existing) }
        }, {
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
          maxCommitTimeMS: 10_000,
          timeoutMS: 15_000,
        })
      } catch (error) {
        if (attempt === 0 && typeof error === 'object' && error !== null
          && 'code' in error && error.code === 11000) continue
        throw error
      }
    }
    throw new Error('创建岩场未完成')
  } finally {
    await session.endSession()
  }
}
