# Source index

| ID | Source | Version/date | Used for |
| --- | --- | --- | --- |
| S-001 | `/Volumes/MacExtend/source_code/FrontProjects/treasure-sdk/src/index.ts`, `src/client.ts`, `src/bridge-impl/production.ts` | 工作区 `2.3.0` | SDK 公开 API、能力域请求类型、响应/来源校验。 |
| S-002 | `/Volumes/MacExtend/source_code/FrontProjects/treasure-sdk/CHANGELOG.md`, `docs/BRIDGE-PROTOCOL.md`, `docs/API-REFERENCE.md`, `template/manifest.json.tpl` | 本次未提交改动 | 2.3.0/2.4.0 兼容性、协议与脚手架声明。 |
| S-003 | `/Volumes/MacExtend/source_code/FrontProjects/treasure/src/bridge/pluginBridge.ts`, `src/store/menuRegistry.ts` | 工作区 `2.4.0` | 宿主请求分发、旧信封兼容、菜单实现。 |
| S-004 | `/Volumes/MacExtend/source_code/FrontProjects/treasure/src/bridge/pluginBridge.test.ts`, `src/utils/pluginIconRealPath.test.ts`, `src/utils/platformVersion.ts` | 本次未提交改动 | 宿主契约/版本测试及失败的测试可移植性证据。 |
| S-005 | `/Volumes/MacExtend/source_code/FrontProjects/treasure-plugins/{text-diff,google-authenticator,shi-yu-lu,excalidraw,treasure-plugin,kao-cheng-ce,guan-xiang-pu,json-formatter}/package.json`, `manifest.json`, `package-lock.json` | 当前工作区 | 插件声明版本、最低宿主版本与锁定依赖。 |
| S-006 | `/Volumes/MacExtend/source_code/FrontProjects/treasure-plugins/*/src/main.ts` 及活动 `src/` | 当前工作区 | SDK 初始化、原始 bridge 调用扫描、2.3 菜单调用。 |
| S-007 | `/Volumes/MacExtend/source_code/FrontProjects/treasure-plugins/{shi-yu-lu,excalidraw}/src/...` | 本次未提交改动 | 菜单订阅/勾选同步的迁移实现。 |
| S-008 | `/Volumes/MacExtend/source_code/FrontProjects/treasure-plugins/*/build-output/*/manifest.json` | 既有生成构件 | 源 manifest 与待交付构件不同步。 |
| S-009 | 本轮命令结果：`npm run typecheck`、`npm test`、`npm run build`、`npm ls treasure-sdk --depth=0`、`git diff --check` | 2026-11-14 | 构建、测试、依赖解析和格式检查结果。 |
| S-010 | 本轮对八个活动插件的 `find ... -name '*.test.ts' -o -name '*.spec.ts'` 清单检查 | 2026-11-14 | 区分有测试源的 text-diff、excalidraw、guan-xiang-pu、json-formatter 与未发现测试源的其余四个插件。 |
