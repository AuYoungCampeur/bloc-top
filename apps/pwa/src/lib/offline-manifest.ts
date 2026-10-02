import type { Crag, Route } from '@/types'
import { getFaceTopoUrl, getRouteTopoUrl, getCragCoverUrl } from '@/lib/constants'
import { getRouteFaceIdentities } from '@bloctop/shared/face-references'

export interface OfflineImage { sourceUrl: string; cacheUrl: string }
export interface OfflineSnapshot {
  schemaVersion: 2
  crag: Crag
  routes: Route[]
  revision: string
  images: OfflineImage[]
}

export function collectOfflineImageUrls(crag: Crag, routes: Route[]): string[] {
  const urls = new Set<string>()
  const timestamp = crag.coverImages?.[0]?.match(/[?&]t=(\d+)/)?.[1]
  for (let i = 0; i < (crag.coverImages?.length ?? 0); i++) {
    urls.add(getCragCoverUrl(crag.id, i, timestamp ? Number(timestamp) : undefined))
  }
  for (const route of routes) {
    const faces = getRouteFaceIdentities(route)
    if (faces.length) {
      for (const face of faces) urls.add(getFaceTopoUrl(face.cragId, face.area, face.faceId))
    } else {
      urls.add(getRouteTopoUrl(route.cragId, route.name))
    }
  }
  return [...urls]
}

export function pinOfflineImages(urls: string[], revision: string): OfflineImage[] {
  return urls.map(sourceUrl => {
    const url = new URL(sourceUrl)
    url.searchParams.set('offlineRevision', revision)
    return { sourceUrl, cacheUrl: url.href }
  })
}
