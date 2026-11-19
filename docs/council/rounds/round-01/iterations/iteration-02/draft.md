# Treasure 三项目围绕 treasure-sdk 调整的一致性核验报告（草案）

> 核验日期：2026-11-14；范围为三个工作区的当前未提交状态。本报告只使用源码、清单、既有构件和本轮命令结果；未修改业务实现。

## 1. 执行摘要与发布判断

SDK `2.3.0` 与宿主 `2.4.0` 的九个能力域请求信封一致。八个活动插件的**源** `package.json` 均声明 `treasure-sdk ^2.3.0`，根 `manifest.json` 均要求宿主 `2.4.0`；已审阅活动源码未发现直接发送旧统一桥接信封、直接监听 `treasure-menu-event`，或调用已移除的 SDK `request(action, payload)`。

验证并非全负面：SDK 类型检查、13/13 测试及 build 均通过；宿主类型检查通过，42/43 测试通过，唯一失败为硬编码本机插件目录的测试；text-diff、excalidraw、guan-xiang-pu、json-formatter 分别 30/30、23/23、9/9、34/34 通过。八个插件类型检查均通过。

发布仍**有条件不通过**：八份锁文件仍锁定 `treasure-sdk 2.0.0`–`2.2.0`，八份既有 `build-output` manifest 仍声明宿主 `2.0.0`–`2.3.0`，不能作为本次 SDK 2.3/宿主 2.4 调整的交付证明。此外，google-authenticator、shi-yu-lu、treasure-plugin、kao-cheng-ce 没有一方测试源码，真实 Tauri iframe E2E 也尚未执行。

## 2. 范围、版本基线与方法

核验对象为 `/Volumes/MacExtend/source_code/FrontProjects/treasure-sdk`、`/Volumes/MacExtend/source_code/FrontProjects/treasure`、`/Volumes/MacExtend/source_code/FrontProjects/treasure-plugins`。活动插件为 text-diff、google-authenticator、shi-yu-lu、excalidraw、treasure-plugin、kao-cheng-ce、guan-xiang-pu、json-formatter。

SDK `package.json` 的版本基线是 2.3.0，宿主 `package.json` 是 2.4.0。方法：比对 SDK/宿主协议与菜单实现；扫描活动 `src/`；检查源清单、锁文件与既有生成 manifest；运行类型检查、测试、SDK build、依赖解析和 `git diff --check`。三仓库 `git diff --check` 均无输出。

## 3. SDK—宿主协议一致性

SDK `src/bridge-impl/production.ts:13-23` 和宿主 `src/bridge/pluginBridge.ts:54-64` 均声明 files、directories、storage、database、settings、permissions、menus、notifications、logs 的同一请求类型映射；两端都将 database 保留为 `treasure-db-request`，并由请求类型导出响应类型（SDK `:27-35`；宿主 `:69-82`）。宿主契约测试进一步断言映射（`pluginBridge.test.ts:61-82`）。

SDK 2.3.0 需要宿主 2.4.0+（`treasure-sdk/CHANGELOG.md:3-24`；`docs/BRIDGE-PROTOCOL.md:29-39`）；模板 manifest 也为 2.4.0（`template/manifest.json.tpl:4-12`）。宿主保留旧 SDK `treasure-db-request` 的统一信封兼容（`pluginBridge.ts:49-67`；`BRIDGE-PROTOCOL.md:55-59`），但这不使按能力域的新 SDK 插件兼容旧宿主。

SDK 公开菜单 `register/update/updateChecked/subscribe/unsubscribe/unregister`（`src/index.ts:36-43`）；宿主对 payload 校验并实现注册、订阅、注销和勾选同步（`pluginBridge.ts:95-126`；`menuRegistry.ts:52-153`）。`update` 是兼容别名，新增调用应优先 `register`（`BRIDGE-PROTOCOL.md:41-43`）。

## 4. 插件迁移与依赖矩阵

