# Treasure SDK — 宿主开发文档

> 面向 **Treasure 宿主端开发者**。本文档描述插件 SDK 的接口定义、通信协议、安全模型，以及宿主如何正确处理插件请求。

---

## 一、概述

Treasure 插件系统基于 **iframe + postMessage** 的桥接架构。插件在 iframe 中运行，通过 `postMessage` 向宿主发送请求；宿主监听消息并调用 Tauri API / SQLite 等底层能力，将结果返回。

```
┌─────────────────────────────────────────────────────────┐
│                    Treasure 宿主                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  initPluginBridge()                               │   │
│  │  └─ window.addEventListener('message', handler)   │   │
│  │                                                    │   │
│  │  action 分发表 (pluginBridge.ts)                   │   │
│  │  ┌──────┬────────────────────┬──────────────────┐  │   │
│  │  │action │ 宿主处理函         │ 安全校验          │  │   │
│  │  ├──────┼────────────────────┼──────────────────┤  │   │
│  │  │query  │ sqlRewriter →      │ verify_sql +     │  │   │
│  │  │       │ PluginSqlExecutor  │ 表前缀 + 表权限   │  │   │
│  │  │execute│ sqlRewriter →      │ verify_sql +     │  │   │
│  │  │       │ PluginSqlExecutor  │ 表前缀 + 表权限   │  │   │
│  │  │readFile│ Tauri fs          │ 无               │  │   │
│  │  │...     │ ...               │ ...              │  │   │
│  │  └──────┴────────────────────┴──────────────────┘  │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  iframe (插件)                    iframe (插件)          │
│  ┌────────────────┐              ┌────────────────┐     │
│  │ shi-yu-lu      │              │ 其他插件        │     │
│  │ postMessage →  │              │ postMessage →  │     │
│  │ ◄— response    │              │ ◄— response    │     │
│  └────────────────┘              └────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

---

## 二、通信协议

### 2.1 请求格式（插件 → 宿主）

```typescript
interface BridgeRequest {
  type: 'treasure-db-request';       // 固定标识，宿主依此过滤消息
  requestId: string;                 // 请求唯一 ID，格式 "req_{递增数字}"
  pluginCode: string;                // 插件编码（从 meta[name="treasure-plugin-code"] 读取）
  action: string;                    // 操作名称（见分发表）
  // 以下字段随 action 变化
  sql?: string;                      // query/execute/transaction
  tables?: string[];                 // 声明的表名列表
  params?: any[];                    // SQL 参数
  path?: string;                     // 文件操作路径
  content?: string;                  // 文件内容 / base64
  settings?: any[];                  // 配置数据
  paramKey?: string;                 // 配置键
  paramValue?: string;               // 配置值
  title?: string;                    // 对话框标题
  ops?: { sql: string; tables?: string[]; params?: any[] }[];  // 事务操作
  reg?: MenuRegistration;            // 菜单注册信息
  menuId?: string;                   // 菜单 ID
  itemId?: string;                   // 菜单项 ID
  checked?: boolean;                 // 勾选状态
}
```

### 2.2 响应格式（宿主 → 插件）

```typescript
interface BridgeResponse {
  type: 'treasure-db-response';      // 固定标识
  requestId: string;                 // 对应请求 ID
  code: number;                      // 1=成功, 0=错误, -1=参数错误, -2=权限错误, -3=未找到
  msg?: string;                      // 错误消息（code !== 1 时）
  data?: any;                        // 响应数据
}
```

### 2.3 消息流

```
  iframe (插件)                    iframe (插件)     
  ┌──────────────────┐            ┌──────────────────┐
  │ shi-yu-lu        │            │ 其他插件          │
  │ 使用 @treasure/sdk │            │ 使用 @treasure/sdk │
  │ postMessage →    │            │ postMessage →    │
  │ ◄— response      │            │ ◄— response      │
  └──────────────────┘            └──────────────────┘

  SDK 源码位置: packages/treasure-sdk/src/
  │
  ├── types.ts           # TreasureBridge 接口定义
  ├── bridge.ts          # initTreasure/getTreasure 工厂
  ├── file.ts            # 文件操作包装器
  ├── setting.ts         # 配置管理包装器
  ├── bridge-impl/
  │   ├── production.ts  # ProductionBridge (postMessage → 宿主)
  │   └── dev.ts         # DevBridge (localStorage + sql.js)
  └── index.ts           # 统一导出入口
