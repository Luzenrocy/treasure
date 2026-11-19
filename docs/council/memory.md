# Working memory

- [Decision] 核验对象是三个仓库当前未提交状态；未修改业务源码。见 `requirements-ledger.yaml` U-001/U-007。
- [Decision] “活动插件”指包含根 `manifest.json` 的八个插件：text-diff、google-authenticator、shi-yu-lu、excalidraw、treasure-plugin、kao-cheng-ce、guan-xiang-pu、json-formatter；插件市场和图标服务不作为 iframe SDK 消费者。
- [Fact] SDK `2.3.0` 的新能力域消息协议要求宿主 `2.4.0+`；宿主和源 manifest 已声明对应版本。
- [Fact] 现有 node_modules 均解析到本地 `treasure-sdk@2.3.0` 软链接，但八个 package-lock.json 仍保留 2.0.0–2.2.0 的解析；这是可重复构建风险，不等同于活动源码使用旧 API。
- [Fact] 当前 build-output manifest 是旧构件，不能作为本次源码调整的发布证明。
- [Open question] 未执行真实 Tauri 应用中 iframe 的手动 E2E；报告必须说明该边界。
