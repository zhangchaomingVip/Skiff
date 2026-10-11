# 013 · 验证记录

验证日期：2026-10-11。环境：Windows、PowerShell、Node v24.19.0、npm 11.17.0、Microsoft Edge 151.0.4129.101（Playwright headless）。

## 实现与回退规则

- `src/chat/voyageTimeline.ts` 为纯函数账本：航行从提交开始，思考按片段累计，工具按并行批次墙钟累计。三个读数分别保存，终态一次性冻结；无效时间或时间回退不会使读数变小。
- 工具时间戳未由现有 transcript 单独提供，因此使用首次观察调用／结果的时刻，不将 assistant 的消息时间戳当成工具执行时间。无效提交时间回退到首次观察时刻。
- 没有 ID 的调用使用消息 ID 与 block 位置生成稳定行 ID；pi 随后补全 ID 时原行认领该 ID，保持计时与行顺序。重复调用 ID 收敛到第一个生命周期。无 ID 的结果仅匹配唯一同名活动调用；孤立或歧义结果不误结算其他行。
- 已完成、失败、超时均保留日志与最终耗时。超时由错误结果／已有错误状态中的超时信息判断，5 秒只控制是否显示耗时，不擅自终止长工具。正常结束仍无结果的调用标为“缺少结果”；显式点击停止或 `aborted` 标为“已中止”；bridge／provider 错误标为失败。迟到结果不重开已结算调用。
- 仅有一个 100ms 航行台刷新器。会话切换沿用应用现有的 keyed workspace 卸载机制；新 run 清空工具行、阶段计时与船速。预览分别验证工具终态和刷新器清理，计数排除 Vite 自身的 WebSocket 心跳。
- 活动工具最新调用置顶、旧行向下移动；日志按完成顺序追加。两个列表分别限制高度并支持键盘聚焦与滚动，日志可折叠。长工具名和参数截断显示，保留 title 和可读结果摘要。减少动态效果时取消动画和过渡。
- 活动状态播报只随工具名称／生命周期变化；活动计时位于 `aria-live="off"` 区域，日志 live region 只关注新增记录。船速与峰值只采样 assistant 回复文字；平均速度沿用既有 output／usage 与结束时实测时长规则，保留 800ms 等待边界和上下文提醒。
- 不新增 RPC、Rust 接口或持久化字段。工具账本仅属于当前挂载期间的 run；重新打开历史会话沿用原有总耗时和 usage 恢复，不编造历史工具耗时或峰值。

## 实际执行结果

| 命令 | 结果 |
| --- | --- |
| `npm run build` | 通过：TypeScript 与 Vite 构建成功。Vite 保留 bundle 大于 500kB 的提示，本 feature 未做打包拆分。 |
| `npm test` | 通过：137 项，失败／跳过均为 0；新增 7 项账本及速度边界测试。 |
| `npm run check:ui` | 通过：UI 类型检查成功。 |
| `npm run test:styles` | 通过：125 tokens、0 样式错误、112 组对比度检查、0 对比度失败。 |
| `node tests/voyage-waterfall.browser.mjs http://localhost:1424` | 通过：可控时钟、工具顺序／日志、阶段累计、船速、终态／迟到结果、ID 补全、run／会话隔离、StrictMode 与清理、30 项工具滚动边界；保存 9 张截图。 |
| `node tests/voyage.browser.mjs http://localhost:1424 ../features/013-voyage-tool-waterfall/screenshots/regression/` | 通过：原有航行台 hook 回归、3 个视口 × 2 个主题、折叠／展开提醒、思考／工具／输出／等待、减少动态效果；原有 timing 预览 20 个场景通过，其中补充实际停止按钮的工具终态检查。 |
| `git diff --check` | 通过：无空白错误。 |

浏览器测试启动命令：`npm run dev -- --port 1424 --host 127.0.0.1`。1423 已被占用，未停止原有服务。测试通过 `NODE_PATH` 使用现有运行时的 Playwright，没有新增项目依赖：

```powershell
$env:NODE_PATH = "C:\Users\49772\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules"
node tests/voyage-waterfall.browser.mjs http://localhost:1424
node tests/voyage.browser.mjs http://localhost:1424 ../features/013-voyage-tool-waterfall/screenshots/regression/
```

## 必要计时断言

| 边界 | 已验证读数 |
| --- | --- |
| 单个调用 4999ms | `showDuration === false`，活动行无 `<time>`。 |
| 单个调用 5000ms | `showDuration === true`，活动行显示 `5s`。 |
| 并行批次墙钟 | 纯函数中 A 运行 7000ms，B 运行 4500ms，批次为 7000ms；浏览器中 A／B 为 7000／6000ms，批次为 7000ms。 |
| 终态冻结 | 完成、失败、超时、中止、缺少结果的调用耗时固定；结束后推进时钟或插入迟到结果，整本账本不再改变。 |

另外覆盖：思考 → 工具 → 思考累计、连续批次排除空档、重复 ID 与结束、无效时间与回退、新 run 的三个时钟独立、思考／工具船速为 0、回复增量增速、usage 修正不抬峰值、800ms 等待、会话切换与卸载后刷新器为 0、活动时刷新器最大数量为 1。

## 视觉检查与截图

新航迹在浅色／深色的 1200×800、900×700、600×400、360×640 检查，无页面和工具区横向溢出。窄屏预览使用与应用相同的详情 dialog；活动／日志列表有滚动界限。已读取代表性截图检查布局，长参数、并行活动行、失败日志均可见。

- [浅色并行与失败日志](screenshots/light-1200-parallel-failure.png)
- [深色并行与失败日志](screenshots/dark-1200-parallel-failure.png)
- [600×400 详情与滚动](screenshots/dark-600-parallel-failure.png)
- [360×640 窄屏](screenshots/light-360-parallel-failure.png)
- [减少动态效果](screenshots/dark-1200-reduced.png)
- [完整应用工具阶段回归](screenshots/regression/voyage-tool.png)
- [完整应用思考阶段回归](screenshots/regression/voyage-thinking.png)
- [完整应用输出阶段回归](screenshots/regression/voyage-output.png)

活动区与日志同时出现在上述并行／失败及减少动态效果截图中。失败与超时同时有自动状态断言；截图不替代计时测试。

## 尚未验证

- 真实 pi 进程与真实 provider 的端到端事件顺序（本次浏览器验证使用本地 mock 和可控时钟）。
- Tauri／WebView2 原生窗口与打包产物。
- 实际屏幕阅读器的播报体验；本次验证了 aria 边界及 DOM 语义。

本 feature 未改 Rust，本次未执行 Cargo 检查或原生打包。
