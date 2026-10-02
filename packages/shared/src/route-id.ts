import type { Db, Document } from 'mongodb'

/** Durable monotonic counter; deleting a route never releases its reservation. */
export async function allocateRouteId(db: Db): Promise<number> {
  const counters = db.collection('counters')
  const counterId = 'route-id' as unknown as Document['_id']
  if (!(await counters.findOne({ _id: counterId }))) {
    // Bootstrap only: historical deleted IDs cannot be reconstructed without an existing high-water mark.
    const latest = await db.collection('routes').find({ $or: [
      { _id: { $type: 'double' } }, { _id: { $type: 'int' } }, { _id: { $type: 'long' } },
    ] }).sort({ _id: -1 }).limit(1).toArray()
    const floor: unknown = latest[0]?._id ?? 0
    if (typeof floor !== 'number' || !Number.isSafeInteger(floor) || floor < 0) throw new Error('Invalid route ID high-water mark')
    try { await counters.insertOne({ _id: counterId, seq: floor }) }
    catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 11000) throw error
      // A concurrent initializer won. Increment its durable value below.
    }
  }
  const counter = await counters.findOneAndUpdate({ _id: counterId, seq: { $gte: 0, $lt: Number.MAX_SAFE_INTEGER } },
    { $inc: { seq: 1 } }, { returnDocument: 'after' })
  if (!counter || typeof counter.seq !== 'number' || !Number.isSafeInteger(counter.seq) || counter.seq <= 0) throw new Error('Route ID counter is invalid or exhausted')
  return counter.seq
}
