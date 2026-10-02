import { describe, it, expect } from 'vitest'
import { getTopoAnnotations } from './topo-annotations'
import type { Route, RouteTopoAnnotation } from '@bloctop/shared/types'

const minimalRoute: Route = {
  id: 1,
  name: '测试线路',
  grade: 'V3',
  cragId: 'test-crag',
  area: '主墙',
}

describe('getTopoAnnotations', () => {
  it('空路由返回空数组', () => {
    expect(getTopoAnnotations(minimalRoute)).toEqual([])
  })

  it('只有旧字段的路由，合成单条标注', () => {
    const route: Route = {
      ...minimalRoute,
      faceId: 'face-1',
      topoLine: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }],
      topoTension: 0.5,
    }
    const result = getTopoAnnotations(route)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      faceId: 'face-1',
      area: '主墙',
      topoLine: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }],
      topoTension: 0.5,
    })
  })

  it('旧字段 topoLine < 2 点时返回空数组', () => {
    const route: Route = {
      ...minimalRoute,
      faceId: 'face-1',
      topoLine: [{ x: 0.1, y: 0.2 }],
    }
    expect(getTopoAnnotations(route)).toEqual([])
  })

  it('旧标注使用 faceArea，图片区域不随线路所属区域变化', () => {
    const route: Route = {
      ...minimalRoute,
      faceId: 'face-1',
      faceArea: '侧墙',
      topoLine: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }],
    }
    expect(getTopoAnnotations(route)[0].area).toBe('侧墙')
    expect(route.area).toBe('主墙')
  })

  it('有新字段 topoAnnotations 时直接返回新字段', () => {
    const annotations: RouteTopoAnnotation[] = [
      { faceId: 'face-1', area: '主墙', topoLine: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }] },
      { faceId: 'face-2', area: '主墙', topoLine: [{ x: 0.5, y: 0.6 }, { x: 0.7, y: 0.8 }] },
    ]
    const route: Route = { ...minimalRoute, topoAnnotations: annotations }
    expect(getTopoAnnotations(route)).toEqual(annotations)
  })

  it('topoAnnotations 为空数组时，回退到旧字段', () => {
    const route: Route = {
      ...minimalRoute,
      topoAnnotations: [],
      faceId: 'face-1',
      topoLine: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }],
    }
    const result = getTopoAnnotations(route)
    expect(result).toHaveLength(1)
    expect(result[0].faceId).toBe('face-1')
  })
})
