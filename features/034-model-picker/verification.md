# Kimi Code 风格模型选择器

## 行为

- 输入区将模型名和思考状态合并为一个入口。
- 快捷弹层按提供商展示当前模型和收藏模型，包含运行时支持的思考等级、缓存提示及「更多模型」入口。
- 完整窗口支持模型/别名/家族/提供商搜索、提供商筛选、当前选择标记及星标收藏。每行保留上下文、能力、币种、每百万 token 输入/输出单价和扣费账户。
- 收藏按 pi 的 provider + model ID 保存到 `skiff.model-favorites.v1`，同名模型在不同提供商下互不影响。
- 保留具体 Offer 选择和跨账户授权逻辑，当前模型即使不在设置展示清单中，也仍能在窗口中辨认。
- 搜索框支持方向键、Home/End、Enter；输入法确认不提交选择。Escape 关闭后恢复触发器焦点，Tab 保持在模态窗口内。「管理提供商」关闭当前模态后打开对应设置。

## 已通过

- `npm run build`
- `npm run check:ui`
- `npm test`：385 项通过。
- `npm run test:styles`：样式错误 0；126 组对比度检查全部通过。生成的审计 JSON 未纳入本次改动。
- `node tests/model-picker.browser.mjs`：搜索、提供商筛选、同名模型收藏隔离、取消收藏、重载持久化、思考开关/等级、输入法、键盘选择、焦点返回、Tab 约束、管理入口。浅色/深色分别检查 1200×900、900×700、600×400，截图输出到 `dist/model-picker/` 并人工检查。
- `npm run test:cdp -- --model-picker`：使用现有 debug 二进制与当前 Vite 前端，设置 `SKIFF_CDP_BINARY=src-tauri/target/debug/skiff-desktop.exe`。临时 agent 配置、本地 mock provider、隔离 WebView2 目录，保留 localStorage 备份/恢复步骤。验证真实 pi 流式回复、同名模型精确切换、逐模型工具/流式/输出限制、手动选择重开、停用/恢复/删除及错误配置处理，历史价格快照保持不变。Rust 本次未修改。

## 未通过的其他检查

- 无参数的完整 `npm run test:cdp` 在附件草稿刷新恢复步骤等待 `移除文件 cdp-draft.txt` 超时，未进入模型切换检查。新增 `--model-picker` 只限定本次原生回归的范围，不改变默认完整测试内容。
- `tests/sidebar-archive.browser.mjs` 在到达模型交互前，因旧的 `route-deepseek-r1` tooltip 断言失败；当前数据已经以 `skiff-relay-r1` 标识提供商。本次仅更新其进入完整模型窗口的操作步骤，没有调整旧线路断言和其他设置流程。

构建结果、截图、临时脚本和 native 日志均留在忽略目录 `dist/`，未纳入源码改动。
