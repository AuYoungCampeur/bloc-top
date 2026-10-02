import { createHash } from 'node:crypto'
import { getCragById, getRoutesByCragId } from '@/lib/db'
import { IMAGE_VERSION } from '@/lib/constants'
import { collectOfflineImageUrls, pinOfflineImages, type OfflineSnapshot } from './offline-manifest'

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
  }
  return value
}

export async function readOfflineSnapshot(cragId: string): Promise<OfflineSnapshot | null> {
  const crag = await getCragById(cragId)
  if (!crag) return null
  const routes = (await getRoutesByCragId(cragId))
    .map(({ betaLinks: _betaLinks, ...route }) => { void _betaLinks; return route })
    .sort((a, b) => a.id - b.id)
  const revision = createHash('sha256').update(JSON.stringify(canonical({ crag, routes, imageVersion: IMAGE_VERSION }))).digest('hex')
  return { schemaVersion: 2, crag, routes, revision, images: pinOfflineImages(collectOfflineImageUrls(crag, routes), revision) }
}
