# Treasure 三项目围绕 treasure-sdk 调整的一致性核验报告（草案）

> 核验时间：2026-11-14；对象：三个工作区当前未提交状态。本文只陈述静态源码、清单、既有构件和本轮命令结果可支持的结论；没有修改业务实现。

## 1. 执行摘要与发布判断

SDK `2.3.0` 与宿主 `2.4.0` 的九个能力域请求信封一致；八个活动插件的**源** `package.json` 都声明 `treasure-sdk ^2.3.0`，根 `manifest.json` 都要求宿主 `2.4.0`。已审阅的活动源码未发现直接发送旧统一桥接信封、直接监听 `treasure-menu-event`，或调用已从 SDK 公共面移除的 `request(action, payload)`。

但当前状态不应以既有 `build-output` 作为可发布证明：八份锁文件仍解析 `treasure-sdk 2.0.0`–`2.2.0`，八份生成 manifest 仍声明 `minPlatformVersion 2.0.0`–`2.3.0`。干净安装或交付旧构件会绕过此次 2.3/2.4 的源码声明，属于发布一致性风险。SDK 类型检查和 13 项单测通过；宿主及插件单测在本轮环境启动失败，且未做真实 Tauri iframe E2E，故不能据此确认端到端功能正常。

**发布判断：有条件不通过。** 先更新全部锁文件、重新构建并核对生成 manifest；在可写、可解析本机 `localhost` 的环境复跑测试，再完成真实宿主加载八个插件的 E2E 后复验。

## 2. 范围、版本基线与方法

范围为 `/Volumes/MacExtend/source_code/FrontProjects/treasure-sdk`、`/Volumes/MacExtend/source_code/FrontProjects/treasure` 与 `/Volumes/MacExtend/source_code/FrontProjects/treasure-plugins` 的当前工作区；活动插件限定为含根 `manifest.json` 的：`text-diff`、`google-authenticator`、`shi-yu-lu`、`excalidraw`、`treasure-plugin`、`kao-cheng-ce`、`guan-xiang-pu`、`json-formatter`。

版本基线来自 SDK `package.json`（`2.3.0`）和宿主 `package.json`（`2.4.0`）。核验方法为：比对 SDK/宿主映射和菜单协议，扫描八个插件活动 `src/`，检查 `package.json`、`manifest.json`、`package-lock.json` 与 `build-output/*/manifest.json`，并执行本轮类型检查、单测、依赖解析及 `git diff --check`。`git diff --check` 在三个仓库均无输出。

## 3. SDK—宿主协议一致性

### 3.1 映射与版本门槛

SDK 的 `REQUEST_TYPE_BY_CAPABILITY` 在 `production.ts:13-23` 声明 files、directories、storage、database、settings、permissions、menus、notifications、logs 九个能力域；宿主在 `pluginBridge.ts:54-64` 列出相同映射。两端均把 database 保留为 `treasure-db-request`，响应类型均由 `-request` 推导为 `-response`（SDK `production.ts:27-35`；宿主 `pluginBridge.ts:69-82`）。宿主契约测试还断言了该映射（`pluginBridge.test.ts:61-82`）。这是源码层面的强一致证据。

SDK 变更记录明确 2.3.0 需要 2.4.0+ 宿主（`treasure-sdk/CHANGELOG.md:3-24`）；协议文档列出九域与 2.4.0 最低版本（`docs/BRIDGE-PROTOCOL.md:29-39`）。模板也将 `minPlatformVersion` 设为 `2.4.0`（`template/manifest.json.tpl:4-12`）。八份源 manifest 及依赖声明与该门槛一致，见下一节。

### 3.2 菜单迁移与兼容边界

SDK 公开 `menus.register/update/updateChecked/subscribe/unsubscribe/unregister`（`src/index.ts:36-43`）；宿主对注册 payload 做根菜单、项目和类型校验（`pluginBridge.ts:95-126`），并实现订阅、注销、勾选状态同步（`menuRegistry.ts:52-71, 116-153`）。`menus.update` 是为兼容保留的别名，新增代码应优先 `register`，这在 SDK 协议文档中有明确说明（`BRIDGE-PROTOCOL.md:41-43`）。

宿主同时保留旧 SDK 的统一 `treasure-db-request` 接收路径（`pluginBridge.ts:49-67`；`BRIDGE-PROTOCOL.md:55-59`）。这解释了旧插件的兼容性，**不表示**新 SDK 插件可在旧宿主运行；新 SDK 的按域信封在旧宿主会超时，必须由 manifest 的最低版本阻止加载。

