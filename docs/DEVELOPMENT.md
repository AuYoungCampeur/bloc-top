# 开发、验证与部署

> 开发环境与命令于 2026-10-02 更新。逐次验证范围见 [产品迭代记录](PRODUCT.md)，不以构建通过代替真实服务验收。

## 1. 环境准备

仓库 `.nvmrc` 为 Node 22，根 `engines` 支持 22/24，packageManager 固定为 pnpm 10.29.3。Node 20 已结束官方支持；本地采用既有验证使用的 Node 22 LTS，CI 同时验证 Vercel 项目使用的 Node 24。版本状态见 [Node.js 官方发布记录](https://nodejs.org/en/about/previous-releases)。首次安装：

```bash
nvm use
corepack enable
pnpm install --frozen-lockfile
cp -n apps/pwa/.env.example apps/pwa/.env.local
cp -n apps/editor/.env.example apps/editor/.env.local
```

本轮补齐了两个应用的示例文件。Next 以各应用目录为工作目录，分别读取 `.env.local`；不要只在仓库根目录放配置。若本地还保留旧的根目录 `.env.example`，以新的应用内模板为准。模板全部为占位配置，不复制已有真实密钥。

## 2. 环境变量分工

| 变量 | PWA | Editor | 含义 |
| --- | --- | --- | --- |
| `MONGODB_URI` | 必需 | 必需 | MongoDB 连接；本地使用隔离开发数据 |
| `MONGODB_DB_NAME` | 必需 | 必需 | 没有代码默认值；两端联调时一致 |
| `BETTER_AUTH_SECRET` | 必需 | 必需 | 两端一致的 session 签名密钥，使用足够长的随机值 |
| `RESEND_API_KEY` | 认证初始化/邮件需要 | 不使用 | PWA 创建 Resend 实例并发送 Magic Link |
| `RESEND_FROM_EMAIL` | 邮件配置 | 不使用 | 缺省使用代码中的 Resend 测试发件人；实际可投递性需验证 |
| `NEXT_PUBLIC_EDITOR_URL` | 后台入口 | 不需要 | 本地填 `http://localhost:3001` |
| `NEXT_PUBLIC_PWA_URL` | 本地生产预览建议 | 必需 | PWA 认证 origin、Editor 登录跳转和缓存 webhook；本地填 `http://localhost:3000` |
| `NEXT_PUBLIC_APP_URL` | 当前源码未直接使用 | 回跳到后台 | Editor 本地填 `http://localhost:3001`；不是 better-auth baseURL 的自动配置 |
| `REVALIDATE_SECRET` | webhook 接收 | webhook 发送 | 两端一致；不带 NEXT_PUBLIC 前缀 |
| `NEXT_PUBLIC_AMAP_KEY` | 地图、定位、天气 | 不使用 | 地图 JS 与服务端高德请求共用当前配置 |
| `CLOUDFLARE_ACCOUNT_ID` | 保留的图片管理 API | 图片管理必需 | R2 S3 endpoint |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | 同上 | 图片管理必需 | 服务端凭据 |
| `R2_BUCKET_NAME` | 同上 | 图片管理必需 | 无代码默认值；隔离开发 bucket 的图片域名也需配套检查 |

`NEXT_PUBLIC_*` 会进入客户端构建，不能用于数据库、R2 或签名密钥。新增变量还要检查根目录 `turbo.json` 的 `globalEnv`；认证环境判定的 `VERCEL_ENV` / `VERCEL_URL` 和维护横幅的 `NEXT_PUBLIC_MAINTENANCE_MODE` 已列入透传配置。

图片公开域名目前在共享 constants、Next images 配置和 PWA SW/CSP 中写为 `img.bouldering.top`，不是一个可直接通过 `.env` 切换的配置项。

## 3. 启动与认证环境

```bash
pnpm dev
# 或分别启动
pnpm --filter @bloctop/pwa dev
pnpm --filter @bloctop/editor dev
```

PWA 默认 3000，Editor 开发脚本固定 3001。后台首次访问会重定向到 PWA 登录；只有 admin 或有岩场授权的用户能进入。只启动后台不能完成首次登录。

两端 `src/lib/auth.ts` 复用 shared `auth-runtime` 配置（2026-10-02）：

- 开发：host-only、非 Secure Cookie，共同信任 `http://localhost:3000` 和 `http://localhost:3001`，RP ID 为 `localhost`。两端请使用同一 hostname，不混用 localhost 与 127.0.0.1。
- Vercel production：Secure Cookie，域 `.bouldering.top`，信任明确生产 origins，RP ID `bouldering.top`；配置地址必须使用 HTTPS。
- Vercel Preview：Secure host-only Cookie，使用 `VERCEL_URL` 的 origin/RP ID，不向 `.vercel.app` 扩大 Cookie 共享。独立 Preview 的跨应用登录尚未建立。
- 本地 `next start`：若明确配置的应用 URL 均为 localhost 且不是 Vercel 部署，使用开发 Cookie，便于验证生产构建。

认证配置有 Cookie 属性测试和实际 better-auth + 隔离内存 adapter 的登录/跨端 session/退出集成测试，另有从 1.4.18 生成的旧密码与签名 Cookie 固定向量兼容验证。真实 Magic Link 投递、已有账号登录、Passkey 设备及后台权限仍需使用隔离开发环境验收，不能用配置测试替代。

## 4. 检查命令与实际覆盖

| 命令 | 范围 |
| --- | --- |
| `pnpm typecheck` | 应用先 `next typegen` 更新路由类型，再执行四个包的 `tsc --noEmit`；由 Turbo 调度，可能命中缓存 |
| `pnpm lint` | 定义了 lint 的 PWA 与 Editor；共享包没有独立 lint script |
| `pnpm test` / `pnpm test:run` | PWA、Editor、shared 的 Vitest；ui 没有独立 test script |
| `pnpm --filter @bloctop/editor test:run` | 后台组件、hook、逻辑测试 |
| `pnpm --filter @bloctop/shared test:run` | 权限、数据层及工具函数 |
| `pnpm --filter @bloctop/shared test:integration:mongo` | 显式本地副本集中的事务/并发验收；不读取应用 env |
| `pnpm test:ct` | PWA 的 Playwright 组件测试，非完整双端 E2E |
| `pnpm build` | 两个应用的生产构建；PWA 使用 `next build --webpack` |

Vitest 单元/组件测试使用 `*.test.ts(x)`，Playwright 组件测试使用 `*.ct.tsx`。三个测试包及应用 coverage 均固定 Vitest 4.1.11，根 pnpm override 保证 `jest-dom/vitest` 解析到同一 runner；安装后不能只核对各包 CLI 版本，还要避免 peer 解析出的第二份 Vitest。

三个 Vitest 包各限制为最多 2 个 worker，根测试命令逐包执行；pre-push 的类型、Vitest、浏览器检查也依次执行，避免共享电脑上重度并发占用 CPU/内存。真实认证库的多步骤隔离会话测试单独使用 15 秒超时；它检查行为，不测生产登录延迟。

2026-10-02 工作区全量 lint、类型检查、Vitest、Playwright 组件测试和双应用生产构建均通过；lint 有既有警告。工作区包含未集成的新建岩场页面与测试，不能将这些检查当作已提交版本或真实生产流程的验收。干净版本验证和发布结果另记于[产品迭代记录](PRODUCT.md)。

Git hooks 实际行为：

- `.husky/pre-commit` 执行 `lint-staged`；根配置匹配 PWA 和 Editor 文件。共享包仍需运行整包检查。
- `.husky/pre-push` 依次执行类型检查、Vitest、Playwright，没有单独执行 ESLint；检查提交快照，并恢复暂存的工作区/未跟踪改动，恢复失败会保留 stash 并报告。
- 不要用「push 成功」替代后台 lint。也不要直接运行 pre-push 来做普通检查，它会暂存工作区改动。

pre-push 的成功和失败路径已在临时 Git 仓库验证：仅检查提交快照，保留并恢复 staged、unstaged、untracked 改动及原有 stash。

CI 在 Node 22/24 下分别执行全部检查与构建，以及固定镜像的本地 Mongo 副本集验收和严格下载/离线浏览 smoke；四个汇总检查沿用 main 保护规则要求的 `🔍 ESLint`、`📘 TypeScript`、`🧪 Unit Tests`、`🎭 Playwright` 名称，只有整个矩阵成功才通过。

仓库 [verify skill](../.agents/skills/verify/SKILL.md) 已改为上述 pnpm 工作区验证入口；它不授予提交/发布权限，也不将组件测试当作真实服务验收。

## 5. 生产构建与部署配置

代码按两个独立 Vercel 应用设计。恢复部署时应核实各项目 Root Directory 分别指向 `apps/pwa` / `apps/editor`，能解析根 workspace 与锁文件，并分别配置环境变量。此处是部署检查清单，不代表远端已如此设置。

```bash
pnpm build
# 本地预览生产构建时显式指定两个端口
pnpm --filter @bloctop/pwa exec next start -p 3000
pnpm --filter @bloctop/editor exec next start -p 3001
```

两个应用的 `start` 都只是 `next start`，并不会自动沿用 Editor dev 的 3001。PWA 开发模式禁用 SW，离线验收需生产构建预览。数据页在请求时读取 MongoDB；构建无需数据库、认证、邮件或 R2 凭据，字体通过仓库内的许可文件使用 `next/font/local`，不再在构建时向 Google Fonts 请求。运行这些页面和 API 时仍需真实环境配置。

`.github/workflows/ci.yml` 在 PR 和 main/codex 分支提交时，以 Node 22/24 执行 frozen install、lint、类型、隔离 Vitest、Chromium 组件测试和无服务凭据双应用构建。远端执行结果应独立核对；组件测试不覆盖完整用户业务流程。

部署相关联动：域名与 HTTPS、Cookie 共享、可信 origins、Passkey RP ID、R2 图片域名与 CORS、两端一致的重验证密钥、Editor 到 PWA webhook 的可达性。认证安全升级需要两端使用同一依赖版本，旧的待使用 Magic Link 需要重新申请；具体条件、验证边界和回滚限制见[安全升级说明](SECURITY.md)。

新建岩场采用 MongoDB transaction，需要 replica set 或 mongos；普通 standalone 开发库不能验证此流程。R2 上传默认 create-only，覆盖需要 checkOnly 得到的 ETag；API 的 partial 响应可能表示引用已变或图片写入状态不确定，重试前刷新核对。

离线浏览器回归在无凭据 PWA 生产构建、本地 4100 服务上执行，CI 使用相同入口：

```bash
pnpm --filter @bloctop/pwa exec node scripts/offline-hydration-smoke.mjs
pnpm --filter @bloctop/pwa exec node scripts/offline-sw-smoke.mjs
pnpm --filter @bloctop/pwa exec node scripts/offline-download-basic-smoke.mjs
```

脚本仅接受没有凭据的 localhost/127.0.0.1 HTTP 服务，并拒绝非本地请求。第一项连续 60 次读取直接 Next HTML；第二项用原生 IndexedDB/Cache fixture 和真实 SW/页面，默认每种语言重复 3 次冷启动，检查刷新及旧图/单图/多图阅读。第三项在额外的 4101/4102 本地 HTTP fixture 上执行真实源码的下载按钮/provider，检查 HTTP、CORS、损坏图片失败、重试、同线路数更新及三语断网阅读；代理仅为本地媒体替换 SW 域名与 CSP。所有页面错误均失败。该流程不调用生产 Mongo/R2，不代替真实快照 API、跨标签页、Safari 或存储回收验收。
完整离线协作检查 `scripts/offline-download-smoke.mjs` 还验证取消、迟到响应、Web Locks/BroadcastChannel 的双标签页删除/更新及清理锁，CI 使用此完整版本。`scripts/online-media-smoke.mjs` 用真实源码组件/完整源码 SW、原生 IDB/Cache 和本地 HTTP 图片验证版本更新与 Topo 配套更新；本地 sticky optimizer 适配器不能代表实际 Next SSR/图片优化服务。脚本不调用生产服务，全部页面错误均失败。

真实数据库验收需显式设置 `BLOCTOP_TEST_MONGODB_URI=mongodb://127.0.0.1:37117/?replicaSet=bloctop-test`，再运行 `pnpm --filter @bloctop/shared test:integration:mongo`。只接受 loopback 和指定 replica set；每个用例创建随机 `bloctop_test_*` 库，仅清理自身创建的库。CI 使用固定 digest 的 Docker Official Image Mongo 8.0.32，退出时删除该次容器。普通 `test:run` 不运行这组真实数据库测试，不要传入应用或生产 URI。

## 6. 数据维护脚本不是初始化捷径

大部分维护脚本在 `apps/pwa/scripts/`，不是根 `scripts/`；根目录还保留 `import-routes.ts`。

- `db:seed` / `db:seed:prod`：旧静态数据导入，**包含 `crags`、`routes` 的 `deleteMany({})`**。不属于普通启动步骤。
- `db:migrate`：旧 cityId 迁移；只按具体数据状态评估后执行。
- `db:backup`：运行 `backup-to-db.ts`；先检查脚本中的源/目标数据库配置，不等同于下载只读备份。
- `migrate-crag-ownership.ts`：仍写 creator，与当前 manager 类型不一致，不能直接当作首位管理员初始化脚本。
- 其他 R2 路径迁移、复制生产数据、坐标迁移脚本均为历史维护工具，不因文件存在就表示需要再次执行。

脚本使用的环境文件与数据库名并不完全统一，运行前逐个检查。涉及真实数据前，先明确目标环境和恢复方式；本次文档整理没有运行这些脚本。

## 7. 常见定位入口

| 现象 | 先检查 |
| --- | --- |
| 页面报缺少 MongoDB 配置 | 两个应用目录内的 env 文件，URI 与 DB_NAME 是否同时存在 |
| localhost 登录后仍跳回登录 | 两端 hostname、secret/数据库、应用 URL、Cookie 与权限；见上方认证环境 |
| 登录成功但看不到岩场 | admin/user 角色、crag_permissions、Editor 列表过滤；不要只看 createdBy |
| 后台保存后 PWA 数据没变 | DB 是否写入、webhook env/日志、具体失效路径、浏览器和 SW 缓存 |
| 大图上传或干净安装失败 | browser-image-compression 安装情况、R2 权限、图片域名配置 |
| 删除页面后 tsc 引用旧页面 | 应用 `.next/types` 的生成缓存；确认不再运行开发服务后按需清理对应缓存 |


## 本地生产构建的认证与 Beta 验收

[admin-session-smoke.mjs](../apps/pwa/scripts/admin-session-smoke.mjs) 默认完整模式使用真实密码登录、跨端 session、权限隔离、降权与退出、Beta 提交即时可见/重复/刷新，并验证首次访问的语言回跳上下文、新建岩场与创建者授权、后台内容保存到 PWA 可见。`--auth-only` 只运行认证/权限/Beta 子集。需要两端已构建；仅传以下公开的本地地址，AMap 留空：

```bash
NEXT_PUBLIC_PWA_URL=http://localhost:4200 \
NEXT_PUBLIC_EDITOR_URL=http://localhost:4201 \
NEXT_PUBLIC_APP_URL=http://localhost:4201 \
NEXT_PUBLIC_AMAP_KEY='' pnpm build

# 从仓库根目录执行；仅允许明示的本地 bloctop-test replica set。
BLOCTOP_TEST_MONGODB_URI='mongodb://127.0.0.1:37117/?replicaSet=bloctop-test' \
  node apps/pwa/scripts/admin-session-smoke.mjs --preflight
BLOCTOP_TEST_MONGODB_URI='mongodb://127.0.0.1:37117/?replicaSet=bloctop-test' \
  node apps/pwa/scripts/admin-session-smoke.mjs
```

脚本复制构建到不含 env 的自有临时目录，使用正常 Next CLI 启动并清理自身服务；创建带所有权标记的随机测试库，结束时核对标记再清理。两端真实业务/认证 API 不 mock；只有明确测试图片使用本地 PNG，天气被中止，浏览器显式没有 Service Worker 功能。这不验证 R2、邮件、Passkey、地图或 SW。

CI 的 Node 22/24 矩阵运行上述完整模式，并用固定镜像自建本地 Mongo replica set。独立的[水合回归](../apps/pwa/scripts/offline-hydration-smoke.mjs)默认连续导航 60 次，要求直接 Next HTML，全部页面错误与非本地请求均失败；隔离空存储和城市/定位读取夹具不代表完整离线业务验收。
