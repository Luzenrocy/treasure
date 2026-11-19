# Treasure 宿主架构

> 面向宿主维护者和需要扩展平台能力的高级工程师。业务插件作者应优先阅读 `treasure-plugins/docs/PLUGIN-DEVELOPMENT-GUIDE.md`；SDK 公开接口以 `treasure-sdk/docs/API-REFERENCE.md` 为准。

## 1. 系统边界

Treasure 是三个项目中的**桌面宿主和最终安全裁决点**。它负责插件安装、iframe 生命周期、能力授权、平台 SQLite、插件 SQL 命名空间、原生文件/菜单/通知以及平台 UI；不承载具体插件业务，也不向插件暴露 Tauri 或绝对路径。

```mermaid
flowchart LR
  Plugin["业务插件 iframe"] -->|"SDK operation"| Bridge["pluginBridge 能力网关"]
  Bridge --> Identity["来源与插件身份"]
  Identity --> Limits["参数与资源上限"]
  Limits --> Native["Tauri 文件/菜单/通知"]
  Limits --> SQL["Rust SQL AST 校验与重写"]
  SQL --> DB["SQLite：平台表 + 插件表"]
  Manager["插件中心"] --> Install["导入/校验/迁移"] --> DB
  Shell["导航、标签、iframe"] --> Plugin
```

三个仓库的契约关系：

| 仓库 | 权威内容 | 变更时必须联动 |
| --- | --- | --- |
| `treasure` | 宿主行为、安全策略、持久化与安装流程 | SDK operation、返回结构、插件模板和协议文档。 |
| `treasure-sdk` | 插件可使用的公开 TypeScript API 与桥接消息信封契约 | 宿主能力注册表、内置插件、迁移文档。 |
| `treasure-plugins` | manifest、迁移脚本和业务实现示例 | SDK 最低版本、宿主联调与发布检查。 |

## 2. 启动与运行时链路

1. `src/main.ts` 挂载 Vue、Element Plus、Pinia 和 Router。
2. `initPluginBridge()` 注册全局 `message` 监听，使已加载 iframe 可以请求能力。
3. `initDatabase()` 调用 Rust `db_run_migrations`；平台数据服务通过就绪门禁访问 SQLite。
4. Frame 从平台表加载菜单和标签。安装插件使用 `plugin://localhost/plugin/<pluginCode>/index.html`；调试插件使用登记的精确 HTTP origin。
5. iframe 上的 `data-treasure-plugin` 关联插件身份。桥接从 `MessageEvent.source` 查找 iframe，并校验调试 origin；不接受请求载荷自报身份。
6. 标签关闭时移除 iframe 并注销该插件的菜单注册。

`npm run dev` 只启动宿主前端，无法替代 Tauri 运行时。需要完整宿主能力时使用 `npm run tauri -- dev`。

## 3. 插件能力网关

`src/bridge/pluginBridge.ts` 的 `capabilityRegistry` 是宿主支持 operation 的单一清单。当前能力域包括 `files`、`directories`、`storage`、`database`、`settings`、`permissions`、`menus`、`notifications` 和 `logs`。`1.0.0` 基线的桥接消息信封按能力域拆分：插件请求按能力域使用 `treasure-{domain}-request`（如 `treasure-menu-request`、`treasure-file-request`），宿主按请求 type 分发到对应能力域，再按 operation 分发到具体 action，并以 `treasure-{domain}-response` 回传。已停用 SDK 的 `treasure-db-request` 统一信封仅保留为迁移兼容路径。

一条请求的裁决顺序：

```text
按能力域区分的消息信封与 requestId
  → MessageEvent.source 对应已注册 iframe
  → 调试 origin / 安装协议来源校验
  → 请求 type 与 operation 能力域一致性校验
  → operation 存在且 payload 通过结构校验
  → 文件引用、目录引用、permissionKey 或 SQL 表声明校验
  → 资源上限校验
  → 原生能力或 Rust SQL 执行
  → 按请求类型对应的 Result<T> 回传到请求 origin
```

重要上限来自当前宿主源码：数据库请求载荷 256 KiB、事务最多 50 条、查询结果最多 1,000 行、单次文件或私有存储读写最多 32 MiB。修改这些值属于协议行为变更，必须同步 SDK API 参考和插件测试。

