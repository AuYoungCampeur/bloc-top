# BlocTop · 寻岩记

面向户外抱石的岩场与线路信息平台：查岩场、看 Topo 线路图、分享小红书 Beta，并支持按岩场下载离线资料。

项目分为两个独立 Web 应用，**接下来以管理后台 `apps/editor` 为主要开发方向**。

| 部分 | 面向谁 | 当前职责 | 本地入口 |
| --- | --- | --- | --- |
| 用户端 PWA · `apps/pwa` | 攀岩者 | 城市/岩场浏览、线路筛选与搜索、Topo/Beta、天气地图、账号、离线下载；中/英/法三语 | `http://localhost:3000/zh` |
| 管理后台 · `apps/editor` | 系统管理员、岩场管理员 | 岩场信息、岩面照片、线路与多图标注、Beta、城市/地级市、用户与岩场授权 | `http://localhost:3001` |

后台界面仍使用「Topo 编辑器」这个名称，但职责已覆盖内容管理。它没有自己的登录页，登录入口在 PWA。两个应用各自提供 Next.js API，共享 MongoDB 数据和 R2 图片；没有单独的后端服务项目。

> 文档更新于 2026-10-02，描述当前源码。基础改进已通过 PR #292 发布，内容一致性及可靠发布仍在验收；部署、实际验证与未通过项目见 [产品迭代记录](docs/PRODUCT.md)。

## 先读什么

1. [技术架构](docs/ARCHITECTURE.md)：两个应用如何协作，数据存在哪里。
2. [后台接手指南](docs/ADMIN.md)：页面、核心代码、保存流程、已发现的问题与后续顺序。
3. [开发与验证](docs/DEVELOPMENT.md)：环境变量、启动命令、测试、部署配置及当前限制。
4. [认证与权限](docs/AUTH.md) / [用户端与缓存数据流](docs/PWA.md)：需要深入具体模块时阅读。

[文档目录与清理记录](docs/README.md)说明旧文档的去向；[CLAUDE.md](CLAUDE.md)仅保留代码协作约定。

## 仓库结构

```text
apps/
  pwa/                 用户端 + 用户端 API + 数据维护脚本
  editor/              管理后台 + 后台 API
packages/
  shared/              类型、MongoDB 数据访问、权限、Topo/城市等工具
  ui/                  共用 UI、图片缓存服务、主题与样式
scripts/               额外的数据导入工具
docs/                  当前项目文档与保留的 iOS 历史 PRD
```

主要依赖声明：Next.js **16.1.2**、React **19.2.3**、TypeScript 5、Tailwind CSS 4、MongoDB 原生驱动 7、better-auth 1.4、Serwist 9、next-intl 4、pnpm **10.29.3**、Turborepo 2。MongoDB 驱动版本不代表数据库服务端版本；精确安装版本见 `pnpm-lock.yaml`。

## 本地准备

```bash
nvm use                         # .nvmrc 为 Node 22
corepack enable
pnpm install --frozen-lockfile

# 仅在目标文件不存在时复制，避免覆盖已有配置
cp -n apps/pwa/.env.example apps/pwa/.env.local
cp -n apps/editor/.env.example apps/editor/.env.local
# 按 docs/DEVELOPMENT.md 填入开发数据库及相关服务配置

pnpm dev                        # 同时启动 PWA:3000 与 Editor:3001
```

两端通过共享认证配置区分 localhost、生产与 Vercel Preview。localhost 使用 host-only Cookie，两端需连接同一隔离开发库并使用相同签名密钥；生产维持 `.bouldering.top` 共享 Cookie。配置与验证边界详见[开发文档](docs/DEVELOPMENT.md)。

不要为重新熟悉项目直接执行 `db:seed`：该脚本会清空目标数据库的岩场和线路集合。

## 常用命令

```bash
pnpm --filter @bloctop/editor dev        # 只启动后台；登录仍依赖 PWA
pnpm --filter @bloctop/pwa dev           # 只启动用户端
pnpm --filter @bloctop/editor test:run   # 后台测试
pnpm --filter @bloctop/shared test:run   # 共享逻辑测试
pnpm typecheck                         # 四个 workspace 的类型检查
pnpm lint                              # 两个应用的 ESLint
pnpm test                              # 所有定义了 test:run 的包
pnpm test:ct                           # PWA Playwright 组件测试
pnpm build                             # 两个应用的生产构建
```

## 当前接手重点

- 先恢复稳定的后台登录、开发环境和授权测试路径。
- 核实多图标注与岩面重命名、删除、覆盖上传的数据一致性。
- 统一两端重复 API 的认证与缓存刷新行为。
- 基于岩场 → 岩面 → 线路/Topo → Beta 的实际管理流程，再安排后台体验改进。

后台已按岩场上下文串联新建、详情、岩面和线路管理。共享服务统一 Beta、认证及岩面操作，保护多图引用并显式报告部分失败；离线下载按完整图片 manifest 验证后保存快照。

具体代码证据、并发/外部服务限制和验收清单见[后台接手指南](docs/ADMIN.md)。源码更新不等同于已经部署；逐批发布证据见下方记录。

2026-10-02 起按[产品迭代与验收](docs/PRODUCT.md)持续推进 UI、后端与工程基础。该文档记录成熟度要求和当前优先级；项目尚未完成完整成熟度验收。
