# 管理后台接手指南

> 核对日期：2026-09-20。接下来开发重点为 `apps/editor`。本文区分已有实现、当前工作区内容、代码检查发现和待验收行为。

## 1. 后台是什么

后台是独立 Next.js 应用，开发端口 3001。界面名称为「Topo 编辑器」，实际管理范围已经包括岩场、图片、线路、Beta、城市和用户。管理人员通过 PWA 登录，再进入后台。

业务主线：**城市/地级市 → 岩场 → 区域与岩面 → 线路、多图 Topo → Beta**。用户与岩场授权决定谁可以维护这些内容。

## 2. 页面地图

所有路径相对 Editor 域名，无语言前缀。

| 路径 | 当前功能 | 核心入口 |
| --- | --- | --- |
| `/` | 功能入口卡片；用户/城市入口对 admin 展示 | `src/app/page.tsx` |
| `/crags` | 按权限显示岩场列表和新建入口 | `src/app/crags/page.tsx` |
| `/crags/new` | 新建岩场表单；**当前工作区未跟踪，不能当作已提交功能** | `src/app/crags/new/page.tsx` |
| `/crags/[id]` | 岩场信息、坐标、接近说明与管理员面板 | `src/app/crags/[id]/page.tsx` |
| `/faces` | 按岩场/区域管理照片，上传、覆盖、改名、删除 | `src/app/faces/page.tsx` |
| `/routes` | 线路列表、创建/编辑/删除、Topo 多图标注、Beta 标签页、内嵌岩面上传 | `src/app/routes/page.tsx` |
| `/cities` | 城市、地级市及可用状态配置 | `src/app/cities/page.tsx` |
| `/users` | 邮箱搜索、分页、修改 admin/user 角色 | `src/app/users/page.tsx` |

代码定义了 `canDeleteCrag()` 权限函数，但当前 `/api/crags/[id]` 只有 GET/PATCH，没有 DELETE；不要把「允许删除」写成已经存在的删除岩场流程。用户页目前也不是完整的封禁/删除/审计控制台。

## 3. 优先阅读的代码

以下路径相对 `apps/editor/`，除特别说明外。

| 模块 | 文件 | 重点 |
| --- | --- | --- |
| 访问控制 | `src/proxy.ts`、`src/app/layout.tsx` | proxy 只预检查 Cookie；动态 layout 校验 session 与后台权限 |
| 登录实例 | `src/lib/auth.ts`、`src/lib/require-auth.ts` | 共享 MongoDB、独立实例、鉴权工厂注入 |
| 岩场列表 | `src/app/api/editor/crags/route.ts`、`src/hooks/use-crag-routes.ts` | admin 看全部，其他用户按授权筛选 |
| 线路工作台 | `src/app/routes/page.tsx` | 选择岩场/线路，Topo/Beta 标签，组合多个 hook |
| 表单与标注 | `src/hooks/use-route-editor.ts` | 多标注状态、保存、旧字段兼容、脏数据检查、全屏编辑快照 |
| 创建与离开保护 | `src/hooks/use-route-creation.ts`、`src/hooks/use-dirty-guard.ts` | 创建线路、切换时保存/放弃 |
| 岩面管理 | `src/hooks/use-face-data.ts`、`src/hooks/use-face-upload.ts` | R2 列表、改名/删除、本地缓存失效、上传压缩 |
| Beta 管理 | `src/hooks/use-beta-management.ts` | 列表更新、编辑和删除 |
| 组件 | `src/components/editor/` | TopoPreview、FullscreenTopoEditor、FaceSelector、各类表单/确认弹窗 |
| 跨端刷新 | `src/lib/revalidate-pwa.ts` | 写入后通知 PWA |
| 共享基础 | `packages/shared/src/types/index.ts`、`db/index.ts`、`permissions.ts`（仓库根目录下） | 数据契约、持久化和权限 |

## 4. 线路与图片操作如何落地

### 编辑线路与多图标注

