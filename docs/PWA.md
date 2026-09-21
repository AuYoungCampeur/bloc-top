# 用户端、Topo 与缓存数据流

> 核对日期：2026-09-20。用户端是后台内容的消费端；修改后台时需要检查这里的兼容性。

## 用户端范围

`apps/pwa` 负责中/英/法三语岩场浏览、线路筛选与搜索、Topo/Beta 抽屉、天气地图、账号、头像和离线资料。页面位于 `src/app/[locale]/`；翻译位于 `messages/{zh,en,fr}.json`；导航使用 `src/i18n/navigation.ts` 的 locale-aware 工具。

在线线路详情由 `route-detail-drawer.tsx` 展示，而不是独立 `/route/[id]` 页面。离线页面有独立的岩场和线路详情路由。

## 城市 → 岩场 → 线路

1. `src/proxy.ts` 处理语言路由及首次访问时的 IP 城市检测。
2. 城市选择 Cookie 由共享 `city-utils.ts` 解析，支持单区县和地级市聚合。
3. 首页与线路列表的 Server Components 读取 Cookie，根据选择从 MongoDB 加载该范围内岩场与线路；不是每次给客户端发送全库数据再做城市隔离。
4. `home-client.tsx` / `route-client.tsx` 负责后续搜索、岩场、区域、难度等界面筛选。
5. 岩场详情按 URL 岩场 ID 读取，不依赖用户当前城市选择。

城市元数据存在数据库；默认城市等回退值在共享工具里。新增城市需要同时准备 cities/prefectures、岩场 cityId、adcode 和实际线路，不能只在前端新增显示名称。

关键入口：[首页](../apps/pwa/src/app/[locale]/page.tsx)、[线路列表](../apps/pwa/src/app/[locale]/route/page.tsx)、[城市工具](../packages/shared/src/city-utils.ts)。

## Topo 展示

`getTopoAnnotations(route)` 统一读取新数组及旧数据回退；`route-detail-drawer.tsx` 有多图展示和活动图片状态，共享 ImageViewer 用于全屏浏览。SVG 叠加层使用归一化坐标与共享曲线计算；多线路叠加、图例面板用于同岩面线路浏览和切换。

图片由 `packages/ui/src/face-image/` 的 Provider、hook 和缓存服务生成 URL。PWA 原有 `src/lib/face-image-cache` / `hooks/use-face-image` 主要作为兼容入口。使用岩面来源时必须包含 cragId、area、faceId，避免同名岩面混淆。

旧的顶层 faceId 仍被部分辅助函数消费。新功能不能只验证抽屉里的多图轮播，也要检查搜索入口、同岩面分组、离线下载和后台图片管理。

## 五种缓存不能混为一谈

| 层 | 当前实现 | 刷新与限制 |
| --- | --- | --- |
| 服务端数据读取 | 共享 DB 函数、React `cache()` | 渲染中的调用去重，不是完整持久化数据缓存 |
| Next 页面/路由 | 页面 revalidate 字面量、Next `staleTimes` | Editor webhook 调用 PWA revalidate；不是即时刷新所有已打开客户端 |
| HTTP 与 API | 天气内存缓存、Cache-Control、SWR | 不同接口不同策略；SWR 天气请求同 key 一分钟去重 |
| 浏览器图片 | FaceImageCache 内存 Map、URL 版本、Next Image、SW | 当前会话 invalidate 改变 URL；版本没有存入数据库或跨应用广播 |
| 主动离线下载 | IndexedDB + Cache API + localStorage | 用户保存的本地快照，和在线重验证独立 |

具体参数来自 [cache-config.ts](../packages/shared/src/cache-config.ts)、[next.config.ts](../apps/pwa/next.config.ts) 和 [sw.ts](../apps/pwa/src/app/sw.ts)：

- 页面导出：首页 86,400 秒，线路列表/岩场详情 2,592,000 秒；首页/线路列表又使用 `cookies()`，不能仅凭这些字面量判断实际页面是静态 ISR。
- 客户端 `staleTimes` 的 dynamic/static 均设为一年；后台写入对已打开页面的可见性需单独验证。
- SW R2 图片：优先离线图片缓存，回退 CacheFirst，200 项/一年。Next Image minimumCacheTTL 也为一年。
- SW HTML：NetworkFirst，5 秒超时、50 项/7 天。
- SW API：NetworkFirst，3 秒超时、100 项/一天；matcher 广泛覆盖 `/api/`，没有显式排除 auth 路径，后续应核实敏感 GET 的缓存行为。
- 天气：服务端内存缓存与 HTTP 缓存均一小时；Beta GET HTTP 缓存一天。

`FaceImageCache.invalidate(faceKey)` 生成 `?t=timestamp` URL 并通知订阅者；未失效时使用共享 `IMAGE_VERSION`。这个内存事件不会同步到另一个浏览器或 PWA 应用。更换图片后的跨端可见性不能只靠 Editor 的本地 invalidate。

## 离线资料与当前限制

实现入口：[offline-storage.ts](../apps/pwa/src/lib/offline-storage.ts)、[use-offline-download.ts](../apps/pwa/src/hooks/use-offline-download.ts)、`offline-download-provider.tsx`。

- IndexedDB `offline-crags` 保存岩场、线路和下载信息。
- Cache API `offline-crag-images` 保存图片。
- localStorage `offline-crags-meta` 保存轻量状态。
- `/api/crags/[id]/version` 当前只返回线路数量，stale 判断主要检测新增线路，不是内容 hash/版本游标，无法完整发现文字修改、图片更新或删除。
- `collectImageUrls()` 仍从旧的线路名路径生成 Topo 图片 URL，没有遍历 `topoAnnotations`。因此多图在线展示的存在，不证明多图离线可用。
- `next.config.ts` 在开发环境关闭 Service Worker；普通 `pnpm dev` 不能验收生产离线效果。

## 天气与语言

`useWeather` 通过 `/api/weather` 读取数据：优先使用城市 adcode，无 adcode 时使用坐标。服务端向高德请求并缓存；天气组件使用 `Weather.weatherDesc`、`windDir` 等翻译映射，未收录描述回退原始文本。不要为切换语言复制一份天气业务数据。

旧天气研究文档中的部分问题已有客户端翻译映射实现，现状以 weather-strip/weather-card 与三个语言文件为准。高德服务本次没有联网验收。

## 移动客户端接口

[GET /api/mobile/sync](../apps/pwa/src/app/api/mobile/sync/route.ts) 一次返回 `crags`、`routes`、`lastUpdated`，公开缓存一天，没有增量游标、分页或认证。`lastUpdated` 是本次响应生成时间。

[iOS PRD](PRD_iOS_Migration.md) 保留为 2026-02 的历史需求参考，不表示当前仓库已实现原生客户端，也不改变接下来优先处理后台的方向。
