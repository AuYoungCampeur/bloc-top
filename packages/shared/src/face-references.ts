import type { Route, RouteTopoAnnotation } from './types'

export interface FaceIdentity { cragId: string; area: string; faceId: string }
export type FaceReferenceOperation =
  | { kind: 'rename'; newFaceId: string }
  | { kind: 'delete' }
  | { kind: 'clearTopo' }

/** Raw Unicode identity; encode individual segments only when building a URL. */
export function getFaceIdentityKey(face: FaceIdentity): string {
  return `${face.cragId}/${face.area}/${face.faceId}`
}

export function isSameFace(a: FaceIdentity, b: FaceIdentity): boolean {
  return a.cragId === b.cragId && a.area === b.area && a.faceId === b.faceId
}

export function getRouteTopoAnnotations(route: Route): RouteTopoAnnotation[] {
  if (route.topoAnnotations?.length) return route.topoAnnotations
  if (route.faceId && (route.faceArea ?? route.area) && route.topoLine && route.topoLine.length >= 2) {
    return [{ faceId: route.faceId, area: route.faceArea ?? route.area,
      topoLine: route.topoLine, ...(route.topoTension !== undefined ? { topoTension: route.topoTension } : {}) }]
  }
  return []
}

export function getPrimaryFaceIdentity(route: Route): FaceIdentity | null {
  const first = route.topoAnnotations?.[0]
  if (first) return { cragId: route.cragId, area: first.area, faceId: first.faceId }
  const area = route.faceArea ?? route.area
  return route.faceId && area ? { cragId: route.cragId, area, faceId: route.faceId } : null
}

export function getRouteFaceIdentities(route: Route): FaceIdentity[] {
  const faces = route.topoAnnotations?.length
    ? route.topoAnnotations.map(a => ({ cragId: route.cragId, area: a.area, faceId: a.faceId }))
    : [getPrimaryFaceIdentity(route)].filter((f): f is FaceIdentity => f !== null)
  return [...new Map(faces.map(f => [getFaceIdentityKey(f), f])).values()]
}

/** Undefined values deliberately mean Mongo $unset, never BSON null. */
function projectFirst(annotations: RouteTopoAnnotation[]): Partial<Route> {
  const first = annotations[0]
  return { topoAnnotations: annotations, faceId: first?.faceId, faceArea: first?.area,
    topoLine: first?.topoLine, topoTension: first?.topoTension }
}

export function transformRouteFaceReferences(
  route: Route, face: FaceIdentity, operation: FaceReferenceOperation,
): Partial<Route> {
  if (!getRouteFaceIdentities(route).some(f => isSameFace(f, face))) return {}
  const matches = (a: RouteTopoAnnotation) => a.area === face.area && a.faceId === face.faceId
  const annotations = getRouteTopoAnnotations(route)
  if (operation.kind === 'clearTopo' && !annotations.length && !route.topoLine && route.topoTension === undefined) return {}
  if (operation.kind === 'rename') {
    if (annotations.length) return projectFirst(annotations.map(a => matches(a) ? { ...a, faceId: operation.newFaceId } : a))
    return { faceId: operation.newFaceId, faceArea: face.area }
  }
  const remaining = annotations.filter(a => !matches(a))
  const updates = projectFirst(remaining)
  // Clearing geometry retains the sole image association for an unmarked route.
  if (operation.kind === 'clearTopo' && !remaining.length) {
    const primary = getPrimaryFaceIdentity(route)
    updates.faceId = primary?.faceId
    updates.faceArea = primary?.area
  }
  return updates
}

/** Arrays own the compatibility projection, including explicit empty arrays. */
export function normalizeRouteTopoUpdates(updates: Partial<Route>, existing?: Route): Partial<Route> {
  if (updates.topoAnnotations !== undefined) return { ...updates, ...projectFirst(updates.topoAnnotations) }
  const legacyFields = ['faceId', 'faceArea', 'topoLine', 'topoTension'] as const
  if (existing?.topoAnnotations?.length && legacyFields.some(key => Object.hasOwn(updates, key))) {
    const first = existing.topoAnnotations[0]
    const faceId = Object.hasOwn(updates, 'faceId') ? updates.faceId : first.faceId
    const topoLine = Object.hasOwn(updates, 'topoLine') ? updates.topoLine : first.topoLine
    const area = Object.hasOwn(updates, 'faceArea') ? updates.faceArea : first.area
    const topoTension = Object.hasOwn(updates, 'topoTension') ? updates.topoTension : first.topoTension
    const annotations = faceId && area && topoLine && topoLine.length >= 2
      ? [{ faceId, area, topoLine, ...(topoTension !== undefined ? { topoTension } : {}) }, ...existing.topoAnnotations.slice(1)]
      : existing.topoAnnotations.slice(1)
    return { ...updates, ...projectFirst(annotations) }
  }
  const result = { ...updates }
  if (Object.hasOwn(updates, 'topoLine') && updates.topoLine === undefined) result.topoTension = undefined
  if (Object.hasOwn(updates, 'faceId') && updates.faceId === undefined) {
    result.faceArea = undefined; result.topoLine = undefined; result.topoTension = undefined
  } else if (updates.faceId && !Object.hasOwn(updates, 'faceArea')) {
    const area = existing?.faceId === updates.faceId
      ? existing.faceArea ?? existing.area : updates.area ?? existing?.area
    if (area !== undefined) result.faceArea = area
  } else if (existing?.faceId && !existing.faceArea && Object.hasOwn(updates, 'area')) {
    result.faceArea = existing.area
  }
  return result
}