1. 页面选择线路后，`useRouteEditor` 初始化普通字段及 `annotations`。
2. 有非空 `topoAnnotations` 就读取新数据，否则从有效旧字段建立单条标注。
3. 添加岩面生成一个空标注；编辑点、张力和切换标注都先操作本地状态。选择岩面本身不立即 PATCH。
4. 点击保存时只保留至少两个点的标注，把数组与表单字段一起 PATCH；第一条有效标注同步至旧字段，无有效标注时旧字段传 null。
5. API 校验 session、该线路所属岩场权限和字段，再通过共享 DB 更新。
6. 成功响应替换本地线路数据，调用 PWA 重验证。未完成的单点/空标注不会保存。

完整实现：[use-route-editor.ts](../apps/editor/src/hooks/use-route-editor.ts)、[线路 API](../apps/editor/src/app/api/routes/[id]/route.ts)。全屏编辑取消会恢复进入时的标注快照；路由切换保护由 `useDirtyGuard` 协调。

### 管理岩面

岩面列表来自 R2 对象，不是单独的数据库实体。上传使用 `FormData`，服务端校验岩场权限，再以 `cragId/area/faceId.jpg` 写入 R2。大图压缩在客户端按需动态导入。

改名先复制 R2 对象，再删除旧对象并更新线路引用；删除图片后清理关联旧字段。当前这些操作对多图数组的同步不完整，见下方接手事项。数据库与对象存储之间没有事务保证。

### 管理 Beta

`/routes` 的 Beta 标签复用 `useBetaManagement`、BetaCard 和提交抽屉。数据保存在 `Route.betaLinks` 中，当前平台类型只有 `xiaohongshu`。API 接受小红书笔记链接及 `xhslink.com`、`xhslink.cn` 短链接，从分享文本提取 URL、跟踪短链并按笔记 ID 去重；并没有独立的待审核队列。短链若落到带笔记 `redirectPath` 的小红书登录页，会还原笔记地址，但小红书内容本身仍可能要求登录查看。

## 5. Editor API 清单

路径位于 `apps/editor/src/app/api/`。下表描述当前服务端行为，页面是否显示入口不是权限依据。

| 路径 | 方法 | 当前访问边界/用途 |
| --- | --- | --- |
| `/api/auth/[...all]` | GET/POST | better-auth 处理；Editor 也有 catch-all |
| `/api/editor/crags` | GET | 登录后返回可编辑岩场、角色、canCreate |
| `/api/editor/search-users` | GET | 有后台访问权限者搜索用户 |
| `/api/crags` | GET / POST | 公开读取 / admin 创建 |
| `/api/crags/[id]` | GET / PATCH | 公开读取 / 对应岩场编辑权限 |
| `/api/crags/[id]/areas` | PATCH | 对应岩场编辑权限 |
| `/api/crags/[id]/routes` | GET | 公开读取该岩场线路 |
| `/api/routes` | POST | 对应岩场编辑权限；没有 GET 列表实现 |
| `/api/routes/[id]` | GET / PATCH / DELETE | 公开读取 / 编辑和删除需对应岩场权限 |
| `/api/faces` | GET/PATCH/DELETE | 均需登录及对应岩场编辑权限 |
| `/api/upload` | POST | 登录及对应岩场编辑权限 |
| `/api/beta` | GET / POST / PATCH / DELETE | 公开读取；**Editor POST 当前仅限流，无登录校验**；修改/删除需岩场编辑权限 |
| `/api/crag-permissions` | GET/POST/DELETE | admin 管理岩场授权 |
| `/api/cities`、`/api/prefectures` | GET / POST | 公开读取 / admin 创建 |
| `/api/cities/[id]`、`/api/prefectures/[id]` | PATCH/DELETE | admin |

## 6. 接手事项与代码证据

这是本次阅读发现的具体事项，并非完整安全审计，也未在本轮修改业务代码。

