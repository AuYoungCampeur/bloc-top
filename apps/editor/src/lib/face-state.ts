import type { Route } from '@bloctop/shared/types'
import { getFaceIdentityKey, getRouteFaceIdentities } from '@bloctop/shared/face-references'
import type { FaceGroup, R2FaceInfo } from '@/hooks/use-face-data'

export interface FaceMutationResult {
  routes?: Route[]
  partial?: boolean
  warning?: string
  referencesChanged?: boolean
  imageChanged?: boolean
  refreshPending?: boolean
}

export function buildFaceGroups(faces: R2FaceInfo[], routes: Route[], cragId: string,
  getImageUrl: (face: { cragId: string; area: string; faceId: string }) => string): FaceGroup[] {
  const groups = new Map(faces.map(face => {
    const identity = { cragId, ...face }
    return [getFaceIdentityKey(identity), { ...face, routes: [] as Route[], imageUrl: getImageUrl(identity) }]
  }))
  for (const route of routes) {
    for (const face of getRouteFaceIdentities(route)) groups.get(getFaceIdentityKey(face))?.routes.push(route)
  }
  return [...groups.values()]
}

/** Face mutations own topology only; their snapshot cannot roll back Beta/form writes. */
export function applyFaceRoutes(current: Route[], saved: Route[]): Route[] {
  const updates = new Map(saved.map(route => [route.id, route]))
  return current.map(route => {
    const update = updates.get(route.id)
    return update?.cragId === route.cragId && (update.topoVersion ?? 0) >= (route.topoVersion ?? 0) ? {
      ...route, faceId: update.faceId, faceArea: update.faceArea,
      topoLine: update.topoLine, topoTension: update.topoTension, topoAnnotations: update.topoAnnotations,
      topoVersion: update.topoVersion ?? 0,
    } : route
  })
}
