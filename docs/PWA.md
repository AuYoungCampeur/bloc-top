# 用户端、Topo 与缓存数据流

> 核对日期：2026-10-02。用户端是后台内容的消费端；修改后台时需要检查这里的兼容性。

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

用户端岩面缩略图从已加载的公开线路引用派生，不请求需要编辑权限的 `/api/faces`。新的 face 筛选链接包含完整三元身份，能选择多图的非第一张；旧 bare faceId 链接仍兼容，重复名称的旧链接可能包含多个匹配。

共享 face identity 帮助函数同时供图片 URL、同岩面分组、离线下载和后台管理消费；现代多图按对应图片投影几何。修改引用时仍需检查这些入口，不能只验证抽屉里的轮播。

## 五种缓存不能混为一谈

| 层 | 当前实现 | 刷新与限制 |
| --- | --- | --- |
| 服务端数据读取 | 共享 DB 函数、React `cache()` | 渲染中的调用去重，不是完整持久化数据缓存 |
| Next 页面/路由 | 页面 revalidate 字面量、Next 默认路由缓存 | Editor webhook 调用 PWA revalidate；不是即时刷新所有已打开客户端 |
| HTTP 与 API | 天气内存缓存、Cache-Control、SWR | 不同接口不同策略；SWR 天气请求同 key 一分钟去重 |
| 浏览器图片 | FaceImageCache 内存 Map、岩场 `mediaRevision` URL、Next Image、SW | 在线阅读使用同一完整内容包的图片版本和 Topo；焦点/重新联网会尝试更新，不是实时推送 |
| 主动离线下载 | IndexedDB + Cache API + localStorage | 用户保存的本地快照，和在线重验证独立 |

具体参数来自 [cache-config.ts](../packages/shared/src/cache-config.ts)、[next.config.ts](../apps/pwa/next.config.ts) 和 [sw.ts](../apps/pwa/src/app/sw.ts)：

- 页面导出：首页 86,400 秒，线路列表/岩场详情 2,592,000 秒；首页/线路列表又使用 `cookies()`，不能仅凭这些字面量判断实际页面是静态 ISR。
- 已移除客户端 dynamic/static 一年的 `staleTimes` 覆盖，使用 Next 默认值；已打开页面另有下面的完整内容刷新机制。
- SW R2 图片：优先离线图片缓存，回退 CacheFirst，200 项/一年。Next Image minimumCacheTTL 也为一年。
- SW HTML：NetworkFirst，5 秒超时、50 项/7 天。
- SW API：仅明确公开的 GET allowlist 使用 NetworkFirst（3 秒超时、100 项/一天，`public-api-v1`）。其余 `/api/` 先由 NetworkOnly 拦截，避免落入 Serwist 默认的宽泛 API 规则。认证、账号、权限、管理、IP 定位及 Beta 不进入离线 API 缓存；显式 no-store/no-cache 请求和 private/no-store/no-cache 响应也不写入公开缓存。升级清理旧 `api-data`/`apis` 及其他缓存内遗留 API 条目。
- 天气：服务端内存缓存与 HTTP 缓存均一小时；Beta GET 返回 `no-store`。线路详情打开时实时读取 Beta，提交成功后直接用 POST 返回的记录更新当前界面；未重新打开详情的其他客户端不会收到实时推送。
- Beta 手动刷新失败时保留已显示的列表并提供重试；错误按线路隔离，其他线路的迟到请求不会误报当前线路失败。打开外链与复制链接是独立控件。

`FaceImageCache.invalidate(faceKey)` 生成 `?t=timestamp` URL 并通知当前应用订阅者，仍不跨浏览器广播。在线岩场详情、线路列表和打开的 Topo 使用 `useOnlineCragContent`：进入、窗口重新获得焦点、页面恢复可见或重新联网时，读取 `no-store` 的岩场→线路→岩场数据，最多重试一次、10 秒超时。前后岩场内容相同才整体采用；失败保留最后完整内容，下一次事件可重试。按 ID 恢复已选线路，缩略图、大图和标注使用同一包的 `mediaRevision`，迟到的旧岩场响应不能覆盖当前岩场。

这一读取屏障不能令 Mongo 与 R2 原子提交，`mr` query 也不能保存 mutable R2 key 的历史字节。已下载的离线快照独立于在线刷新，使用自己的 manifest、URL 和实际缓存字节。完整媒体生命周期与并发删除风险见[产品验收记录](PRODUCT.md)。

