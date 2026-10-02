import type { Route, TopoPoint, RouteTopoAnnotation } from './types'
import { normalizeRouteTopoUpdates } from './face-references'

export class TopoValidationError extends Error {}
function segment(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 && value === value.trim() && !/[\/%\\\x00-\x1f\x7f]/.test(value) && value !== '.' && value !== '..'
}
function line(value: unknown): value is TopoPoint[] {
  return Array.isArray(value) && value.every(p => p && typeof p === 'object' &&
    typeof p.x === 'number' && Number.isFinite(p.x) && p.x >= 0 && p.x <= 1 &&
    typeof p.y === 'number' && Number.isFinite(p.y) && p.y >= 0 && p.y <= 1)
}
function tension(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

export function parseRouteTopoUpdates(body: Record<string, unknown>, existing?: Route): Partial<Route> {
  const updates: Partial<Route> = {}
  if (Object.hasOwn(body, 'faceId')) {
    if (body.faceId === null) updates.faceId = undefined
    else if (segment(body.faceId) && /^[\u4e00-\u9fffa-z0-9-]+$/.test(body.faceId)) updates.faceId = body.faceId
    else throw new TopoValidationError('faceId 格式无效')
  }
  if (Object.hasOwn(body, 'faceArea')) {
    if (body.faceArea === null) updates.faceArea = undefined
    else if (segment(body.faceArea)) updates.faceArea = body.faceArea
    else throw new TopoValidationError('faceArea 格式无效')
  }
  if (Object.hasOwn(body, 'topoLine')) {
    if (body.topoLine === null) updates.topoLine = undefined
    else if (line(body.topoLine)) updates.topoLine = body.topoLine
    else throw new TopoValidationError('Topo 线路数据格式无效')
  }
  if (Object.hasOwn(body, 'topoTension')) {
    if (body.topoTension === null) updates.topoTension = undefined
    else if (tension(body.topoTension)) updates.topoTension = body.topoTension
    else throw new TopoValidationError('topoTension 必须是 0-1 之间的数字')
  }
  if (Object.hasOwn(body, 'topoAnnotations')) {
    if (body.topoAnnotations === null) updates.topoAnnotations = []
    else if (Array.isArray(body.topoAnnotations)) {
      updates.topoAnnotations = body.topoAnnotations.map((a: unknown): RouteTopoAnnotation => {
        if (!a || typeof a !== 'object' || Array.isArray(a)) throw new TopoValidationError('topoAnnotations 中的标注数据格式无效')
        const annotation = a as Record<string, unknown>
        if (!segment(annotation.faceId) || !/^[\u4e00-\u9fffa-z0-9-]+$/.test(annotation.faceId) || !segment(annotation.area) || !line(annotation.topoLine) || annotation.topoLine.length < 2 ||
            (annotation.topoTension !== undefined && !tension(annotation.topoTension))) throw new TopoValidationError('topoAnnotations 中的标注数据格式无效')
        return { faceId: annotation.faceId, area: annotation.area, topoLine: annotation.topoLine,
          ...(annotation.topoTension !== undefined ? { topoTension: annotation.topoTension as number } : {}) }
      })
    } else throw new TopoValidationError('topoAnnotations 必须是数组')
  }
  return normalizeRouteTopoUpdates(updates, existing)
}
