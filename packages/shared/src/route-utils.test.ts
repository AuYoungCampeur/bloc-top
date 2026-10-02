import { describe, it, expect } from 'vitest'
import { getSiblingRoutes } from './route-utils'
import type { Route } from './types'

function makeRoute(overrides: Partial<Route> & { id: number; name: string; grade: string; cragId: string; area: string }): Route {
  return { ...overrides } as Route
}

const topoLine = [{ x: 0, y: 0 }, { x: 1, y: 1 }] as Route['topoLine']

describe('getSiblingRoutes', () => {
  const routes: Route[] = [
    makeRoute({ id: 1, name: 'A', grade: 'V2', cragId: 'c1', area: 'left', faceId: 'f1', topoLine }),
    makeRoute({ id: 2, name: 'B', grade: 'V3', cragId: 'c1', area: 'left', faceId: 'f1', topoLine }),
    makeRoute({ id: 3, name: 'C', grade: 'V4', cragId: 'c1', area: 'left', faceId: 'f2', topoLine }),
    makeRoute({ id: 4, name: 'D', grade: 'V5', cragId: 'c1', area: 'right', topoLine }),
    makeRoute({ id: 5, name: 'E', grade: 'V1', cragId: 'c1', area: 'left', faceId: 'f1' }), // no topoLine
    makeRoute({ id: 6, name: 'F', grade: 'V0', cragId: 'c2', area: 'left', faceId: 'f1', topoLine }),
  ]

  it('returns empty array when route is null', () => {
    expect(getSiblingRoutes(null, routes)).toEqual([])
  })

  it('matches by cragId + faceId and filters for valid topoLine', () => {
    const result = getSiblingRoutes(routes[0], routes)
    const ids = result.map((r) => r.id)
    // id=1,2 share cragId=c1 + faceId=f1 with topoLine; id=5 has no topoLine; id=6 has faceId=f1 but different crag (excluded)
    expect(ids).toEqual([1, 2])
  })

  it('falls back to cragId + area when no faceId', () => {
    const result = getSiblingRoutes(routes[3], routes) // id=4: cragId=c1, area=right, no faceId
    const ids = result.map((r) => r.id)
    expect(ids).toEqual([4])
  })

  it('excludes routes with topoLine shorter than 2 points', () => {
    const shortTopo = [{ x: 0, y: 0 }] as Route['topoLine']
    const testRoutes: Route[] = [
      makeRoute({ id: 10, name: 'X', grade: 'V1', cragId: 'c1', area: 'a', faceId: 'fx', topoLine }),
      makeRoute({ id: 11, name: 'Y', grade: 'V2', cragId: 'c1', area: 'a', faceId: 'fx', topoLine: shortTopo }),
    ]
    const result = getSiblingRoutes(testRoutes[0], testRoutes)
    expect(result.map((r) => r.id)).toEqual([10])
  })

  it('returns all sibling routes when all match cragId + faceId + topoLine', () => {
    const testRoutes: Route[] = [
      makeRoute({ id: 1, name: 'A', grade: 'V1', cragId: 'c1', area: 'left', faceId: 'f1', topoLine }),
      makeRoute({ id: 2, name: 'B', grade: 'V2', cragId: 'c1', area: 'left', faceId: 'f1', topoLine }),
      makeRoute({ id: 3, name: 'C', grade: 'V3', cragId: 'c1', area: 'left', faceId: 'f1', topoLine }),
    ]
    const result = getSiblingRoutes(testRoutes[0], testRoutes)
    expect(result.map((r) => r.id)).toEqual([1, 2, 3])
  })

  it('does not mix identically named faces in another area', () => {
    const other = { ...routes[1], area: 'right' }
    expect(getSiblingRoutes(routes[0], [routes[0], other]).map(r => r.id)).toEqual([1])
  })

  it('first annotation region overrides route category and a secondary matching annotation uses its own line', () => {
    const selected = { ...routes[0], area: 'left', topoAnnotations: [{ faceId: 'f1', area: 'right', topoLine: topoLine! }] }
    const matchingLine = [{ x: 0.2, y: 0.3 }, { x: 0.7, y: 0.8 }]
    const sibling = { ...routes[1], topoAnnotations: [
      { faceId: 'different', area: 'left', topoLine: topoLine! },
      { faceId: 'f1', area: 'right', topoLine: matchingLine, topoTension: 0.8 },
    ] }
    const result = getSiblingRoutes(selected, [selected, sibling, routes[0]])
    expect(result.map(r => r.id)).toEqual([1, 2])
    expect(result[1]).toMatchObject({ area: 'left', faceId: 'f1', faceArea: 'right', topoLine: matchingLine, topoTension: 0.8 })
    expect(result[1].topoAnnotations?.[0].area).toBe('right')
    expect(sibling.topoAnnotations[0].area).toBe('left')
  })

  it('legacy faceArea isolates image identity from the route category', () => {
    const selected = { ...routes[0], faceArea: 'right' }
    const sameImage = { ...routes[1], area: 'right' }
    expect(getSiblingRoutes(selected, [selected, sameImage, routes[0]]).map(r => r.id)).toEqual([1, 2])
  })
})
