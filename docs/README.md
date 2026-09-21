# 项目文档目录

> 2026-09-20 重新核对当前代码。开发方向：优先管理后台。

## 当前维护的文档

| 文档 | 回答的问题 |
| --- | --- |
| [项目 README](../README.md) | 项目是什么，两个部分各做什么，从哪里开始 |
| [技术架构](ARCHITECTURE.md) | 应用/共享包如何连接，数据库与图片怎样组织 |
| [后台接手指南](ADMIN.md) | 页面与 API 在哪里，主要操作怎么工作，先处理什么 |
| [开发、验证与部署](DEVELOPMENT.md) | 如何配置/启动/检查，当前有哪些环境限制 |
| [认证与权限](AUTH.md) | 两端如何登录共享会话，admin 与 manager 如何区分 |
| [用户端与缓存数据流](PWA.md) | 后台内容如何到达用户，Topo/城市/图片/离线如何协作 |
| [代码协作约定](../CLAUDE.md) | 后续修改应遵守的代码和文档约定 |

## 保留的历史方案

[iOS App PRD](PRD_iOS_Migration.md) 保留原始需求内容并标注历史状态。它描述原生迁移设想，不能替代现行技术架构，也不是本轮开发范围。仓库已有 mobile sync API，但没有原生 iOS 客户端。

## 本次清理记录

旧文档的有效现状、设计约束及未解决问题已合并到上述文档；删除旧的 29 份架构/计划/研究 Markdown 和过时的 `PROJECT_INDEX.json`，不保留两套互相矛盾的文档。历史全文可通过 Git 查询。

| 删除范围 | 原因与新位置 |
| --- | --- |
| `doc/PROJECT_OVERVIEW.md` | 单应用目录与旧技术说明过时；替换为 README、ARCHITECTURE、DEVELOPMENT |
| `doc/AUTH_SYSTEM.md`、`doc/RBAC_DESIGN.md` | 整合为 AUTH，核实角色、路由保护与接口例外；未实现事项转入 ADMIN |
| `doc/FACE_IMAGE_CACHE_ARCHITECTURE.md` | 更新共享包位置及跨端失效限制，合并至 ARCHITECTURE/PWA |
| `doc/data-flow/` 的三份文档 | 城市、线路、天气数据流合并至 PWA，修正当前路由和缓存说明 |
| `doc/design/ROUTE_LEGEND_PANEL.md` | 设计阶段的组件步骤不再作为现状文档；展示与数据关系并入 PWA |
| `docs/plans/` 的 18 份计划 | 2026-02 的滚动布局、筛选、RBAC、后台拆分、Beta 合并、多图与选图修复计划；以当前代码说明及 ADMIN/PWA 待办替代，不沿用旧“已完成”结论 |
| `docs/research/` 的三份研究 | 旧 Topo 移植/曲线选型及认证选型；当前算法与认证决策并入 ARCHITECTURE/AUTH |
| `PROJECT_INDEX.json` | 2026-01 的单应用路径、文件统计和测试数量失效；改为维护文档中的模块入口 |

查询删除前的版本，例如：

```bash
git show 788c6f5:doc/PROJECT_OVERVIEW.md
git show 788c6f5:docs/plans/2026-02-20-multi-topo-annotations-design.md
```

本轮另补充两个应用的 `.env.example`，修复旧 README 引用不存在模板的问题；未修改真实 env、业务源代码、数据库或原有未提交开发内容。

## 后续如何保持有效

架构变更更新 ARCHITECTURE；后台功能与已确认问题更新 ADMIN；配置/命令变更更新 DEVELOPMENT 和模板；认证更新 AUTH；缓存/离线与用户数据范围更新 PWA。每次标明检查依据和验证边界，不把历史计划、类型声明或权限函数当成已交付功能。
