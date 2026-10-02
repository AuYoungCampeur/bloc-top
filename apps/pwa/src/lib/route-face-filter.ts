import type { Route } from '@/types'
import { getFaceIdentityKey, getRouteFaceIdentities, type FaceIdentity } from '@bloctop/shared/face-references'

/** Public thumbnails come from the routes already loaded for this page. */
export function collectRouteFaces(routes: Route[], cragId: string): FaceIdentity[] {
  const faces = routes.filter(route => route.cragId === cragId).flatMap(getRouteFaceIdentities)
  return [...new Map(faces.map(face => [getFaceIdentityKey(face), face])).values()]
}

export function matchesRouteFace(route: Route, selectedFace: string): boolean {
  const faces = getRouteFaceIdentities(route)
  // Existing shared links used a bare faceId; new selections carry all segments.
  return faces.some(face => getFaceIdentityKey(face) === selectedFace || face.faceId === selectedFace)
    || (!faces.length && `${route.cragId}:${route.area}` === selectedFace)
}

export function matchesRouteFaceArea(route: Route, area: string): boolean {
  const faces = getRouteFaceIdentities(route)
  return faces.length ? faces.some(face => face.area === area) : route.area === area
}
