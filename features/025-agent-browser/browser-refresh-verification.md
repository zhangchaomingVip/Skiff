# 浏览器标签与界面调整验收

2026-11-19，Windows / WebView2 / 本地 agent-browser。

## 实现

- 修正 `browser_tab` 的 `tabId` 字段映射、显式切换被旧目标覆盖，以及 Chrome 关闭确认早于目标消失造成的残留标签。
- 标签管理不再依赖画面首帧；最后一个标签关闭成功后收起面板。
- 新标签页由 React 渲染，通过原生 `browser_navigate` 导航；导航确认先于历史提交时发布已接受的目标地址，使画面连接能够启动。
- 添加居中地址输入、Google 关键词搜索、全局最近 100 条访问记录及最多 8 条建议，支持键盘选择和逐条删除。
- 调整标签与导航胶囊样式，移除底部交还／继续悬浮按钮，网页更多菜单保留 AI 操作。

## 已通过

- `npm test`：414 项。
- `npm run build`、`npm run check:ui`、`npm run test:styles`：通过；样式与对比度审计无失败。
- `cargo check --manifest-path src-tauri/Cargo.toml`；Rust 全库测试 105 项通过、5 项环境测试默认忽略。最终浏览器模块单测 17 项通过。
- 显式运行 `real_manual_tab_new_and_close_round_trip -- --ignored --nocapture`：真实 Chrome 新建、激活、切换和关闭通过。
- `browser-panel.browser.mjs`、`browser-control.browser.mjs`、`browser-new-tab.browser.mjs`：浅深主题、窄面板、接管交还、无画面关闭、关闭失败、跨聊天异步结果、输入法、搜索、历史删除与持久化通过。
- `app.cdp.mjs --browser`：真实 WebView2 → Tauri → Chrome 的新建、后台关闭、空白页导航、历史建议、最后标签收起和重新打开通过；原生控制权交接、实例隔离、真实 pi 普通聊天及进程退出清理通过。

桌面测试使用复制的当前 debug 可执行文件（`SKIFF_CDP_BINARY`），复用开发服务器；已核对临时 WebView2 profile，使用临时 agent／browser 目录，退出恢复 localStorage。

## 验证限制

额外运行的 `app.cdp.mjs --browser-tools` 在既有 `form` 场景中出现 provider 重试，等待“真实 pi 浏览器工具验证完成：form”120 秒后超时。未确认根因，不将该完整 AI 表单场景记为通过。菜单交还／继续已通过 mock 交互回归，原生交接通过真实浏览器专项。

## 截图

- `dist/browser-new-tab/{light,dark}-new-tab.png`
- `dist/browser-new-tab/{light,dark}-suggestions.png`
- `dist/browser-new-tab/{light,dark}-narrow.png`
- `dist/cdp-browser-tabs-page.png`
- `dist/cdp-browser-tabs-history.png`

截图及构建产物不入库。