| 顺序 | 已观察到的事实 | 后续工作与验收目标 |
| --- | --- | --- |
| 1 | 两端 `src/lib/auth.ts` 无条件写死 `.bouldering.top` Cookie 域、生产 trustedOrigins | 区分开发/生产认证设置；验证 localhost 登录 → Editor → 刷新 → 退出完整流程 |
| 2 | 两端 `api/faces/route.ts` 改名/删除只更新顶层 `faceId`/`topoLine`，匹配也没有 `area`；上传的清标注逻辑仍使用旧字段 | 同步处理 `topoAnnotations` 与旧字段；用同岩场不同区域同名岩面、多视角线路验证不串改、不留失效引用 |
| 3 | PWA `api/beta/route.ts` POST 已有 requireAuth，Editor 同名 POST 没有 | 统一两个入口的提交政策与认证测试，避免只修用户端 |
| 4 | `revalidate-pwa.ts` 只记录失败，多处调用没有等待；Beta/上传没有完整刷新通知；共享 `revalidate-helpers.ts` 不包含线路列表 | 梳理每个写入对应哪些缓存；验证后台保存后 PWA 新请求与已打开页面的可见性 |
| 5 | Editor `use-face-upload.ts` 动态导入 `browser-image-compression`，但 Editor 的 package.json 未声明；该依赖目前只在 PWA 声明 | 补齐包边界并在干净安装环境验证大于 5 MB 图片上传 |
| 6 | `permissions.ts` 的 createdBy 回退查询使用 `{ id: cragId }`，而 DB 使用 `_id`；后台入口与列表仅看授权记录 | 明确 createdBy 回退是否仍需要，使编辑/入口/列表的权限语义一致 |
| 7 | `migrate-crag-ownership.ts` 仍写入 `role: 'creator'`，当前类型只接受 manager | 先核实实际数据与迁移意图，再修订脚本；不要直接运行旧迁移 |
| 8 | 多图状态的 dirty check 比较 faceId、点和张力，但未比较 annotation.area；旧字段没有独立的图片区域字段 | 补充跨区域标注、切换与放弃编辑测试，确定旧消费路径的兼容方式 |

源码入口：[权限函数](../packages/shared/src/permissions.ts)、[岩面 API](../apps/editor/src/app/api/faces/route.ts)、[上传 API](../apps/editor/src/app/api/upload/route.ts)、[后台 Beta API](../apps/editor/src/app/api/beta/route.ts)、[PWA Beta API](../apps/pwa/src/app/api/beta/route.ts)、[旧授权迁移脚本](../apps/pwa/scripts/migrate-crag-ownership.ts)。

这些问题收敛后，再按实际操作频率安排后台导航、批量录入、表单反馈等体验改进；本文不将这些建议记为已确定的产品需求。

## 7. 当前工作区与验证基线

本轮开始前已有以下内容，本轮保留未改：

- `.serena/project.yml` 有修改。
- `apps/editor/src/app/crags/new/` 为未跟踪目录，含页面与测试。
- `apps/editor/src/components/editor/crag-permissions-panel.test.tsx` 为未跟踪测试。

2026-09-20 本机运行（Node 22.22.0，pnpm 10.29.3；仓库 `.nvmrc` 为 20）：

| 检查 | 结果与边界 |
| --- | --- |
| `pnpm --filter @bloctop/editor test:run` | 14 个文件、139 项测试通过，包含上述未跟踪测试；权限面板测试有 React act 警告 |
| `pnpm typecheck` | 四个 workspace 成功；Editor 实际执行，PWA/shared/ui 命中 Turbo 缓存 |
| 文档链接与路径检查 | 9 份 Markdown 的 67 个相对文件链接通过，新增配置模板可被 Git 跟踪；`git diff --check` 通过 |
| 浏览器/生产构建/外部服务 | 本次未执行完整浏览器验收或生产构建，未验证线上登录、MongoDB、Resend、R2 或部署状态 |

后续业务修改至少覆盖：admin、只有岩场 A 权限的 manager、无权限 user；单图旧数据与多图新数据；保存/取消/刷新；重命名/删除/覆盖图片；后台到 PWA 的刷新。涉及实际写入时使用隔离开发数据。