| 插件 | 源依赖 / 源最低宿主 | 活动源码 | lock / 既有构件 |
| --- | --- | --- | --- |
| text-diff | `^2.3.0` / `2.4.0` | `initTreasure`、SDK `files` | 2.1.1 / 2.0.0 |
| google-authenticator | `^2.3.0` / `2.4.0` | 初始化，SDK database/storage/files | 2.1.1 / 2.1.2 |
| shi-yu-lu | `^2.3.0` / `2.4.0` | SDK 菜单订阅与勾选同步 | 2.1.0 / 2.1.0 |
| excalidraw | `^2.3.0` / `2.4.0` | SDK 菜单订阅与勾选同步 | 2.1.1 / 2.3.0 |
| treasure-plugin | `^2.3.0` / `2.4.0` | `initTreasure`、SDK `files` | 2.0.0 / 2.0.0 |
| kao-cheng-ce | `^2.3.0` / `2.4.0` | SDK database/storage/logs/notifications/settings | 2.0.0 / 2.0.0 |
| guan-xiang-pu | `^2.3.0` / `2.4.0` | 初始化，SDK files/directories/permissions/settings | 2.2.0 / 2.3.0 |
| json-formatter | `^2.3.0` / `2.4.0` | `initTreasure`、SDK `files` | 2.1.1 / 2.0.0 |

前两列和 lock 的证据为 S-005，既有构件为 S-008。本轮 `npm ls treasure-sdk --depth=0` 在八个现有安装目录均解析到本地 `treasure-sdk@2.3.0` 链接；所以当前安装解析与源声明一致，但 lock 不能复现该结果。

`shi-yu-lu/src/App.vue:533-577` 以 `menus.subscribe` 接收事件、以 `updateChecked` 同步状态；`excalidraw/src/adapters/menu-actions.ts:15-28` 使用同一类型化 API 注册、订阅、更新及清理。扫描八个活动 `src/` 未命中直接 `treasure-db-request`、直接 `treasure-menu-event` 监听或 SDK `request(action, payload)` 调用；普通 HTTP 客户端 `.request()` 不计为 SDK bridge 调用。

## 5. 功能验证结果与覆盖边界

| 验证 | 结果 | 限制/解释 |
| --- | --- | --- |
| SDK `npm run typecheck` | 通过 | 无类型诊断。 |
| SDK `npm test` | 13/13 通过 | 3 个测试文件。 |
| SDK `npm run build` | 通过 | 是本轮已通过的构建验证。 |
| 宿主 `npm run typecheck` | 通过 | `vue-tsc --noEmit` 无诊断。 |
| 宿主 `npm test` | 42/43 通过 | 唯一失败为 `src/utils/pluginIconRealPath.test.ts:13` 固定 `/Users/luzenrocy/Library/Application Support/com.treasure/plugin`，并断言本机目录非空。 |
| text-diff `npm test` | 30/30 通过 | 有一方测试。 |
| excalidraw `npm test` | 23/23 通过 | 有一方测试。 |
| guan-xiang-pu `npm test` | 9/9 通过 | 有一方测试。 |
| json-formatter `npm test` | 34/34 通过 | 有一方测试。 |
| google-authenticator、shi-yu-lu、treasure-plugin、kao-cheng-ce `npm test` | 退出 1 | 没有一方测试源码，不能表述为测试用例失败。 |
| 八插件 `npm run typecheck` | 全部通过 | 每个插件退出码为 0。 |
| 三仓库 `git diff --check` | 通过 | 无空白错误。 |
| 真实 Tauri/iframe E2E | 未执行 | 未逐一真实加载插件、验证桥接/菜单回调/最低版本拒绝。 |

早期沙箱中的 `EPERM` 和 `localhost` 报错只是该沙箱的启动观察，不是本次最终测试结果。功能结论应区分：主要单元/构建验证已通过；存在一个宿主测试可移植性缺陷、四个插件缺少测试覆盖、以及未完成真实 E2E。

## 6. 结构、冗余、注释与文档评价