## 离线资料与当前限制

实现入口：[offline-snapshot.ts](../apps/pwa/src/lib/offline-snapshot.ts)、[offline-download.ts](../apps/pwa/src/lib/offline-download.ts)、[offline-storage.ts](../apps/pwa/src/lib/offline-storage.ts)、[offline-browser.tsx](../apps/pwa/src/components/offline-browser.tsx)。`use-offline-download` 和 provider 将下载进度同步至入口。

- `GET /api/crags/[id]/offline` 返回 `no-store` 的完整公开快照；内容 hash 包括岩场、线路和 `mediaRevision`，不再只用线路数判断过期。同数修改和删除也能发现。
- manifest 按实际封面、新旧岩面和所有多图引用去重，添加 `offlineRevision` URL 参数。该图片请求直接走网络，防止 SW 在线缓存污染下载重试。
- 图片必须可读、HTTP 成功、类型正确且能解码；opaque/CORS 失败不计成功。进度区分处理数、缓存数、失败数，任一必需图片失败不发布新快照，旧下载仍可用。
- IndexedDB `offline-crags` v2 保存岩场、线路、图片 manifest 和下载信息；在事务完成后才发布可用状态。Cache API `offline-crag-images` 保存通过检查的图片；localStorage 元数据供轻量展示，同标签页通过事件更新。
- 离线入口 `/{locale}/offline?offlineCrag=id&offlineRoute=number` 从 IndexedDB/Cache 读取详情和多图 Topo，不经 Next Image optimizer 或在线 API。旧下载允许浏览并提示更新修复。
- 删除入口统一清理快照、图片和元数据；旧版本/删除后的图片清理任务保存在 IndexedDB，失败保留待重试任务。两个独立存储不构成事务；协作标签页用每岩场 Web Locks 串行化下载、删除和媒体清理，BroadcastChannel 通知取消及刷新。支持这些 API 的 Chromium 下已通过本地真实浏览器并发验收；不支持 Web Locks 时仅保证同标签页队列，不宣称旧浏览器跨标签页串行。
- 同标签页每岩场的下载/删除串行，删除取消进行中和已排队下载；网络与解码请求有超时，迟到响应不能发布被取消快照。旧标签页阻塞 IDB 升级时明确反馈，释放失败单例供重试；版本变化关闭旧连接。离线指示条使用原生链接进入本地资料壳。
- `next.config.ts` 在开发环境关闭 Service Worker；普通 `pnpm dev` 不能验收生产离线效果。

离线下载使用浏览器可读的跨域 `fetch`，图片能在 `<img>` 中显示并不证明它可下载到 Cache API。2026-10-02 实查发现生产 R2 bucket 没有 CORS，已配置 GET/HEAD 规则：origins 为 `https://bouldering.top`、`https://www.bouldering.top`、`https://editor.bouldering.top`、`http://localhost:3000`、`http://localhost:3001`；允许请求 headers `*`、暴露 `ETag`、preflight 缓存 3600 秒。没有修改图片或数据库。

配置后在 www、editor、localhost:3000 三个浏览器 origin 对同一现有公开图片执行实际 CORS GET、解码、Cache API 保存及断网解码，全部成功，图片响应未 mock。这只验证采样图片和这些 origin；整包下载、其他缓存变体和 Safari 仍以各自业务验收为准。自定义域名的旧缓存可能需要清理后获得新的 CORS headers，参见 [Cloudflare R2 CORS 文档](https://developers.cloudflare.com/r2/buckets/cors/)。

## 天气与语言

`useWeather` 通过 `/api/weather` 读取数据：优先使用城市 adcode，无 adcode 时使用坐标。服务端向高德请求并缓存；天气组件使用 `Weather.weatherDesc`、`windDir` 等翻译映射，未收录描述回退原始文本。不要为切换语言复制一份天气业务数据。

旧天气研究文档中的部分问题已有客户端翻译映射实现，现状以 weather-strip/weather-card 与三个语言文件为准。高德服务本次没有联网验收。

## 移动客户端接口

[GET /api/mobile/sync](../apps/pwa/src/app/api/mobile/sync/route.ts) 一次返回 `crags`、`routes`、`lastUpdated`，公开缓存一天，没有增量游标、分页或认证。`lastUpdated` 是本次响应生成时间。

[iOS PRD](PRD_iOS_Migration.md) 保留为 2026-02 的历史需求参考，不表示当前仓库已实现原生客户端，也不改变接下来优先处理后台的方向。
