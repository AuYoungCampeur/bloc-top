# 认证与权限

> 核对日期：2026-09-20。以两端 auth 配置、共享权限函数和 API 实现为准。

## 登录与共享会话

PWA 提供 Magic Link（Resend 邮件）、邮箱密码、Passkey 登录界面。产品界面以 Magic Link 验证邮箱后补充密码/Passkey 为主，但两端服务端都启用了 `emailAndPassword`；不能据此声称密码注册 API 已被禁止。

- PWA：[auth.ts](../apps/pwa/src/lib/auth.ts)、[auth-client.ts](../apps/pwa/src/lib/auth-client.ts)。
- Editor：[auth.ts](../apps/editor/src/lib/auth.ts)、[auth-client.ts](../apps/editor/src/lib/auth-client.ts)。
- 两端均提供 `/api/auth/[...all]`；Editor 没有 Magic Link 插件，登录界面在 PWA。
- 两端通过 MongoDB 的认证集合及 `.bouldering.top` 域 Cookie 共享会话；需要一致的数据库和 `BETTER_AUTH_SECRET`。
- `getAuth()` 与 MongoDB 连接均为懒初始化，避免模块加载立即访问数据库；这不保证页面构建阶段完全不访问数据库。

当前配置：Magic Link 10 分钟有效，session 30 天、一天更新一次，session Cookie 缓存 5 分钟，better-auth 请求限流窗口 60 秒/10 次。Passkey 的生产 RP ID 为 `bouldering.top`，开发为 `localhost`；两端开发 origin 分别是 3000/3001。

**本地限制：** Cookie 域和 trustedOrigins 尚未随环境切换。URL 环境变量主要用于应用跳转，不会自动覆盖上述认证配置。见[开发文档](DEVELOPMENT.md)。

PWA 的 `trusted-url.ts` 负责登录回跳 URL 检查，当前允许相对路径、localhost、bouldering.top 及其子域名。换部署域名时必须同时检查它、两端 auth 的可信来源、Cookie 域和 Passkey RP ID，不能只换首页 URL。

## 两层权限模型

| 身份 | 来源 | 当前能力 |
| --- | --- | --- |
| 未登录 | 无 session | 公开浏览；PWA Beta 提交要求登录，Editor 同名提交 API 仍有差异 |
| 普通 user | `user.role = 'user'` | 账号与普通用户功能，默认不能进入后台 |
| 岩场 manager | user + `crag_permissions` 记录 | 可进入后台并维护被授权岩场的信息、线路、图片和 Beta |
| 全局 admin | `user.role = 'admin'` | 全部岩场、创建岩场、管理授权、城市/地级市和用户角色 |

`manager` 不是 `user.role` 的可选值。当前 `CragPermissionRole` 只有 manager；旧文档/脚本中的 creator 不能当作现行角色。代码保留的 `canDeleteCrag()` 返回 admin 判断，但还没有对应删除岩场 API。

权限函数位于 [permissions.ts](../packages/shared/src/permissions.ts)：

- `canCreateCrag()`：仅 admin。
- `canAccessEditor()`：admin 或存在任意岩场授权。
- `getEditableCragIds()`：admin 返回 `all`，其余按授权返回岩场 ID。
- `canEditCrag()`：admin 或目标岩场授权；额外 createdBy 回退存在与 `_id` 存储不匹配的问题。
- `canManagePermissions()` / `canDeleteCrag()`：仅 admin。

共享文件也定义了 Access Control statement/roles，但当前两端 `admin()` 初始化没有传入这组自定义定义；业务岩场隔离依靠 API 显式调用上述函数，不是自动从 statement 生效。

## 三层保护

1. Editor `proxy.ts` 检查 session Cookie 是否存在，并引导去 PWA 登录；API 被 matcher 排除。
2. Editor 根 layout 使用 `force-dynamic`，服务端读取 session，再调用 `canAccessEditor()`。
3. 每个写入 API 自行校验会话和目标岩场/全局角色。共享 [createRequireAuth](../packages/shared/src/require-auth.ts) 仅验证登录并返回 `{ userId, role }`，不自动校验岩场权限。

因此，页面保护不能替代 API 权限检查；隐藏按钮也不能保护接口。公开 GET 和后台 GET 混合存在，详见[后台 API 清单](ADMIN.md)。

创建岩场当前由 admin 执行，同时写 `createdBy` 和 manager 授权记录。两次写入没有事务包裹，应考虑第二步失败后的恢复行为。授权集合有索引创建帮助函数，但未连接数据库核实索引是否已部署。

## 开发中必须保留的细节

- `user` 集合的 `_id` 应使用 `new ObjectId(userId)`；不能把业务数据使用的类型断言当作转换。
- Cookie 缓存可能让角色变化短时间内不可见。尤其绕过 better-auth 直接改库时，应刷新/重新获取会话，不把旧 UI 当作权限已更新的证据。
- `getSession()` 返回结果与 React `useSession()` 订阅状态不是同一个刷新动作；相关交互应检查 hook 的 refetch 路径。
- 首位 admin 不能依靠已有的 admin-only 页面自助产生。需针对隔离开发数据库安排一次受控初始化；本轮未提升任何账户权限，也未执行旧 ownership 迁移。
- 角色、授权或 API 改动应覆盖两端的同名实现及 admin/有权限/无权限三种身份；现有权限测试并不等于全量接口审计完成。

具体已发现的 API 差异和后续处理顺序见[后台接手指南](ADMIN.md)。
