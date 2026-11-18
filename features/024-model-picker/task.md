# 024 · Kimi Code 风格模型选择器

状态：已实现，验证记录与证据见 [verification.md](verification.md)（含真实桌面 CDP 回归）。

## 目标与范围

将输入区的模型名和思考状态合并为单一入口，对齐 Kimi Code 的选择器形态：快捷弹层快速切换当前/收藏模型，完整窗口承担搜索、筛选与收藏管理。不改线路配置模型与授权状态机，只重构选择入口。

## 行为约定

- 快捷弹层按提供商展示当前模型和收藏模型，包含运行时支持的思考等级、缓存提示及「更多模型」入口。
- 完整窗口支持模型/别名/家族/提供商搜索、提供商筛选、当前选择标记及星标收藏；每行保留上下文、能力、币种、每百万 token 输入/输出单价和扣费账户。
- 收藏按 pi 的 provider + model ID 保存到 `skiff.model-favorites.v1`，同名模型在不同提供商下互不影响。
- 保留具体 Offer 选择和跨账户授权逻辑；当前模型即使不在设置展示清单中，也仍能在窗口中辨认。
- 搜索框支持方向键、Home/End、Enter；输入法确认不提交选择。Escape 关闭后恢复触发器焦点，Tab 保持在模态窗口内；「管理提供商」关闭当前模态后打开对应设置。

## 验证

- `npm run build`、`npm run check:ui`、`npm test`（385 项）、`npm run test:styles`。
- `node tests/model-picker.browser.mjs`：浅/深主题、三种视口。
- `npm run test:cdp -- --model-picker`：真实 pi 流式回复与模型切换链路。
