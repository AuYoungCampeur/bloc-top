import { describe, expect, it } from 'vitest'
import type { Route } from '@/types'
import { collectRouteFaces, matchesRouteFace, matchesRouteFaceArea } from './route-face-filter'

const points = [{ x: 0.1, y: 0.1 }, { x: 0.8, y: 0.8 }]
const base: Route = { id: 1, cragId: 'crag-a', name: 'Route', grade: 'V3', area: 'display-area' }
const multi: Route = { ...base, topoAnnotations: [
  { area: 'photo-a', faceId: 'same', topoLine: points },
  { area: 'photo-b', faceId: 'same', topoLine: points },
] }

describe('public route face filters', () => {
  it('collects every view, deduplicates full identity and excludes other crags', () => {
    expect(collectRouteFaces([multi, { ...multi, id: 2 }, { ...multi, id: 3, cragId: 'crag-b' }], 'crag-a')).toEqual([
      { cragId: 'crag-a', area: 'photo-a', faceId: 'same' },
      { cragId: 'crag-a', area: 'photo-b', faceId: 'same' },
    ])
  })
  it('filters a secondary annotation without matching the same name in another area/crag', () => {
    expect(matchesRouteFace(multi, 'crag-a/photo-b/same')).toBe(true)
    expect(matchesRouteFace({ ...base, faceId: 'same', faceArea: 'photo-a' }, 'crag-a/photo-b/same')).toBe(false)
    expect(matchesRouteFace({ ...multi, cragId: 'crag-b' }, 'crag-a/photo-b/same')).toBe(false)
  })
  it('uses photo area instead of display area while retaining legacy area links', () => {
    expect(matchesRouteFaceArea(multi, 'photo-b')).toBe(true)
    expect(matchesRouteFaceArea(multi, 'display-area')).toBe(false)
    expect(matchesRouteFaceArea(base, 'display-area')).toBe(true)
  })
  it('keeps old bare-face and unmarked area shared links readable', () => {
    expect(matchesRouteFace(multi, 'same')).toBe(true)
    expect(matchesRouteFace(base, 'crag-a:display-area')).toBe(true)
  })
})
