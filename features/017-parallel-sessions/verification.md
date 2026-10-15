# 验证记录

日期：2026-10-15，Windows，Node 24，Edge 无头浏览器。

- `npm run build`：通过。
- `npm run check:ui`：通过。
- 会话、能力、工作区、线路授权、线路快照和计时的 Node 回归：38 项通过。
- `tests/parallel-sessions.browser.mjs`：通过。覆盖同时生成、切换复用、单独停止、后台完成持久化、发送请求挂起时切换、生成中新建、启动挂起时其它会话独立启动、目标归档清理、后台退出和单独重连、卸载后全部进程和监听器释放。
- `tests/session-switch.browser.mjs`：43 项检查通过，浏览器错误为 0。覆盖导航入口、迟到事件隔离、初始化错误与重试、历史归属、模型/线路/耗时保存、重载、草稿/附件隔离和底层 hook 清理。当前消息界面没有“编辑并重发”入口，旧编辑隔离用例明确记录为跳过。
- `node tests/pi.integration.mjs <pi-cli.js>`：真实 pi 本地集成通过，只使用回环测试服务器和临时配置。
- `npm test`：160 项，156 通过，4 失败。失败位于既有 `modelDiscovery.test.ts`（2 项，测试传入字符串而实现读取模型描述对象）和 `providerRoutes.test.ts`（2 项，模型去重）。对应源码与测试均与 HEAD 一致，本次未修改。

开发预览和生产构建均运行上述两组浏览器回归并通过，使用独立入口，不调用真实 API：

```powershell
npx vite --config tests/session-switch.vite.ts --port 1432 --strictPort
node tests/parallel-sessions.browser.mjs http://localhost:1432
node tests/session-switch.browser.mjs http://localhost:1432 dist/session-switch-results.json --samples 2 --query 'messages=6&chats=3&delay=0'
```

生产验证先运行 `npx vite build --config tests/session-switch.vite.ts`，再通过 `npx vite preview --config tests/session-switch.vite.ts --port 1433 --strictPort` 启动，将上述浏览器命令的地址替换为端口 1433。生产切换报告为 `dist/session-switch-production-results.json`。

需要已有 Playwright 安装；可设置 `SKIFF_PLAYWRIGHT_DIR` 指向它。截图保存到 `dist/parallel-sessions/parallel.png`，详细切换检查记录保存到 `dist/session-switch-results.json`，生成产物不提交。