## 4. 插件迁移与依赖矩阵

| 活动插件 | 源依赖与源 manifest | 活动源码观察 | 锁文件 / 既有构件 |
| --- | --- | --- | --- |
| text-diff | `^2.3.0` / `2.4.0` | `src/main.ts` 使用 `initTreasure`，文件访问经 SDK `files` | lock `2.1.1`；构件 manifest `2.0.0` |
| google-authenticator | `^2.3.0` / `2.4.0` | `src/main.ts` 初始化；数据库/存储/文件均导入 SDK | lock `2.1.1`；构件 `2.1.2` |
| shi-yu-lu | `^2.3.0` / `2.4.0` | SDK 菜单注册、订阅、注销和 `updateChecked` | lock `2.1.0`；构件 `2.1.0` |
| excalidraw | `^2.3.0` / `2.4.0` | SDK 菜单注册、订阅及勾选同步 | lock `2.1.1`；构件 `2.3.0` |
| treasure-plugin | `^2.3.0` / `2.4.0` | `initTreasure` 与 SDK `files` | lock `2.0.0`；构件 `2.0.0` |
| kao-cheng-ce | `^2.3.0` / `2.4.0` | SDK database/storage/logs/notifications/settings | lock `2.0.0`；构件 `2.0.0` |
| guan-xiang-pu | `^2.3.0` / `2.4.0` | `initTreasure` 与 SDK files/directories/permissions/settings | lock `2.2.0`；构件 `2.3.0` |
| json-formatter | `^2.3.0` / `2.4.0` | `initTreasure` 与 SDK `files` | lock `2.1.1`；构件 `2.0.0` |

矩阵的源清单证据为 `S-005`，锁文件行位于每个插件 `package-lock.json` 的根依赖及 `node_modules/treasure-sdk` 条目，构件证据为 `S-008`。本轮 `npm ls treasure-sdk --depth=0` 在八个安装目录均解析为指向 `./../../treasure-sdk` 的 `2.3.0` 链接。因此，当前安装目录的解析与源声明一致，但锁文件不能复现该结果。

菜单迁移的正向例证：`shi-yu-lu/src/App.vue:533-577` 已通过 `menus.subscribe` 接收事件并使用 `menus.updateChecked`；`excalidraw/src/adapters/menu-actions.ts:15-28` 已以同一类型化 API 注册、订阅、更新和清理。针对八个活动 `src/` 的检索未命中 `treasure-db-request`、`treasure-menu-event` 或 SDK 的 `request(action, payload)` 直接调用；其中普通网络客户端的 `.request()` 不被视为 SDK bridge 调用。

## 5. 功能验证结果与覆盖边界

| 验证 | 结果 | 解释 |
| --- | --- | --- |
| SDK `npm run typecheck` | 通过 | TypeScript 无诊断。 |
| SDK `npm test` | 通过 | 3 个文件、13 项测试通过。 |
| 宿主 `npm run typecheck` | 通过 | `vue-tsc --noEmit` 无诊断。 |
| 宿主 `npm test` | 启动失败 | Vitest 在启动时 `getaddrinfo ENOTFOUND localhost`，未进入测试用例；不是功能通过证据。 |
| 八插件 `npm run typecheck` | 全部通过 | 每个插件的 `vue-tsc --noEmit` 退出码为 0。 |
| 八插件 `npm test` | 全部启动失败 | Vite/Vitest 尝试写入临时配置文件时均报 `EPERM`，未进入测试用例；是本轮环境限制，也是测试可移植性问题。 |
| `git diff --check`（三仓库） | 通过 | 无空白错误输出。 |
| 真实 Tauri/iframe E2E | 未执行 | 未加载真实 2.4.0 宿主，也未逐一验证八插件安装、桥接、菜单回调和升级拒绝路径。 |

因此，类型系统和 SDK 单元契约给出正向信号；宿主/插件单测失败在初始化环境，不能推导代码功能失败，也不能替代测试通过。端到端运行结论为**未验证**。

## 6. 结构、冗余、注释与文档评价

协议分域、源/响应类型绑定、来源和 origin 检查在 SDK `production.ts:81-104` 与协议文档 `BRIDGE-PROTOCOL.md:21-25, 45-53` 有对应实现/说明，边界职责清晰。SDK 与宿主各自持有一份映射属于跨 iframe 边界的必要副本，但变更需要双端同步；现有宿主契约测试降低了漂移风险，仍建议由共享契约或生成步骤消除手工双改。

