# 认证与权限

> 认证环境、缓存、创建者授权与 Beta API 更新于 2026-10-02。描述源码合约；发布与实际验收见 [PRODUCT.md](PRODUCT.md)。

## 登录与共享会话

PWA 提供 Magic Link（Resend 邮件）、邮箱密码、Passkey 登录界面。产品界面以 Magic Link 验证邮箱后补充密码/Passkey 为主，但两端服务端都启用了 `emailAndPassword`；不能据此声称密码注册 API 已被禁止。

- PWA：[auth.ts](../apps/pwa/src/lib/auth.ts)、[auth-client.ts](../apps/pwa/src/lib/auth-client.ts)。
- Editor：[auth.ts](../apps/editor/src/lib/auth.ts)、[auth-client.ts](../apps/editor/src/lib/auth-client.ts)。
- 两端均提供 `/api/auth/[...all]`；Editor 没有 Magic Link 插件，登录界面在 PWA。
- 两端通过 MongoDB 的认证集合共享会话；生产使用 `.bouldering.top` 域 Cookie，localhost 使用相同名称的 host-only Cookie（Cookie 不按端口隔离）。需要一致的数据库和 `BETTER_AUTH_SECRET`。
- `getAuth()` 与 MongoDB 连接均为懒初始化，避免模块加载立即访问数据库；这不保证页面构建阶段完全不访问数据库。
- 两端认证 GET/POST 共用 [auth-route](../packages/shared/src/auth-route/index.ts)，保留 Cookie/重定向并为成功和错误响应设置 `private, no-store`。初始 MongoDB 连接失败会释放失败缓存，让后续请求能重试。

当前配置：Magic Link 10 分钟有效，session 30 天、一天更新一次，session Cookie 缓存 5 分钟，better-auth 请求限流窗口 60 秒/10 次。Passkey 的生产 RP ID 为 `bouldering.top`，开发为 `localhost`；两端共同信任 localhost 3000/3001 的开发 origin。

两端复用 [auth-runtime.ts](../packages/shared/src/auth-runtime.ts)：开发使用非 Secure 的 host-only Cookie；Vercel production 维持 Secure 共享 Cookie；Preview 使用 Secure host-only Cookie 和部署 hostname 作为 Passkey RP ID，仅支持 `VERCEL_URL` 指向的具体部署入口，分支 alias 的 Passkey 尚未实现。独立的 PWA/Editor Preview 域名不能通过 `.vercel.app` 共享 Cookie，跨应用 Preview 登录需要同一受控父域部署，不视为已实现能力。显式 localhost URL 的本地生产构建仍使用开发 Cookie。见[开发文档](DEVELOPMENT.md)。

PWA 登录页在服务端使用与认证实例一致的 `trustedOrigins` 检查回跳 URL，再把结果传入登录界面，Magic Link、密码、Passkey 共用同一结果。`trusted-url.ts` 只验证同站相对路径或该名单内的 origin，拒绝反斜杠外跳、控制字符、URL 凭据和未配置子域。换部署域名时必须同时检查认证环境的可信来源、Cookie 域和 Passkey RP ID，不能只换首页 URL。

## 两层权限模型

| 身份 | 来源 | 当前能力 |
| --- | --- | --- |
| 未登录 | 无 session | 公开浏览；PWA/Editor Beta 提交均要求登录 |
| 普通 user | `user.role = 'user'` | 账号与普通用户功能，默认不能进入后台 |
| 岩场 manager | user + `crag_permissions` 记录 | 可进入后台并维护被授权岩场的信息、线路、图片和 Beta |
| 全局 admin | `user.role = 'admin'` | 全部岩场、创建岩场、管理授权、城市/地级市和用户角色 |

`manager` 不是 `user.role` 的可选值。当前 `CragPermissionRole` 只有 manager；旧文档/脚本中的 creator 不能当作现行角色。代码保留的 `canDeleteCrag()` 返回 admin 判断，但还没有对应删除岩场 API。

权限函数位于 [permissions.ts](../packages/shared/src/permissions.ts)：

- `canCreateCrag()`：仅 admin。
- `canAccessEditor()`：admin，或拥有实际存在的获授权/自己创建的岩场；孤儿授权不单独授予入口。
- `getEditableCragIds()`：admin 返回 `all`，其余返回实际存在的授权/创建者岩场 ID。
- `canEditCrag()`：admin 或目标岩场授权；createdBy 回退使用 `_id`。该函数本身不保证岩场存在，写入 handler 还需核实目标。
- `canManagePermissions()` / `canDeleteCrag()`：仅 admin。

共享文件也定义了 Access Control statement/roles，但当前两端 `admin()` 初始化没有传入这组自定义定义；业务岩场隔离依靠 API 显式调用上述函数，不是自动从 statement 生效。

## 三层保护

1. Editor `proxy.ts` 检查 session Cookie 是否存在，并引导去 PWA 登录；API 被 matcher 排除。
2. Editor 根 layout 使用 `force-dynamic`，服务端读取 session，再调用 `canAccessEditor()`。
3. 每个写入 API 自行校验会话和目标岩场/全局角色。共享 [createRequireAuth](../packages/shared/src/require-auth.ts) 仅验证登录并返回 `{ userId, role }`，不自动校验岩场权限。

因此，页面保护不能替代 API 权限检查；隐藏按钮也不能保护接口。公开 GET 和后台 GET 混合存在，详见[后台 API 清单](ADMIN.md)。

Editor 创建岩场仅 admin 执行；共享服务在同一 MongoDB transaction 中写 `createdBy` 和 manager 授权记录，需要支持事务的数据库。相同创建者和初始字段重试不会替换其他已有岩场。Editor 权限名单读取/分配/移除保持 admin-only，分配前验证岩场和用户存在。PWA 保留的创建与授权 API 尚未接入全部相同验证；两端共用的授权数据服务已更新，入口政策仍须继续统一。

2026-10-02 生产只读检查未发现 userId+cragId 唯一索引。新授权与创建者授权统一采用稳定 `_id` 和原子 upsert，重复返回冲突；既有 ObjectId 主键 grant 按用户/岩场匹配。撤销删除该用户/岩场的所有匹配记录，包括历史重复和 ObjectId 字符串大小写变体。本轮不执行生产索引、历史授权清理或迁移；代码约束不能代替实际索引/数据审计。

## 开发中必须保留的细节

- `user` 集合的 `_id` 应使用 `new ObjectId(userId)`；不能把业务数据使用的类型断言当作转换。
- Cookie 缓存可能让角色变化短时间内不可见。尤其绕过 better-auth 直接改库时，应刷新/重新获取会话，不把旧 UI 当作权限已更新的证据。
- `getSession()` 返回结果与 React `useSession()` 订阅状态不是同一个刷新动作；相关交互应检查 hook 的 refetch 路径。
- 首位 admin 不能依靠已有的 admin-only 页面自助产生。需针对隔离开发数据库安排一次受控初始化；本轮未提升任何账户权限，也未执行旧 ownership 迁移。
- 角色、授权或 API 改动应覆盖两端的同名实现及 admin/有权限/无权限三种身份；现有权限测试并不等于全量接口审计完成。

具体已发现的 API 差异和后续处理顺序见[后台接手指南](ADMIN.md)。
