import type { Crag, Route } from '@/types'

export interface OnlineCragContent {
  crag: Crag
  routes: Route[]
}

export const ONLINE_CONTENT_TIMEOUT_MS = 10_000
const inFlight = new Map<string, Promise<OnlineCragContent>>()
let requestId = 0

async function readJson(path: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  signal.throwIfAborted()
  const response = await fetch(`${path}?fresh=${Date.now()}-${++requestId}`, { cache: 'no-store', signal })
  if (!response.ok) throw new Error(`Reading data failed: ${response.status}`)
  const value = await response.json()
  signal.throwIfAborted()
  if (!value || value.success !== true) throw new Error('Invalid reading data')
  return value
}

/** Read routes between two fresh crag reads. This detects a completed media change
 * during the read, but does not promise an atomic Mongo/R2 snapshot.
 * Publish the entire result, never a revision ahead of its route annotations.
 */
export function readFreshCragContent(cragId: string, supersedePending = false): Promise<OnlineCragContent> {
  const pending = inFlight.get(cragId)
  if (pending && !supersedePending) return pending
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort()
      reject(new Error('Reading data timed out'))
    }, ONLINE_CONTENT_TIMEOUT_MS)
  })
  const read = async (): Promise<OnlineCragContent> => {
    const path = `/api/crags/${encodeURIComponent(cragId)}`
    for (let attempt = 0; attempt < 2; attempt++) {
      const before = await readJson(path, controller.signal)
      if (!before.crag || (before.crag as Crag).id !== cragId) throw new Error('Invalid crag reading data')
      const content = await readJson(`${path}/routes`, controller.signal)
      const after = await readJson(path, controller.signal)
      const crag = after.crag as Crag | undefined
      if (!crag || crag.id !== cragId || !Array.isArray(content.routes) ||
        content.routes.some(route => !route || route.cragId !== cragId || typeof route.id !== 'number')) {
        throw new Error('Reading data belongs to another crag')
      }
      if (JSON.stringify(before.crag) === JSON.stringify(crag)) {
        return { crag, routes: content.routes as Route[] }
      }
    }
    throw new Error('Crag changed during reading')
  }
  const operation = Promise.race([read(), deadline]).finally(() => {
    clearTimeout(timeout)
    if (inFlight.get(cragId) === operation) inFlight.delete(cragId)
  })
  inFlight.set(cragId, operation)
  return operation
}
