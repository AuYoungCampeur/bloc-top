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
| `/crags/new` | admin 新建岩场；字段校验、失败后保留输入、创建后进入详情 | `src/app/crags/new/page.tsx` |
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

岩面列表来自 R2 对象，不是单独的数据库实体。上传使用 `FormData`，服务端校验岩场权限和存在性，再以 `cragId/area/faceId.jpg` 写入 R2。大图压缩在客户端按需动态导入。检查失败不会直接尝试上传；确认覆盖必须携带检查时的 ETag，目标或文件变化需重新确认，冲突返回 409。

两端复用共享 `face-api` / `face-management`。改名先条件复制新图，再改所有匹配标注与兼容字段，最后清旧图；删除先清引用再删图。以完整岩场+区域+岩面匹配，保留其他标注。成功响应返回服务端 Topo 字段，后台合并时保留当前 Beta 和文字。

服务可能返回 `partial`、`cleanupPending`、`revisionPending` 或 `imageChangeUnknown`；页面显示警告并提供刷新核对，失败不保证全部回滚。引用写入保护自身快照，但晚到的旧线路保存及 HEAD→Delete 竞态仍未解决；不能把条件上传当作跨数据库/对象存储事务。

### 新建岩场与上下文

`/crags/new` 和 POST 都验证 ID、城市及坐标等字段。POST 仅 admin 可用，岩场和创建者 manager 授权在同一 MongoDB transaction 中写入；相同创建者/初始字段重试返回已有岩场，其他 ID 占用返回 409。创建失败保留表单。

岩场详情的岩面/线路入口带 `cragId` 参数，刷新保持目标；无权或不存在的目标显示错误，不悄悄改成第一个岩场。授权名单仅 admin 读取和管理，manager 的详情不会发送名单请求或把 403 当空名单。创建者回退查询使用 Mongo `_id`，入口/列表只包含实际存在的岩场。

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
| `/api/beta` | GET / POST / PATCH / DELETE | 公开读取；两端 POST 均要求登录和限流；修改/删除需岩场编辑权限 |
| `/api/crag-permissions` | GET/POST/DELETE | admin 管理岩场授权 |
| `/api/cities`、`/api/prefectures` | GET / POST | 公开读取 / admin 创建 |
| `/api/cities/[id]`、`/api/prefectures/[id]` | PATCH/DELETE | admin |

## 6. 接手事项与代码证据

这是接手检查与持续迭代的记录，并非完整安全审计。已实现的基础改进和仍需验收的业务流程分别列明。

| 顺序 | 已观察到的事实 | 后续工作与验收目标 |
| --- | --- | --- |
| 1 | 2026-10-02 共用环境认证配置，localhost Cookie/session 隔离存储集成测试通过 | 仍需验收真实邮箱、Passkey 设备和后台权限；独立 Preview 跨域登录及 alias Passkey 未完成 |
| 2 | 共用三元身份与多图引用变换、条件上传和准确部分失败响应；针对跨区域同名和多图有回归 | 仍需隔离真实 R2 验收；补旧线路保存的版本冲突和跨服务崩溃恢复 |
| 3 | 2026-10-02 两端复用 shared `createBetaHandlers`，提交认证、原子去重和缺失记录处理已统一 | 保留业务回归，后续完善发布通知与完整用户提交验收 |
| 4 | `revalidate-pwa.ts` 只记录失败，部分调用没有等待；face handler 现已等待通知，但共享路径帮助仍不含完整线路列表 | 梳理每个写入对应哪些缓存；补有限时长与可恢复通知，验收 PWA 新请求、已打开页面和其他客户端图片可见性 |
| 5 | Editor 已声明 `browser-image-compression`，根 frozen install 可恢复工作区依赖链接 | 仍需在隔离 bucket 验收大于 5 MB 图片上传和压缩失败恢复 |
| 6 | createdBy 回退已改用 `_id`，入口/列表包含创建者并过滤遗留孤儿授权；分配授权验证目标用户/岩场存在 | 仍需角色变更与旧迁移数据实测；名单政策保持 admin-only |
| 7 | `migrate-crag-ownership.ts` 仍写入 `role: 'creator'`，当前类型只接受 manager | 先核实实际数据与迁移意图，再修订脚本；不要直接运行旧迁移 |
| 8 | 多图 dirty check 包含 area，Beta 独立更新保留 Topo 草稿；兼容字段增加 `faceArea` | 继续验证慢保存/并发操作；Topo 版本条件协议尚未实现 |

源码入口：[权限函数](../packages/shared/src/permissions.ts)、[岩面 API](../apps/editor/src/app/api/faces/route.ts)、[上传 API](../apps/editor/src/app/api/upload/route.ts)、[后台 Beta API](../apps/editor/src/app/api/beta/route.ts)、[PWA Beta API](../apps/pwa/src/app/api/beta/route.ts)、[旧授权迁移脚本](../apps/pwa/scripts/migrate-crag-ownership.ts)。

这些问题收敛后，再按实际操作频率安排后台导航、批量录入、表单反馈等体验改进；本文不将这些建议记为已确定的产品需求。

## 7. 当前工作区与验证基线

2026-09-20 接手时主工作区已有以下内容，原文件一直保留未改：

- `.serena/project.yml` 有修改。
- `apps/editor/src/app/crags/new/` 为未跟踪目录，含页面与测试。
- `apps/editor/src/components/editor/crag-permissions-panel.test.tsx` 为未跟踪测试。

2026-10-02 的下一批内容开发在独立 worktree 中评审、完善了新建页和权限面板测试副本，主工作区原文件不受影响。当前源码功能和发布状态分别以本指南与 [PRODUCT.md](PRODUCT.md) 为准；以下为历史验证基线。

2026-09-20 本机运行（Node 22.22.0，pnpm 10.29.3；仓库 `.nvmrc` 为 20）：

| 检查 | 结果与边界 |
| --- | --- |
| `pnpm --filter @bloctop/editor test:run` | 14 个文件、139 项测试通过，包含上述未跟踪测试；权限面板测试有 React act 警告 |
| `pnpm typecheck` | 四个 workspace 成功；Editor 实际执行，PWA/shared/ui 命中 Turbo 缓存 |
| 文档链接与路径检查 | 9 份 Markdown 的 67 个相对文件链接通过，新增配置模板可被 Git 跟踪；`git diff --check` 通过 |
| 浏览器/生产构建/外部服务 | 本次未执行完整浏览器验收或生产构建，未验证线上登录、MongoDB、Resend、R2 或部署状态 |

后续业务修改至少覆盖：admin、只有岩场 A 权限的 manager、无权限 user；单图旧数据与多图新数据；保存/取消/刷新；重命名/删除/覆盖图片；后台到 PWA 的刷新。涉及实际写入时使用隔离开发数据。