```

---

## 三、Action 分发表

### 3.1 SQL 操作

| Action | 参数 | 宿主处理链路 | 安全校验 |
|--------|------|-------------|---------|
| `query` | `{ sql, tables, params }` | `verify_sql`(Rust) → `rewriteWithDeclaredTables` → `PluginSqlExecutor.handleQuery` → `dbClient.query` | ① 表声明验证 ② 表前缀 `plugin_{pluginCode}_` ③ 禁止操作平台表 ④ 禁止 DDL |
| `execute` | `{ sql, tables, params }` | `verify_sql`(Rust) → `rewriteWithDeclaredTables` → `PluginSqlExecutor.handleInsert/Update/Delete` → `dbClient.execute` | 同上 |
| `transaction` | `{ ops: [{ sql, tables, params }] }` | 逐条 `verify_sql` → 逐条重写 → `PluginSqlExecutor.handleTransaction` → `dbClient.transaction` | 同上（逐条校验） |
| `ddl` | `{ sql }` | `rewriteWithDeclaredTables` → `PluginSqlExecutor.handleDDL` → `dbClient.execute` | 仅允许 CREATE TABLE |

### 3.2 文件操作

| Action | 参数 | 宿主处理 | 说明 |
|--------|------|---------|------|
| `readFile` | `{ path }` | `@tauri-apps/plugin-fs` `readTextFile(path)` | 返回文件文本内容 |
| `readBinaryFile` | `{ path }` | `readFile(path)` → Uint8Array → `btoa()` | 返回 base64 编码 |
| `readDir` | `{ path }` | `readDir(path)` → 映射为 `{name, path, isDirectory, isFile}[]` | 注意路径分隔符 |
| `writeFile` | `{ path, content }` | `writeTextFile(path, content)` | 覆盖写入 |
| `writeBinaryFile` | `{ path, content }` | `atob(content)` → Uint8Array → `writeFile(path, bytes)` | content 为 base64 |
| `createFile` | `{ path, content? }` | `writeTextFile(path, content ?? '')` | 同 writeFile |
| `updateFile` | `{ path, content }` | `writeTextFile(path, content)` | 同 writeFile |
| `deleteFile` | `{ path }` | `invoke('move_to_trash', { path })` | 移到回收站 |
| `createDir` | `{ path, recursive? }` | `mkdir(path, { recursive })` | 默认 recursive=true |
| `mkdir` | `{ path }` | `mkdir(path, { recursive: true })` | 同 createDir |
| `deleteDir` | `{ path, recursive? }` | `invoke('move_to_trash', { path })` | 移到回收站 |

### 3.3 系统对话框

| Action | 参数 | 宿主处理 | 说明 |
|--------|------|---------|------|
| `selectDirectory` | `{ title }` | `@tauri-apps/plugin-dialog` `open({ directory: true, title })` | 返回选中目录路径 |
| `saveDialog` | `{ defaultPath, filters }` | `@tauri-apps/plugin-dialog` `save({ defaultPath, filters })` | 返回保存文件路径 |

### 3.4 配置管理

| Action | 参数 | 宿主处理 | 安全校验 |
|--------|------|---------|---------|
| `getSettings` | 无 | `platformService.getSettingsByPluginCode(pluginCode)` | 自动按 pluginCode 过滤 |
| `getMySettings` | 无 | 同 `getSettings` | 兼容别名 |
| `saveSetting` | `{ settings }` | `platformService.saveSettingsByPluginCode(pluginCode, settings)` | 校验 setting 是否属于该插件 |
| `saveMySetting` | `{ settings }` | 同 `saveSetting` | 兼容别名 |
| `getSettingByKey` | `{ paramKey }` | `platformService.getSettingByKey(pluginCode, paramKey)` | 自动绑定 pluginCode |
| `saveSettingByKey` | `{ paramKey, paramValue }` | `platformService.upsertSettingByKey(pluginCode, paramKey, paramValue)` | 自动绑定 pluginCode |

### 3.5 菜单管理

| Action | 参数 | 宿主处理 | 说明 |
|--------|------|---------|------|
| `registerMenu` | `{ reg: MenuRegistration }` | `menuRegistry.register(pluginCode, reg)` | `menuVersion++` 触发菜单重建 |
| `unregisterMenu` | `{ menuId }` | `menuRegistry.unregister(pluginCode, menuId)` | 清理缓存句柄 |
| `updateMenuState` | `{ menuId, itemId, checked }` | `menuRegistry.updateState` + `updateRegistrationChecked` | 双向同步勾选状态 |

### 3.6 宿主→插件反向事件

| 事件类型 | 触发时机 | 数据格式 |
|---------|---------|---------|
| `treasure-menu-event` | 用户点击原生窗口菜单 | `{ type: 'treasure-menu-event', menuId, itemId }` |

```typescript
// 宿主发送菜单事件到插件 iframe
export function dispatchMenuEvent(pluginCode: string, menuId: string, itemId: string) {
  if (useTabsStore().activePluginCode !== pluginCode) return;  // 仅发送给当前活跃tab
  const iframe = document.querySelector<HTMLIFrameElement>(`iframe[data-treasure-plugin="${pluginCode}"]`);
  if (!iframe?.contentWindow) return;
  iframe.contentWindow.postMessage({ type: 'treasure-menu-event', menuId, itemId }, '*');
}
```

---

## 四、SQL 安全模型详解

### 4.1 校验流程

```
插件提交 SQL ──► verify_sql (Rust)
                     │
                     ├─ 失败 ──► 返回错误 "声明验证失败: 漏声明: notes"
                     │
                     ▼ 通过
               rewriteWithDeclaredTables()
                     │
                     ▼ 已重写
               validateSqlSecurity()
                     │
                     ├─ 禁止操作类型 ──► DROP/ALTER/RENAME TABLE 拒绝
                     ├─ 表名前缀不符 ──► 非 plugin_{code}_ 前缀拒绝
                     ├─ 操作平台表 ──► tp_setting, sys_audit_log 等拒绝
                     │
                     ▼ 通过
               PluginSqlExecutor.executeRequest()