菜单注册中心将注册、订阅 token、缓存句柄和轻量勾选更新分离（`menuRegistry.ts:42-153`）；注释说明了 `update` 的兼容性目的（`109-115`）和无重建更新意图（`91, 134-145`），与协议文档一致。已检查的迁移路径注释充分；本轮没有进行全仓库注释覆盖率统计，不能据此断言所有注释均完整。

文档还公开记录一个边界：在 `plugin://` 不能解析父 origin 时，发送端回退 `'*'`，依赖 source/origin 校验补偿（`BRIDGE-PROTOCOL.md:67-69`）。这不是本轮确认的可利用缺陷，但应在 E2E 与后续握手设计中复核。

## 7. 问题清单、优先级与整改建议

| ID | 优先级 | 问题与影响 | 定位 | 整改与验收 |
| --- | --- | --- | --- | --- |
| F-01 | P0 | 八份锁文件仍解析 2.0.0–2.2.0；干净安装可能获取旧 SDK，与源声明/2.4 协议不一致。 | 八个 `package-lock.json`（S-005） | 在每个插件按受控依赖流程刷新 lock，验收：根依赖与 `node_modules/treasure-sdk` 都为符合 `^2.3.0` 的解析，干净安装后 `npm ls` 为 2.3.0。 |
| F-02 | P0 | 八份 `build-output` manifest 的最低宿主版本仍为 2.0.0–2.3.0；交付这些构件可能允许旧宿主加载新协议插件。 | `*/build-output/*/manifest.json`（S-008） | 用更新后的依赖重建全部插件并发布新构件，验收：八份输出 manifest 均为 `minPlatformVersion: 2.4.0`，且产物 SDK 解析与 lock 一致。 |
| F-03 | P1 | 宿主与八插件的单测未运行到用例，当前验证无法覆盖回归。 | 宿主 `npm test` 的 localhost 解析失败；插件 `npm test` 的临时配置写入 EPERM。 | 在正常可写 CI/开发环境固定 Vitest 配置与 localhost 解析前置条件，验收：测试进入并完成用例；将失败原因与测试结果分别报告。 |
| F-04 | P1 | 未有真实 Tauri iframe E2E，不能确认来源校验、按域信封、菜单订阅/注销及最低版本拒绝在运行时生效。 | `S-009`、`memory.md` Open question | 建立 2.4.0 宿主加载八插件的 E2E；至少覆盖一次 files/database/settings、shi-yu-lu 与 excalidraw 菜单事件/勾选同步、旧宿主拒绝新 manifest。 |
| F-05 | P2 | SDK/宿主各维护映射，虽然当前一致，未来容易手工漂移。 | SDK `production.ts:13-23`；宿主 `pluginBridge.ts:54-64` | 提取共享协议描述或生成映射；验收：单一契约变更能驱动两端并保持契约测试。 |

## 8. 结论与复验清单

结论：源码迁移的版本声明、九域桥接映射及已审阅的插件调用方式一致；当前解析环境也链接到本地 SDK 2.3.0。无法确认“插件、接口、宿主均可正常使用”，原因是锁文件/生成构件滞后、宿主和插件测试未运行到用例、Tauri iframe E2E 尚未执行。

复验顺序：

1. 修复 F-01、F-02 后在干净目录安装、构建，逐插件核对 lock、`npm ls`、输出 manifest。
2. 在可执行 Vitest 的环境重跑 SDK、宿主和八插件的 typecheck/test；将启动失败和断言失败分开记录。
3. 启动 Treasure 2.4.0，逐插件执行真实加载与核心桥接；专测 shi-yu-lu/excalidraw 菜单订阅、注销、勾选同步。
4. 用低于 2.4.0 的宿主/安装路径验证新 manifest 被拒绝；完成后复核 F-05 是否需要生成式契约。

## 附录：证据索引

- S-001/S-002：SDK 公开 API、生产桥、协议和 2.3.0 兼容性说明。
- S-003/S-004：宿主桥接、菜单注册中心及契约/可移植性测试。
- S-005/S-006/S-007：八个活动插件的源清单、活动调用和菜单迁移。
- S-008：八份既有 `build-output` manifest。
- S-009：本轮命令：`npm run typecheck`、`npm test`、`npm ls treasure-sdk --depth=0`、`git diff --check`。构建未作为通过项：未在本轮产生可复核的新交付构件。
