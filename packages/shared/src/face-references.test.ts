import { describe, expect, it } from 'vitest'
import type { Route, RouteTopoAnnotation } from './types'
import { getFaceIdentityKey, getPrimaryFaceIdentity, getRouteFaceIdentities, getRouteTopoAnnotations, normalizeRouteTopoUpdates, transformRouteFaceReferences } from './face-references'
import { parseRouteTopoUpdates, TopoValidationError } from './route-topo-validation'
import { getTopoImageUrl } from './constants'

const line = [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }]
const annotation = (area: string, faceId = 'wall'): RouteTopoAnnotation => ({ area, faceId, topoLine: line, topoTension: 0.3 })
const route = (fields: Partial<Route> = {}): Route => ({ id: 1, name: 'route', grade: 'V1', cragId: 'crag', area: 'A', ...fields })
const face = { cragId: 'crag', area: 'B', faceId: 'wall' }

describe('complete face identity and compatibility projection', () => {
  it('takes the first annotation area, even if top-level area and face fields disagree', () => {
    const record = route({ faceId: 'wrong', faceArea: 'A', topoAnnotations: [annotation('B')] })
    expect(getPrimaryFaceIdentity(record)).toEqual(face)
    expect(getTopoImageUrl(record)).toContain('/crag/B/wall.jpg')
  })
  it('uses optional legacy faceArea, and falls back to route.area only for older records', () => {
    expect(getRouteTopoAnnotations(route({ faceId: 'wall', faceArea: 'B', topoLine: line }))[0].area).toBe('B')
    expect(getPrimaryFaceIdentity(route({ faceId: 'wall' }))?.area).toBe('A')
  })
  it('lists image associations without geometry and de-duplicates full identities', () => {
    expect(getRouteFaceIdentities(route({ faceId: 'wall' }))).toHaveLength(1)
    const record = route({ topoAnnotations: [annotation('A'), annotation('B'), annotation('A')] })
    expect(getRouteFaceIdentities(record).map(getFaceIdentityKey)).toEqual(['crag/A/wall', 'crag/B/wall'])
  })
  it('renames only matching area, preserves other annotations and route area', () => {
    const record = route({ topoAnnotations: [annotation('A'), annotation('B'), annotation('C')] })
    const updates = transformRouteFaceReferences(record, face, { kind: 'rename', newFaceId: 'new' })
    expect(updates.topoAnnotations?.map(a => [a.area, a.faceId])).toEqual([['A', 'wall'], ['B', 'new'], ['C', 'wall']])
    expect(updates.faceArea).toBe('A')
    expect(updates).not.toHaveProperty('area')
    expect(record.topoAnnotations?.[1].faceId).toBe('wall')
  })
  it('does not touch same named legacy faces in another area or crag', () => {
    expect(transformRouteFaceReferences(route({ faceId: 'wall', topoLine: line }), face, { kind: 'delete' })).toEqual({})
    expect(transformRouteFaceReferences(route({ cragId: 'other', topoAnnotations: [annotation('B')] }), face, { kind: 'delete' })).toEqual({})
  })
  it('deleting first image projects remaining first image, including tension and area', () => {
    const record = route({ faceId: 'wall', topoAnnotations: [annotation('B'), annotation('C', 'other')] })
    const updates = transformRouteFaceReferences(record, face, { kind: 'delete' })
    expect(updates).toEqual({ topoAnnotations: [annotation('C', 'other')], faceId: 'other', faceArea: 'C', topoLine: line, topoTension: 0.3 })
  })
  it('deleting last annotation clears every compatibility field and cannot resurrect old geometry', () => {
    const record = route({ faceId: 'wall', topoLine: line, topoTension: 0.9, topoAnnotations: [annotation('B')] })
    const updates = transformRouteFaceReferences(record, face, { kind: 'delete' })
    expect(updates).toEqual({ topoAnnotations: [], faceId: undefined, faceArea: undefined, topoLine: undefined, topoTension: undefined })
    expect(getRouteTopoAnnotations({ ...record, ...updates })).toEqual([])
  })
  it('clearing sole geometry retains image association; clearing one of many keeps the other geometry', () => {
    const sole = transformRouteFaceReferences(route({ topoAnnotations: [annotation('B')] }), face, { kind: 'clearTopo' })
    expect(sole).toMatchObject({ faceId: 'wall', faceArea: 'B', topoLine: undefined, topoTension: undefined, topoAnnotations: [] })
    const multi = transformRouteFaceReferences(route({ topoAnnotations: [annotation('B'), annotation('C')] }), face, { kind: 'clearTopo' })
    expect(multi.topoAnnotations).toEqual([annotation('C')])
  })
  it('canonical save ignores contradictory compatibility projection', () => {
    const updates = normalizeRouteTopoUpdates({ topoAnnotations: [annotation('B')], faceId: 'other', faceArea: 'A', topoLine: [], topoTension: 0.8 })
    expect(updates).toMatchObject({ faceId: 'wall', faceArea: 'B', topoLine: line, topoTension: 0.3 })
  })
  it('empty arrays clear compatibility and legacy PATCH updates only the first annotation', () => {
    expect(normalizeRouteTopoUpdates({ topoAnnotations: [] }).faceId).toBeUndefined()
    const record = route({ topoAnnotations: [annotation('B'), annotation('C')] })
    expect(normalizeRouteTopoUpdates({ faceId: 'new' }, record).topoAnnotations).toEqual([{ ...annotation('B'), faceId: 'new' }, annotation('C')])
  })
  it('changing route area preserves legacy image area without changing the category contract', () => {
    expect(normalizeRouteTopoUpdates({ area: 'C' }, route({ faceId: 'wall' }))).toEqual({ area: 'C', faceArea: 'A' })
  })
})

describe('Topo input validation', () => {
  it.each([null, {}, { area: 'B', faceId: 'wall', topoLine: [] }, { area: '../B', faceId: 'wall', topoLine: line },
    { ...annotation('B'), topoTension: 2 }, { ...annotation('B'), topoTension: NaN }, { ...annotation('B'), topoLine: [{ x: NaN, y: 0 }, { x: 1, y: 1 }] }])('rejects malformed annotation %j', invalid => {
    expect(() => parseRouteTopoUpdates({ topoAnnotations: [invalid] })).toThrow(TopoValidationError)
  })
  it('validates legacy IDs and finite bounded coordinates', () => {
    expect(() => parseRouteTopoUpdates({ faceId: '../wall' })).toThrow(TopoValidationError)
    expect(() => parseRouteTopoUpdates({ topoLine: [{ x: Infinity, y: 0 }] })).toThrow(TopoValidationError)
  })
  it('accepts full multi-image data and projects the first image area on the server', () => {
    expect(parseRouteTopoUpdates({ topoAnnotations: [annotation('B'), annotation('C')] })).toMatchObject({ faceArea: 'B', faceId: 'wall' })
  })
})
