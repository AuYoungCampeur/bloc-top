import { cookies } from 'next/headers'
import {
  getCragsByCityId, getRoutesByCityId,
  getCragsByPrefectureId, getRoutesByPrefectureId,
  getAllCities, getAllPrefectures,
} from '@/lib/db'
import { isCityValid, DEFAULT_CITY_ID, CITY_COOKIE_NAME, parseCitySelection, findCityByAdcode } from '@/lib/city-utils'
import HomePageClient from './home-client'

// ISR: 安全网 — 即使自动 revalidation 失败，最多 1 天后也会刷新
// 注意: Next.js 要求使用字面量，不能使用变量引用
export const revalidate = 86400 // 1 天 (秒)

/**
 * 首页 - 岩场列表
 *
 * 使用 cookie 读取用户选择的城市/地级市，服务端直接过滤数据。
 * 支持两种模式：
 * - type: 'city' → 单区/县岩场
 * - type: 'prefecture' → 地级市下所有区/县岩场（聚合）
 */
export default async function HomePage() {
  // Read request state before database access so prerendering does not query it.
  const cookieStore = await cookies()
  const [cities, prefectures] = await Promise.all([
    getAllCities(),
    getAllPrefectures(),
  ])

  // 解析 cookie 中的选择（兼容旧格式纯字符串）
  const rawCity = cookieStore.get(CITY_COOKIE_NAME)?.value
  let selection = parseCitySelection(rawCity)

  // 处理 middleware 的 adcode 格式（首次访问，IP 检测）
  if (selection.type === 'city' && selection.id.startsWith('adcode:')) {
    const adcode = selection.id.slice(7)
    const matchedCity = findCityByAdcode(cities, prefectures, adcode)
    selection = matchedCity
      ? { type: 'city', id: matchedCity.id }
      : { type: 'city', id: DEFAULT_CITY_ID }
  }

  // 验证选择有效性，无效值兜底默认城市
  if (selection.type === 'city') {
    if (!isCityValid(cities, selection.id)) {
      selection = { type: 'city', id: DEFAULT_CITY_ID }
    }
  } else {
    if (!prefectures.some((p) => p.id === selection.id)) {
      selection = { type: 'city', id: DEFAULT_CITY_ID }
    }
  }

  // 根据选择类型分支查询
  let crags, allRoutes
  if (selection.type === 'prefecture') {
    ;[crags, allRoutes] = await Promise.all([
      getCragsByPrefectureId(selection.id),
      getRoutesByPrefectureId(selection.id),
    ])
  } else {
    ;[crags, allRoutes] = await Promise.all([
      getCragsByCityId(selection.id),
      getRoutesByCityId(selection.id),
    ])
  }

  // 裁剪 Route 数据，去除首页不需要的大字段 (description, image, setter)
  // 保留 topoLine，因为首页搜索打开 RouteDetailDrawer 需要用它渲染 Topo 线条
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const lightRoutes = allRoutes.map(({ description, image, setter, ...rest }) => rest)

  return (
    <HomePageClient
      crags={crags}
      allRoutes={lightRoutes}
      serverSelection={selection}
      cities={cities}
      prefectures={prefectures}
    />
  )
}
