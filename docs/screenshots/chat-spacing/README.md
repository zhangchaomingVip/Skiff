# 对话工具间距检查

2026-10-20，使用独立的 Vite 1421 端口及 mock pi，不调用真实模型。

复现：`npm run dev -- --port 1421 --strictPort`，打开 `/tests/preview.html?fixture=tool-spacing&theme=light&static=1`，可将 theme 改为 dark。

- 1280 × 900 和 390 × 844，两种主题截图见本目录。
- 折叠工具摘要约 24.8 CSS px，相邻助手步骤间距为 8px。长命令单行截断，展开后保留全文与输出。
- 检查了整轮折叠、工具组与单个工具展开、Token 明细展开；空的中间消息和空的结束用量消息不再产生独立占位。结束用量与重新生成入口各显示一次。
- 窄屏文档宽度与视口均为 390px，无页面横向溢出；触屏及窄屏保留正文操作栏，避免遮住内容。
- 后续调整：隐藏普通的 `Agent finished its current task.` 通知；移除用户消息框与助手回复左侧竖条。结束栏常显提供商/路线/模型、Token、费用与完成时间，缺失价格显示“未配置单价”。窄屏结束栏可完整换行，明细展开和 Escape 收起正常。
- 复制入口调整：每轮助手回复仅在左下角显示一个正文复制按钮，复制该轮所有正文步骤；重新生成一起放到底部。已确认剪贴板包含开头说明与最终结论，折叠后仍只有一个入口，两种主题及窄屏无横向溢出；见 `copy-action-light.png`。
- `npm test`：214 项通过；`npm run build`、`npm run check:ui`、`npm run test:styles` 通过，样式及对比度错误为 0。更新了 `turn-usage.browser.mjs` 的常显信息断言；该独立浏览器脚本未运行，交互通过 Codex 浏览器预览检查。

本次在浏览器 mock 预览中验证，未进行真实 pi 或 Tauri WebView2 回归。
