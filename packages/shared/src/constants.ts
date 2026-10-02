import type { Route } from './types'
import { getPrimaryFaceIdentity } from './face-references'

/**
 * Cloudflare R2 图片存储配置
 */
const IMAGE_BASE_URL = 'https://img.bouldering.top'

/**
 * 图片全局版本号 (Cache Busting)
 *
 * 当批量更新图片后，修改此值即可让所有用户获取新图片
 * 格式建议：YYYYMMDD 或递增数字
 *
 * 示例：
 * - 初始版本：'1'
 * - 2025年1月更新：'20250120'
 * - 下次更新：'20250215'
 */
export const IMAGE_VERSION = '20260130'

/**
 * 生成线路 TOPO 图片 URL
 *
 * @param cragId - 岩场 ID
 * @param routeName - 线路名称
 * @param timestamp - 可选时间戳，用于刚上传后强制刷新缓存
 */
export function getRouteTopoUrl(
  cragId: string,
  routeName: string,
  timestamp?: number
): string {
  const version = timestamp ? `t=${timestamp}` : `v=${IMAGE_VERSION}`
  return `${IMAGE_BASE_URL}/${cragId}/${encodeURIComponent(routeName)}.jpg?${version}`
}

/**
 * 生成岩场封面图片 URL (带版本号)
 *
 * @param cragId - 岩场 ID
 * @param index - 封面图索引
 * @param timestamp - 可选时间戳，用于刚上传后强制刷新缓存
 */
export function getCragCoverUrl(cragId: string, index: number, timestamp?: number): string {
  const version = timestamp ? `t=${timestamp}` : `v=${IMAGE_VERSION}`
  return `${IMAGE_BASE_URL}/CragSurface/${cragId}/${index}.jpg?${version}`
}

/**
 * 生成岩面 Topo 图片 URL
 * R2 路径: {cragId}/{area}/{faceId}.jpg
 *
 * @param cragId - 岩场 ID
 * @param area - 区域名称
 * @param faceId - 岩面 ID
 * @param timestamp - 可选时间戳，用于刚上传后强制刷新缓存
 */
export function getFaceTopoUrl(
  cragId: string,
  area: string,
  faceId: string,
  timestamp?: number
): string {
  const version = timestamp ? `t=${timestamp}` : `v=${IMAGE_VERSION}`
  return `${IMAGE_BASE_URL}/${encodeURIComponent(cragId)}/${encodeURIComponent(area)}/${encodeURIComponent(faceId)}.jpg?${version}`
}

/**
 * 智能获取 Topo 图片 URL（兼容新旧数据）
 * - 有 faceId: 使用岩面图片路径
 * - 无 faceId: 回退到线路名称图片路径
 *
 * @param route - 线路数据
 * @param timestamp - 可选时间戳
 */
export function getTopoImageUrl(route: Route, timestamp?: number): string {
  const face = getPrimaryFaceIdentity(route)
  if (face) {
    return getFaceTopoUrl(face.cragId, face.area, face.faceId, timestamp)
  }
  return getRouteTopoUrl(route.cragId, route.name, timestamp)
}
