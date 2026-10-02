import { describe, expect, it } from 'vitest'
import type { Crag, Route } from '@/types'
import { getCragCoverUrl, getFaceTopoUrl, getRouteTopoUrl } from '@/lib/constants'
import { collectOfflineImageUrls, pinOfflineImages } from './offline-manifest'
const crag: Crag = { id: 'fixture', name: 'Fixture', cityId: 'city', location: '', developmentTime: '', description: '', approach: '', coverImages: ['old.jpg?t=12', 'other.jpg'] }
const route: Route = { id: 1, name: '旧线路', grade: 'V3', cragId: crag.id, area: '展示区域' }
describe('offline media manifest', () => {
  it('collects displayed cover paths, legacy topo, geometry-free faces and all multi-topo faces', () => {
    const points = [{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.8 }]
    const routes: Route[] = [route, { ...route, id: 2, faceId: '无几何', faceArea: '照片区' }, { ...route, id: 3, faceId: 'ignored', topoAnnotations: [{ faceId: '甲', area: '权威区', topoLine: points }, { faceId: '乙', area: '其他区', topoLine: points }] }, { ...route, id: 4, faceId: '甲', faceArea: '权威区' }]
    expect(collectOfflineImageUrls(crag, routes)).toEqual([
      getCragCoverUrl('fixture', 0, 12), getCragCoverUrl('fixture', 1, 12), getRouteTopoUrl('fixture', '旧线路'),
      getFaceTopoUrl('fixture', '照片区', '无几何'), getFaceTopoUrl('fixture', '权威区', '甲'), getFaceTopoUrl('fixture', '其他区', '乙'),
    ])
  })
  it('isolates different snapshot revisions while preserving source URLs and existing version params', () => {
    const source = getRouteTopoUrl('fixture', '旧线路')
    const [first] = pinOfflineImages([source], 'old')
    const [next] = pinOfflineImages([source], 'new')
    expect(first.sourceUrl).toBe(source)
    expect(first.cacheUrl).not.toBe(next.cacheUrl)
    expect(new URL(first.cacheUrl).searchParams.get('v')).toBeTruthy()
    expect(new URL(next.cacheUrl).searchParams.get('offlineRevision')).toBe('new')
  })
})
