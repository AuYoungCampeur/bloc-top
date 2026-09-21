# 代码协作约定

本项目为 BlocTop（寻岩记），包含用户端 PWA 与独立管理后台。当前优先处理 `apps/editor`。技术现状统一在 `docs/` 维护，本文件不重复列举组件/API，也不把历史计划当作已实现功能。

## 先读

- [README](README.md)：项目定位与启动入口。
- [技术架构](docs/ARCHITECTURE.md)：应用边界、数据模型、跨端刷新。
- [后台接手指南](docs/ADMIN.md)：后台代码入口、待处理事项、当前工作区基线。
- [开发与验证](docs/DEVELOPMENT.md)：环境与命令。
- [认证与权限](docs/AUTH.md)、[用户端数据流](docs/PWA.md)。

## 开始修改前

1. 检查 `git status`，保留现有未提交/未跟踪内容，不自动清理或覆盖。
2. 检查目标包的 package.json、路由和实际调用者；两端同名 API 不一定行为一致。
3. 区分源码事实、测试结果、真实服务验证；不要依据旧文档宣布功能完成。
4. `.nvmrc` 为 Node 20，包管理器为 pnpm 10.29.3。使用包级命令，不在错误目录安装依赖。

## 代码边界与约定

- 应用内使用 `@/`；共用逻辑放 `@bloctop/shared`，共用 UI 放 `@bloctop/ui`。
- shared 含数据库与服务端权限模块，不要从客户端引入这些模块或笼统导入造成越界。
- PWA 保留的 re-export bridge 可继续使用；不要只为改导入路径做大范围重写。
- 类型、业务字段变更要核查两端 API、共享 DB、线上/离线消费路径和旧数据回退。
- 新依赖在实际使用它的 workspace 声明，不能依赖根目录或另一个应用的偶然解析。

## 输入、样式与国际化

- 文本输入使用封装的 `Input` / `Textarea`，确保中文/日文 IME composition 行为。后台使用 `@bloctop/ui/components/input` 和 `textarea`，PWA 可用现有封装入口。
- 不直接用原生文本 input/textarea；file/hidden/number/password 等无 IME 文本场景如需例外，说明理由并使用局部 lint 例外。
- 复用现有 Tailwind、主题 CSS 变量和共享组件；主题基础在 `packages/ui/src/styles/globals.css`，应用另有自己的 CSS。
- PWA 文案同步检查 zh/en/fr，导航使用 i18n 工具；Editor 当前为中文界面，不带 locale 路由。
- 坐标输入/地图当前按 GCJ-02 使用；从其他来源导入时不要假定坐标系相同。

## 认证、数据与图片

- 页面权限不能代替 API 校验。`requireAuth` 仅保证登录，写入还需对应岩场或 admin 权限。
- 用户角色为 admin/user；manager 属于 crag_permissions。不要重新引入旧 creator 全局角色。
- 直接操作 better-auth 用户时使用 ObjectId；业务 `_id` 的类型断言不能用于转换用户 ID。
- 保持 MongoDB/auth 懒初始化、Editor 根布局 `force-dynamic`。
- R2 Key 使用净化后的原始 Unicode，公共 URL 和 CopySource 按段编码。
- 岩面身份使用 cragId + area + faceId；改名/删除/覆盖需核查新旧 Topo 引用与部分失败。
- 后台写入后检查 PWA 重验证、本地图片缓存和离线数据；单次本地 invalidate 不是跨端刷新。
- 不把 seed 或历史迁移作为普通启动步骤；执行前检查目标数据库与具体副作用。

## 验证

优先运行与改动相关的包测试和类型检查。命令及 hooks 的实际覆盖见开发文档；Editor lint 不在当前 lint-staged 覆盖范围内。浏览器验收使用隔离开发数据，不为了检查界面向生产库写临时记录。

文档修改核对本地链接、目录、脚本名称及未实现功能的措辞。除非任务明确要求，不自动提交、推送或部署。

## 文档维护

- 使用 `docs/README.md` 作为唯一文档目录，不重新建立 `doc/`。
- 架构、字段、权限和缓存变更同步更新对应现状文档。
- 后台剩余工作集中在 `docs/ADMIN.md`，区分建议和已承诺需求。
- 一次性实施计划不长期充当技术文档；完成或被替代后合并有效结论，再删除过时文件。
- 不维护易失真的手写源码计数、测试覆盖率或固定行号索引。
