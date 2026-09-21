# 开发、验证与部署

> 核对日期：2026-09-20。命令依据仓库 scripts；线上环境未核实。

## 1. 环境准备

仓库 `.nvmrc` 为 Node 20，packageManager 固定为 pnpm 10.29.3。首次安装：

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
| `NEXT_PUBLIC_PWA_URL` | 不需要 | 必需 | 登录跳转和缓存 webhook；本地填 `http://localhost:3000` |
| `NEXT_PUBLIC_APP_URL` | 当前源码未直接使用 | 回跳到后台 | Editor 本地填 `http://localhost:3001`；不是 better-auth baseURL 的自动配置 |
| `REVALIDATE_SECRET` | webhook 接收 | webhook 发送 | 两端一致；不带 NEXT_PUBLIC 前缀 |
| `NEXT_PUBLIC_AMAP_KEY` | 地图、定位、天气 | 不使用 | 地图 JS 与服务端高德请求共用当前配置 |
| `CLOUDFLARE_ACCOUNT_ID` | 保留的图片管理 API | 图片管理必需 | R2 S3 endpoint |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | 同上 | 图片管理必需 | 服务端凭据 |
| `R2_BUCKET_NAME` | 同上 | 图片管理必需 | 无代码默认值；隔离开发 bucket 的图片域名也需配套检查 |

`NEXT_PUBLIC_*` 会进入客户端构建，不能用于数据库、R2 或签名密钥。新增变量还要检查根目录 `turbo.json` 的 `globalEnv`；目前维护横幅另读取 `NEXT_PUBLIC_MAINTENANCE_MODE`，但该变量未列入 Turbo 的 globalEnv，不应假定通过根命令已透传。

图片公开域名目前在共享 constants、Next images 配置和 PWA SW/CSP 中写为 `img.bouldering.top`，不是一个可直接通过 `.env` 切换的配置项。

## 3. 启动与当前阻碍

```bash
pnpm dev
# 或分别启动
pnpm --filter @bloctop/pwa dev
pnpm --filter @bloctop/editor dev
```

PWA 默认 3000，Editor 开发脚本固定 3001。后台首次访问会重定向到 PWA 登录；只有 admin 或有岩场授权的用户能进入。只启动后台不能完成首次登录。

当前两端 `src/lib/auth.ts`：

- `crossSubDomainCookies` 无条件启用，domain 固定为 `.bouldering.top`。
- `trustedOrigins` 只有生产域名。
- 仅 Passkey RP ID/origin 做了开发环境分支。

因此 localhost 登录是优先恢复项。本轮仅补齐环境说明，不绕过鉴权、不改 auth 源码。后续需要让开发环境使用合适的 Cookie 域/host-only Cookie 和 localhost origins，再验证双端登录。修改前不要将服务启动成功等同于后台可使用。

## 4. 检查命令与实际覆盖

| 命令 | 范围 |
| --- | --- |
| `pnpm typecheck` | 四个包的 `tsc --noEmit`，由 Turbo 调度，可能命中缓存 |
| `pnpm lint` | 定义了 lint 的 PWA 与 Editor；共享包没有独立 lint script |
| `pnpm test` / `pnpm test:run` | PWA、Editor、shared 的 Vitest；ui 没有独立 test script |
| `pnpm --filter @bloctop/editor test:run` | 后台组件、hook、逻辑测试 |
| `pnpm --filter @bloctop/shared test:run` | 权限、数据层及工具函数 |
| `pnpm test:ct` | PWA 的 Playwright 组件测试，非完整双端 E2E |
| `pnpm build` | 两个应用的生产构建；PWA 使用 `next build --webpack` |

Vitest 单元/组件测试使用 `*.test.ts(x)`，Playwright 组件测试使用 `*.ct.tsx`。Editor/PWA 声明 Vitest 4，shared 声明 Vitest 3，修改配置时注意包间差异。

本轮验证结果见[后台接手指南](ADMIN.md)：后台 139 项测试通过，全仓类型检查通过（3 个任务使用缓存）。本次未执行全量 lint、全量测试、Playwright、生产构建或真实服务验收。

Git hooks 实际行为：

- `.husky/pre-commit` 执行 `lint-staged`；根配置目前只匹配 **PWA** 文件，不覆盖 Editor。
- `.husky/pre-push` 执行类型检查、Vitest、Playwright，没有单独执行 ESLint。
- 不要用「push 成功」替代后台 lint。也不要直接运行 pre-push 来做普通检查，它会暂存工作区改动。

## 5. 生产构建与部署配置

代码按两个独立 Vercel 应用设计。恢复部署时应核实各项目 Root Directory 分别指向 `apps/pwa` / `apps/editor`，能解析根 workspace 与锁文件，并分别配置环境变量。此处是部署检查清单，不代表远端已如此设置。

```bash
pnpm build
# 本地预览生产构建时显式指定两个端口
pnpm --filter @bloctop/pwa exec next start -p 3000
pnpm --filter @bloctop/editor exec next start -p 3001
```

两个应用的 `start` 都只是 `next start`，并不会自动沿用 Editor dev 的 3001。PWA 开发模式禁用 SW，离线验收需生产构建预览。构建可能因页面预渲染访问数据库，或字体/外部资源需求而依赖可用环境；本轮没有验证干净安装后的生产构建。

部署相关联动：域名与 HTTPS、Cookie 共享、可信 origins、Passkey RP ID、R2 图片域名与 CORS、两端一致的重验证密钥、Editor 到 PWA webhook 的可达性。

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
| localhost 登录后仍跳回登录 | Cookie 域、trustedOrigins、两端 secret/数据库；见上方当前阻碍 |
| 登录成功但看不到岩场 | admin/user 角色、crag_permissions、Editor 列表过滤；不要只看 createdBy |
| 后台保存后 PWA 数据没变 | DB 是否写入、webhook env/日志、具体失效路径、浏览器和 SW 缓存 |
| 大图上传或干净安装失败 | Editor 未声明 browser-image-compression、R2 权限、图片域名配置 |
| 删除页面后 tsc 引用旧页面 | 应用 `.next/types` 的生成缓存；确认不再运行开发服务后按需清理对应缓存 |