菜单能力已通过 SDK 类型化接口提供：`menus.register/updateChecked/subscribe/unsubscribe/unregister`。相同 `menuId` 的 `register` 会覆盖更新并重建窗口菜单；动态勾选同步优先走 `menus.updateChecked` 轻量路径——宿主通过缓存句柄直接 `setChecked`，不触发整窗菜单重建。注册请求会校验 `rootLabel` 为宿主已知系统菜单名（View/File/Edit/Window/Help 及本地化别名）且 items 条目结构合法。宿主以 `treasure-menu-event` 反向消息通知活动 iframe，SDK 在本地维护 listener registry 并按订阅分发；插件必须经由 `menus.subscribe` 接收点击，不得自行监听 `window` 消息。订阅按插件身份隔离，即使不同插件生成相同 token，注销也不会相互影响。切换标签页时宿主仅向活动插件投递菜单事件，插件卸载、标签关闭或重载时清理注册与订阅。

窗口菜单的构建逻辑已从 `frame/index.vue` 解耦到 `pluginBridge` 的菜单构建服务（`mountPluginMenus` 与 `findSubmenuRecursive`/`moveItemToEnd`/`removeMenuItem`）：插件菜单按 `rootLabel` 与本地化别名定位系统菜单父级、处理 `submenuLabel`、生成 Tauri 菜单项并写入句柄缓存。`frame/index.vue` 仅负责调用该服务与 `Menu.setAsAppMenu/setAsWindowMenu`，其余为宿主默认菜单（关闭标签、关闭窗口替换、全屏移位）。这样便于单元测试（见 `pluginBridge.test.ts`）与后续多平台（非 Tauri）适配。

## 4. 数据与权限模型

### 4.1 平台数据与插件数据

- 平台迁移由 Rust 数据库层执行；Vue 侧不维护另一套平台 schema。
- 插件运行时 SQL 使用业务短表名，并为每条语句完整声明 `tables`。
- Rust 解析 SQL AST、核对表声明，并将短表名重写为 `plugin_<pluginCode>_<table>`；平台表不可访问。
- `query` 只用于查询，`execute` 只用于受控写入，`transaction` 对每条语句分别校验后原子提交。DDL 只允许出现在安装/升级迁移脚本。

### 4.2 文件与目录

- 用户通过系统对话框选择资源后，宿主签发不含路径的 `FileReference` 或 `DirectoryReference`。
- 引用只属于签发它的插件；会话引用不可伪造，也不应被插件持久化。
- 需要跨重启恢复根目录时，插件用稳定 `permissionKey` 调用 `permissions.grantDirectory/getDirectory`。子引用应从恢复后的根目录重新列举。
- `storage` 是插件私有数据区，只接受经过校验的相对键。它不同于用户选择的工作目录。
- 删除目录或目录内项目会移入系统回收站；卸载插件不得删除用户选择的外部目录。

## 5. 安装、升级与卸载

插件中心接受目录包、ZIP 包以及登记的调试地址。manifest 的 `name`、入口页 `treasure-plugin-code` 与安装身份必须一致；`minPlatformVersion` 阻止不兼容宿主加载。

插件 schema 通过 `scripts/init/<semver>.sql` 版本化演进。已发布迁移不可修改；升级只能新增更高版本脚本，并必须可重复检测和安全失败。`scripts/destroy.sql` 只处理插件自身数据库资源，私有存储由宿主清理，用户目录保持不变。

## 6. 可观测性与失败策略

- 宿主日志入口在 `src/utils/logger.ts`，Rust 侧日志配置和平台日志表由数据库服务管理。
- 桥接的业务失败转换为结构化 `Result`，插件不应依赖异常处理普通取消或权限失败。
- 数据库迁移失败是启动级故障；不得继续假定平台表可用。
- 文件引用过期、授权不存在和用户取消是可恢复分支；UI 应引导重新选择或安静结束。

## 7. 架构变更检查

新增或调整一项宿主能力时，至少完成：

1. 在宿主能力注册表定义 operation、结构校验、身份/授权规则与上限。
2. 在 Rust 或前端执行层实现最小原子能力，不暴露路径、物理表名或通用执行入口。
3. 在 `treasure-sdk/src/client.ts` 和公共导出中增加类型化 API，并补契约测试。
4. 更新桥接协议、API 参考、插件模板和至少一个真实使用场景。
5. 验证伪造身份、错误 origin、越权引用、超限输入、取消、超时与资源清理。
6. 执行宿主 `npm run typecheck && npm test && npm run build`，再在 Tauri 中完成真实联调。
