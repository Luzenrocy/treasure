# Treasure 宿主研发指南

> 目标是让没有 Treasure 经验的工程师能在不猜测运行边界的前提下启动、定位、修改并验证宿主。本文中的“宿主”指负责加载插件页面并提供数据库、文件、设置和原生能力的 Treasure 桌面应用。

## 1. 开发环境与仓库范围

只开发 Treasure 宿主时，仅需本仓库，以及 Node.js 18+、npm、Rust stable 和当前平台的 Tauri v2 系统依赖。只有在同一项改动同时影响 SDK 公共接口或插件实现时，才需要另外取得对应仓库；可按下面的通用工作区结构放置，目录名不代表本机实际路径：

```text
workspace/
├── treasure/
├── treasure-sdk/
└── treasure-plugins/
```

首次进入宿主：

```bash
cd treasure
npm install
npm run typecheck
npm test
npm run tauri -- dev
```

`npm run dev` 只运行 `http://localhost:1420` 的宿主 Vue 前端；涉及 SQLite、Tauri、插件协议、文件对话框或插件 iframe 时必须使用 `npm run tauri -- dev`。

## 2. 源码导航与变更定位

下表按修改场景给出源码定位路径。“首要检查文件”用于确认该场景的入口和现有行为；“相关实现”用于继续定位需要同步修改或验证的代码。它是导航索引，不表示所有文件都必须修改。

| 修改场景 | 首要检查文件 | 相关实现 |
| --- | --- | --- |
| 启动/全局初始化 | `src/main.ts` | `src/sql/initOrUpgrade.ts`、`src/bridge/pluginBridge.ts`。 |
| 导航、标签、插件 iframe | `src/components/frame/index.vue` | `src/store/tabs.ts`、`src/components/plugin/index.vue`。 |
| 插件导入和调试注册 | `src/components/pluginManager/index.vue` | `packageImport.ts`、`src/sql/platformService.ts`。 |
| SDK operation | `src/bridge/pluginBridge.ts` | `fileGrants.ts`、`pluginSqlExecutor.ts`、SDK `src/client.ts`。 |
| SQL 安全 | `src-tauri/src/lib.rs` | `src/bridge/sqlSecurity.ts`、`pluginSqlExecutor.ts`。 |
| 平台 schema/迁移 | `src-tauri/src/db.rs` | `src/sql/common.ts`、`platformService.ts`。 |
| 原生菜单 | `src/store/menuRegistry.ts` | `src/components/frame/index.vue`。 |

系统边界、关键链路和安全约束见 [ARCHITECTURE.md](ARCHITECTURE.md)。不要从旧 API 名称或构建产物反推当前行为；以工作区源码、SDK 公共导出和测试为准。

## 3. 本地插件联调

1. 在插件项目执行 `npm install && npm run dev`，记下 Vite 地址，通常为 `http://localhost:5173`。
2. 在本仓库执行 `npm run tauri -- dev`。
3. 打开插件中心，开启“插件调试入口”，选择“注册调试插件”，填写插件开发地址。
4. 确认宿主能读取 `/treasure-manifest.json` 和 `/scripts/init/`，然后打开生成的插件菜单。
5. 在 Treasure 应用中打开插件页面并验证相关能力。

若调试插件加载失败，依次检查：开发服务是否存活；登记 URL 与 iframe 实际 origin 是否一致；manifest `name`、`_frozen` 和入口 meta 是否同步；`minPlatformVersion` 是否兼容；迁移脚本文件名是否为语义化版本。

## 4. 典型变更实施流程

### 4.1 宿主界面与运行时状态

保持路由、标签和 iframe 的职责分开。宿主页面由 Router/`keep-alive` 管理；插件 iframe 由 Frame 创建并用 `v-show` 保活。关闭插件标签时必须同步清理菜单和关联运行时状态。

### 4.2 平台数据库变更

平台 schema 只在 Rust 迁移层演进。新增迁移必须能从已有数据库升级，失败时返回明确错误；前端查询必须经过数据库就绪门禁。不要在 Vue 启动代码中临时执行 DDL。

### 4.3 SDK 与桥接能力扩展

先定义插件真正需要的最小原子能力，再同时修改宿主、SDK、协议和插件用例。operation 名使用 `<capability>.<verb>`；请求身份不能来自 payload。所有外部输入都要有结构校验、授权校验和大小/数量上限。

### 4.4 插件安装与数据迁移

目录包与 ZIP 必须走相同校验。不要信任包目录名；安装身份来自经过一致性验证的 manifest 和入口 meta。解压、复制、迁移任一步失败时应避免留下半安装状态，并覆盖升级和回滚失败用例。

## 5. 验证要求与测试矩阵

每次提交至少执行与改动相关的自动验证：

```bash
npm run typecheck
npm test
npm run build
```

以下改动还需要 Tauri 人工验证：

| 改动 | 必验场景 |
| --- | --- |
| iframe/桥接 | 安装插件、调试插件、错误 origin、关闭标签后清理。 |
| 文件/权限 | 选择与取消、Unicode 名称、32 MiB 边界、授权恢复/撤销、回收站。 |
| SQL | JOIN/CTE/`EXISTS`/`RETURNING`、表清单缺失、平台表、事务回滚、1,000 行上限。 |
| 安装/升级 | 目录包、ZIP、首次安装、连续升级、损坏 manifest/迁移、卸载。 |
| 菜单 | 多插件切换、勾选状态、关闭插件、窗口菜单重建。 |

若同时修改三个仓库，先验证 SDK 类型与契约测试，再验证宿主，最后运行所有受影响插件的 typecheck/test/build/package。

## 6. 变更交付与文档要求

说明改动影响的边界：宿主 UI、平台迁移、SDK 协议、插件数据或权限。可能使已有调用、安装包或数据失效的变更，必须写明迁移策略和最低版本；已发布的插件身份及迁移脚本不得重写。文档中的命令、API 名称和限制值应在同一提交内随源码更新。
