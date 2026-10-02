import type { Route } from './types'

export const ROUTE_TOPO_FIELDS = ['faceId', 'faceArea', 'topoLine', 'topoTension', 'topoAnnotations'] as const

/** Historical documents have no field; their first Topo change advances 0 to 1. */
export function getRouteTopoVersion(route: Pick<Route, 'topoVersion'>): number {
  return route.topoVersion ?? 0
}

export function hasRouteTopoUpdates(updates: Partial<Route>): boolean {
  return ROUTE_TOPO_FIELDS.some(field => Object.hasOwn(updates, field))
}

export function applyRouteUpdates(route: Route, updates: Partial<Route>): Route {
  const next = { ...route }
  for (const [field, value] of Object.entries(updates)) {
    if (value === undefined) delete (next as unknown as Record<string, unknown>)[field]
    else (next as unknown as Record<string, unknown>)[field] = value
  }
  return next
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stableValue(entry)]))
  }
  return value
}

/** Object property order is immaterial; annotation order and actual fields matter. */
export function hasRouteTopoChanges(route: Route, updates: Partial<Route>): boolean {
  const next = applyRouteUpdates(route, updates)
  return ROUTE_TOPO_FIELDS.some(field => JSON.stringify(stableValue(route[field])) !== JSON.stringify(stableValue(next[field])))
}

export class TopoVersionError extends Error {
  readonly status: 409 | 428
  readonly code: 'TOPO_VERSION_CONFLICT' | 'TOPO_VERSION_REQUIRED'
  readonly route: Route

  constructor(status: 409 | 428, route: Route) {
    super(status === 428 ? '请刷新编辑器后再保存 Topo' : 'Topo 已被其他操作更新，请刷新后重试')
    this.name = 'TopoVersionError'
    this.status = status
    this.code = status === 428 ? 'TOPO_VERSION_REQUIRED' : 'TOPO_VERSION_CONFLICT'
    this.route = { ...route, topoVersion: getRouteTopoVersion(route) }
  }
}
