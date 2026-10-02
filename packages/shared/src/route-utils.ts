import type { Route } from './types'
import { getPrimaryFaceIdentity, getRouteTopoAnnotations } from './face-references'

/**
 * 获取与指定线路共享同一岩面的兄弟线路（含自身）。
 * 岩面按 cragId + area + faceId 匹配；多图取该岩面的几何。
 * 旧线路名称图片保留 cragId + area 回退。仅返回至少两个点的线路。
 */
export function getSiblingRoutes(route: Route | null, allRoutes: Route[]): Route[] {
  if (!route) return []

  const face = getPrimaryFaceIdentity(route)
  if (face) {
    return allRoutes.flatMap(r => {
      if (r.cragId !== face.cragId) return []
      const annotations = getRouteTopoAnnotations(r)
      const index = annotations.findIndex(a => a.area === face.area && a.faceId === face.faceId && a.topoLine.length >= 2)
      if (index < 0) return []
      const annotation = annotations[index]
      // Overlay consumers read legacy geometry; project the matched image, not
      // another image's first Topo. This is a read view, never a persisted edit.
      return [{ ...r, faceId: annotation.faceId, faceArea: annotation.area,
        topoLine: annotation.topoLine, topoTension: annotation.topoTension,
        ...(r.topoAnnotations?.length ? { topoAnnotations: [annotation, ...annotations.filter((_, i) => i !== index)] } : {}),
      }]
    })
  }

  return allRoutes.filter(
    (r) =>
      r.cragId === route.cragId &&
      r.area === route.area &&
      r.topoLine &&
      r.topoLine.length >= 2
  )
}