能力域分层、request/response 对应和来源/origin 校验在 SDK `production.ts:81-104` 与协议文档 `BRIDGE-PROTOCOL.md:21-25,45-53` 对应，边界清楚。SDK 和宿主各保留一份映射是 iframe 边界的必要副本，但存在手工双改风险；当前契约测试已降低而未消除该风险。

菜单注册中心将注册、订阅 token、句柄缓存和轻量勾选更新拆分（`menuRegistry.ts:42-153`）；`update` 兼容意图及免重建勾选路径均有注释（`:91,109-115,134-145`）。已审查的迁移路径注释与协议一致；本轮未测量全仓库注释覆盖率，不能断言所有注释完备。文档还记录了 `plugin://` 无法解析父 origin 时发送端回退 `'*'`、依赖 source/origin 检查补偿的边界（`BRIDGE-PROTOCOL.md:67-69`），应在 E2E 复核。

## 7. 问题清单、优先级与整改建议

| ID | 优先级 | 问题与影响 | 定位 | 整改与验收 |
| --- | --- | --- | --- | --- |
| F-01 | P0 | 八份 lock 仍解析 2.0.0–2.2.0；干净安装可能获得旧 SDK。 | S-005 八个 `package-lock.json` | 受控刷新全部 lock；干净安装后根依赖、lock 条目和 `npm ls` 均为 2.3.0。 |
| F-02 | P0 | 八份既有构件仍要求 2.0.0–2.3.0 宿主，可能允许旧宿主加载新协议插件。 | S-008 `build-output/*/manifest.json` | 以更新依赖重建并核对八份输出均为 `minPlatformVersion: 2.4.0`。 |
| F-03 | P1 | 宿主图标测试依赖开发者固定目录，非该机器或空目录会失败，降低测试可移植性。 | `treasure/src/utils/pluginIconRealPath.test.ts:13-24` | 使用临时夹具/可注入路径，或在无安装插件时显式 skip；不同机器可重复运行该用例。 |
| F-04 | P1 | 四插件没有一方测试源码，`npm test` 退出 1 不能提供行为验证。 | S-006 的 google-authenticator、shi-yu-lu、treasure-plugin、kao-cheng-ce 测试源清单 | 为各插件添加至少 SDK 初始化与主要 bridge 结果处理测试；`npm test` 有测试用例并通过。 |
| F-05 | P1 | 未做真实 Tauri iframe E2E，来源校验、按域信封、菜单订阅/注销与版本拒绝尚未运行时确认。 | `memory.md` Open question，S-009 | 在 2.4.0 宿主中加载八插件，覆盖 files/database/settings、两个菜单迁移插件和低版本拒绝。 |
| F-06 | P2 | SDK/宿主各维护映射，未来可能漂移。 | SDK `production.ts:13-23`；宿主 `pluginBridge.ts:54-64` | 采用共享协议描述或生成步骤，并保留契约测试。 |

## 8. 结论与复验清单

源码版本门槛、九域协议映射和已审阅的插件调用一致；当前 node_modules 也链接 SDK 2.3.0。SDK build/test、宿主绝大多数测试和四插件测试均给出正向证据。当前不能发布的决定仅基于可复现交付与覆盖缺口：滞后 lock、滞后生成 manifest、一个硬编码路径测试、四插件无测试源码、未执行 Tauri iframe E2E。

1. 先修复 F-01/F-02，在干净环境重装、构建并核验 lock、`npm ls`、输出 manifest。
2. 修复 F-03，补齐 F-04 的测试后重跑全部测试与 typecheck。
3. 执行 F-05 的真实宿主 E2E，再复核发布判断和 F-06 的共享契约方案。

## 附录：证据索引

- S-001/S-002：SDK 公开 API、生产桥、协议和 2.3.0/2.4.0 要求。
- S-003/S-004：宿主桥接、菜单实现、契约/版本测试和固定路径测试。
- S-005/S-006/S-007：八插件源清单、调用和菜单迁移。
- S-008：八份既有 `build-output` manifest。
- S-009：本轮 typecheck、test、SDK build、依赖解析和格式检查；测试结果以 I1 审阅核对后的完成执行为准。
