# 016 · 验证记录

实施日期：2026-10-13。

已完成的数值验证：

- `tests/voyageContext.test.ts` 覆盖累计输入与当前上下文拆分、缓存输入、重复/全零/无效 usage、最新请求下降、工具结果增量和本地粗估。
- 7 次请求样例的累计输入为 `218805`；最后一次完整输入为 `32401`。接入 pi 快照时上下文直接采用 `contextUsage.tokens`，不会再把 7 次请求相加。
- `npm test`：156 个测试通过。
- `npm run build`：TypeScript 严格检查和 Vite 构建通过。
- `npm run check:ui` 与 `npm run test:styles`：通过。

实现覆盖：

- `SessionState.contextUsage` 保存来源、有效值、窗口、估算标记和版本；历史恢复、结束、工具结果、压缩、回退/分叉及模型切换会刷新或失效读数。
- `get_session_stats` 缺失时进入本地兼容路径；明确 `tokens: null` 保持待更新，不回填旧读数；同一会话刷新串行合并，迟到结果受 owner/version 校验保护。
- 航行台将上下文与“累计输入 tokens（含缓存）”分开，未知读数显示待更新，估算提醒使用估算措辞。

浏览器脚本已按新口径更新，但本机未安装 `playwright`，因此未执行 `voyage-polish.browser.mjs` 与 `voyage-waterfall.browser.mjs` 的截图运行。真实本机 pi loopback 的供应商调用、WebView2 截图和窄屏浅色/深色浏览器截图仍需在桌面运行时补充验证。
