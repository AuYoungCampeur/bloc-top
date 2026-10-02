# 安全依赖与认证升级

> 2026-10-02 源码检查记录。此文记录源码升级、兼容性与验收边界，不能据此推断当前生产版本。实际命令与发布状态见[产品记录](PRODUCT.md)。

## 此次更新

两端统一固定 Next.js / eslint-config-next 16.3.8、Better Auth / Passkey 1.7.7、插件要求的 @better-auth/utils 0.4.2、AWS S3 SDK 3.1145.0。PWA 固定 next-intl 4.9.2；根 override 将 defu 固定为 6.1.7、Sharp 固定为 0.35.5，锁定包含已修复 libheif 的图像处理依赖。React 保持 19.2.3。shared/ui 的 Next peer 最低版本和 UI 的 next-intl peer 同步，防止 pnpm 又安装旧 Next 并产生重复路由上下文。

Next 16.3.8 是[官方安全修复版本](https://github.com/vercel/next.js/releases/tag/v16.3.8)。项目启用远程图片与 AVIF，需纳入[图片处理安全公告](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4)的检查。其他公告中仅影响 Windows 的条件不能当作 Vercel Linux 部署已被证实可利用的证据。

PWA 同时启用 Magic Link 和邮箱密码注册，符合[未验证邮箱预注册账号接管公告](https://github.com/better-auth/better-auth/security/advisories/GHSA-qq9h-g4jm-xgf3)的功能组合。升级后的真实认证库测试检查：邮箱所有者通过 Magic Link 后，删除该未验证账号原先的密码凭据并撤销此前全部会话；已验证账号的密码和会话保留。用户通过验证后可以主动设置新密码。

[另一项验证记录目的混用公告](https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm)还需要 OAuth 功能；当前项目没有启用 OAuth，不能将该完整利用条件说成已经成立。测试仍覆盖验证记录的目的隔离和旧链接拒绝，防止后续增加 OAuth 时沿用旧存储假设。

next-intl 的[重定向公告](https://github.com/amannn/next-intl/security/advisories/GHSA-8f24-v5vv-gm5j)针对 `localePrefix: as-needed`，本项目当前为 `always`；[预编译原型污染公告](https://github.com/amannn/next-intl/security/advisories/GHSA-4c35-wcg5-mm9h)需要实验消息预编译，本项目也未启用。仍更新至同时包含两项修复的 4.9.2，避免配置变更重新引入已知问题。

## 页面水合回归

旧 Next 16.1.2 内置的 React DOM `19.3.0-canary-f93b9fd4-20251217` 曾在实际浏览器中出现 HostComponent 重放时 DOM 光标错位的 React #418。Next 16.3.8 内置 `19.3.0-canary-cbb046ab-20260731`，已包含 [React 官方重放修复](https://github.com/react/react/pull/35494)：在重置组件之前恢复水合光标。安装包的开发和生产代码均确认包含该步骤，和此前捕获的错误位置一致。

新版 main 基线在直接 Next HTML、无代理/Service Worker、隔离空存储下连续 60 次通过，页面错误为零。此结果只证明该基线；待发布的新离线阅读器仍须用新版框架执行相同回归和下载/冷启动验收，不能从基线通过推断新功能已验收。

## 兼容性与发布

- 旧密码和生产 Secure 签名 Cookie 使用由实际 Better Auth 1.4.18 生成的固定测试向量验证；认证用户、密码和会话集合无需因此执行迁移。固定向量仅用于隔离内存 adapter，包含公开测试身份和测试密钥，不是生产凭据。
- 升级改变 Magic Link 验证记录的目的标识。旧版已发送但尚未使用的链接会被拒绝，用户需要重新申请邮件。发布时应协调 PWA/Editor 同一版本，避免长时间运行不同认证版本。
- 两端禁用会话 Cookie 资料缓存，服务端鉴权强制读取最新用户和会话；认证 HTTP 响应统一 `private, no-store`。真实浏览器与本地 Mongo 的跨应用登录、旧 Cookie 降权和退出撤销已通过，生产域名与真实用户仍需独立核查。
- 新版创建的待使用链接与旧版不兼容；不要把回滚理解为恢复所有待使用链接。应用回滚后仍需重新申请链接。回滚不得恢复已知存在安全问题的认证版本作为长期方案。

## 验证边界

依赖审计、类型、单元测试和构建检查各自独立记录。`pnpm audit --prod` 仍可能包含可选 peer 带入的 Vitest/Vite 和构建工具；数量不能直接解释为线上可利用漏洞数量。需要按导入路径、实际启用功能与部署平台分类，不能仅根据总数宣称已清零。

隔离认证库测试不覆盖 Resend 投递、真实 Passkey 设备、生产登录或 R2 读写。不得为依赖验收往生产库创建账号、Beta 或测试图片；先使用自有临时数据库和本地浏览器，再对生产部署做只读核查。