```

### 4.2 安全规则定义

```typescript
// src/bridge/sqlSecurity.ts

/** 平台核心表（插件绝对禁止操作） */
export const PLATFORM_FORBIDDEN_TABLES = [
  'sys_migration', 'sys_audit_log',
  'tp_plugin', 'tp_menu', 'tp_setting',
  'treasure_sql', 'treasure_version',
  'treasure_menu', 'treasure_plugin', 'treasure_setting'
];

/** 获取插件安全规则 */
export function getSecurityRule(pluginCode: string): SecurityRule {
  return {
    allowedTablePrefixes: [`plugin_${pluginCode}_`],     // 只能操作自己的表
    forbiddenTables: PLATFORM_FORBIDDEN_TABLES,           // 禁止操作平台表
    allowedOperations: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE TABLE'],
    requirePluginId: false,
  };
}
```

### 4.3 表名重写规则

```typescript
// src/bridge/sqlRewriter.ts

/**
 * 将插件声明的裸表名重写为带前缀的完整表名。
 *
 * 输入：SELECT * FROM notes WHERE id = ?
 * 输出：SELECT * FROM "plugin_shi_yu_lu_notes" WHERE id = ?
 *
 * @param sql          原始 SQL
 * @param declaredTables 插件声明的表名列表（如 ['notes', 'tags']）
 * @param pluginCode    插件编码（如 'shi-yu-lu'）
 * @returns 重写后的 SQL
 */
export function rewriteWithDeclaredTables(sql: string, declaredTables: string[], pluginCode: string): string
```

---

## 五、插件生命周期

### 5.1 加载流程

```
宿主启动
  │
  ├─ main.ts: initPluginBridge()    ← 注册 postMessage 监听器
  │
  └─ 用户点击插件菜单
       │
       ├─ frame/index.vue: iframe 创建
       │   └─ PluginView: 加载 plugin://localhost/plugin/{code}/index.html
       │
       ├─ 插件 main.ts: initTreasure()  ← 内部创建 ProductionBridge
       │   └─ window.addEventListener('message', handleResponse)
       │
       └─ 插件就绪，开始通信
```

### 5.2 销毁流程

```
插件标签页关闭
  │
  ├─ tabsStore.removeTab
  │
  └─ onPluginTabRemoved
       │
       ├─ menuRegistry.unregisterAll(pluginCode)   ← 清理菜单注册
       │
       └─ iframe 被移除（DOM 自动断开通信）
```

---

## 六、扩展指南

### 6.1 新增 Action

需修改 3 个位置：

1. **`pluginBridge.ts`** — 在 switch 中添加 case
2. **`@treasure/sdk` 的 `TreasureBridge` 接口** — 添加方法签名
3. **`@treasure/sdk` 的 `ProductionBridge` 和 `DevBridge`** — 添加实现

### 6.2 修改 SQL 安全规则

修改 `sqlSecurity.ts` 中的：
- `PLATFORM_FORBIDDEN_TABLES` — 增减禁止表
- `getSecurityRule` — 修改允许的前缀/操作
- `validateSqlSecurity` — 修改校验逻辑

### 6.3 修改表名重写规则

修改 `sqlRewriter.ts` 中的 `rewriteWithDeclaredTables` 函数。

---

## 七、关键文件索引

| 文件 | 职责 |
|------|------|
| `src/bridge/pluginBridge.ts` | postMessage 监听器 + action 分发中枢 |
| `src/bridge/pluginSqlExecutor.ts` | SQL 安全执行器（校验→执行） |
| `src/bridge/sqlSecurity.ts` | SQL 安全校验规则 |
| `src/bridge/sqlRewriter.ts` | 表名重写（加 plugin_{code}_ 前缀） |
| `src/sql/common.ts` | SQL 执行门禁（awaitReady + 转发到 dbClient） |
| `src/sql/platformService.ts` | 插件元数据 CRUD、manifest 校验、审计日志 |
| `src/store/menuRegistry.ts` | 插件菜单注册中心 |
| `src/components/plugin/index.vue` | iframe 容器组件 |
| `src/components/frame/index.vue` | 应用外壳 + 原生菜单重建 |