import { cookies } from 'next/headers'
import {
  getCragsByCityId, getRoutesByCityId,
  getCragsByPrefectureId, getRoutesByPrefectureId,
  getAllCities, getAllPrefectures,
} from '@/lib/db'
import { isCityValid, DEFAULT_CITY_ID, CITY_COOKIE_NAME, parseCitySelection, findCityByAdcode } from '@/lib/city-utils'
import RouteListClient from './route-client'

// ISR: 每月重新验证 - 配置见 @/lib/cache-config.ts
export const revalidate = 2592000 // 30 天 (秒)

/**
 * 线路列表页面
 *
 * 读取城市 cookie，只加载该城市/地级市的岩场和线路。
 * 与首页使用相同的城市解析逻辑，确保数据范围一致。
 *
 * 注意：这里故意不使用 Suspense 包裹 RouteListClient
 * 因为 RouteListClient 内部使用了 useSearchParams，
 * 如果被 Suspense 包裹，每次 URL 参数变化都会触发 fallback 显示，导致闪烁。
 */
export default async function RouteListPage() {
  // The city choice belongs to this request; do not query data during the build.
  const cookieStore = await cookies()
  const [cities, prefectures] = await Promise.all([
    getAllCities(),
    getAllPrefectures(),
  ])

  // 解析 cookie 中的城市选择（与首页逻辑一致）
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
  let crags, routes
  if (selection.type === 'prefecture') {
    ;[crags, routes] = await Promise.all([
      getCragsByPrefectureId(selection.id),
      getRoutesByPrefectureId(selection.id),
    ])
  } else {
    ;[crags, routes] = await Promise.all([
      getCragsByCityId(selection.id),
      getRoutesByCityId(selection.id),
    ])
  }

  return <RouteListClient routes={routes} crags={crags} />
}
