# 014 航行台优化验证

日期：2026-10-11。环境：Windows、Node 24.19.0、Microsoft Edge 151.0.4129.101、Playwright headless。复用项目现有 Vite 服务 `http://127.0.0.1:1424`，使用模拟 bridge 和可控时钟。

## 实现口径

- 当前航行每个 assistant 请求累计 `input + cacheRead + cacheWrite`，包含工具往返后的请求和流式 usage；上下文不使用 `totalTokens`、输出 Token 或事件时间线的旧上下文读数。
- 以航行 key 隔离输入账本，每个消息 ID 保存最大的已观察完整输入。重复、较小或暂时消失的 usage 不会重计或清除输入；后续请求仍继续累加。航行记录中的输入使用同一账本。
- 没有有效输入 usage 时，估算本次用户文本、回复、思考、工具参数和工具结果。收到有效输入后使用累计 API 输入；若此前估算更大，则保留该最大值及估算标记，直到 API 输入追上。展开面板及收起状态栏都标记估算。
- 思考遵循已有 `summarizeUsage` 规则，使用 `usage.reasoning`，不额外加入输出量；已上报 usage 缺少 reasoning 时显示 `—`。
- 航海日志统计 `failed`、`timeout`、`interrupted`、`missing` 四种非成功终态，失败数为零不显示括号。列表显示明确状态，失败行参数移至下一行，无目标参数只显示工具名和图标。
- 修正工具航迹将 `TOOL_ICONS` 的图标名称直接显示为文本的问题，改为项目已有 `Icon` 组件。
- RPC、Rust 接口和持久化字段未改动。

## 命令与结果

| 命令 | 结果 |
| --- | --- |
| `npm test` | 通过，145/145；新增 7 项输入账本纯函数测试，并保留已有多步骤与 reasoning 测试 |
| `npm run build` | 通过；Vite 仍提示 JS chunk 大于 500 kB，产物约 675.47 kB，不影响构建 |
| `npm run check:ui` | 通过 |
| `npm run test:styles` | 通过；125 个 tokens，0 样式错误，112 对对比度检查，0 失败 |
| `node tests/voyage-polish.browser.mjs http://127.0.0.1:1424` | 通过，18 张截图 |
| `node tests/voyage-waterfall.browser.mjs http://127.0.0.1:1424 ../features/014-voyage-panel-polish/screenshots/waterfall/` | 通过，9 张截图 |
| `node tests/voyage.browser.mjs http://127.0.0.1:1424 ../features/014-voyage-panel-polish/screenshots/regression/` | 通过；受控 hook、既有 UI 回归和 timing preview 的 20 个场景 |
| `git diff --check` | 通过 |

浏览器命令运行前设置：

```powershell
$env:NODE_PATH = "C:\Users\49772\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules"
```

## 覆盖与截图

- 纯函数断言：多请求与缓存输入累计、流式 usage、重复消息 ID、较小 usage 后追加新请求、usage 消失、新航行隔离、当前用户边界、零输入、无效输入、本地工具参数与结果估算、估算转为 API 读数及估算最大值保留。
- DOM 断言：上下文与输入一致，事件时间线的 `contextUsed: 999999` 不覆盖累计输入；耗时和三类 Token 的实际数值正确；无参数工具没有目标文案，所有非成功终态显示状态；日志失败总数和零失败摘要正确。
- 本 feature 的视口：1200×800、900×700、600×400、360×640，浅色和深色各一轮。断言页面、面板、日志、工具行、航行记录无横向溢出，覆盖面板与日志展开/收起、列表滚动和减少动态效果。
- 既有瀑布回归：4999/5000ms 边界、并行批次墙钟时间、完成顺序、迟到结果冻结、阶段累积、速度更新边界、时间回退、会话隔离、30 项日志的滚动边界和 StrictMode interval 清理。
- 截图在 `screenshots/`、`screenshots/waterfall/`、`screenshots/regression/`。人工检查了 `light-1200-failure-log.png`、`dark-360-tokens.png` 和 `dark-360-terminal-states.png`，失败徽标和 Token 记录没有重叠。

## 未覆盖

- 未运行真实 pi/provider 的工具往返、缓存 usage 和 reasoning 上报验证；本次数据来自纯函数及模拟 bridge。
- 未启动 Tauri 或测试原生 WebView2；浏览器验证使用 Edge headless。
- 未用真实屏幕阅读器试听动态状态、工具结果和失败列表；自动化仅验证 DOM、可见状态及已有 aria 边界。

## 小船横移修复

2026-10-11 根据仪表小船反复横移的反馈补充修复。旧 HTML 小船样式的 `translateX(-50%)` 同时作用于 SVG 小船，而新动画在周期中点只有 `translateY(-3px)`。浏览器对两个 transform 插值，修复前在 1200px 视口实测每周期左右移动约 114px；思考/工具状态还会使用旧动画。

在 `voyage.css` 中为 SVG 仪表小船限定样式，清除 HTML 定位与横向 transform，并显式定义动画起点、终点及中点的纵向位置。小船保留最多 3px 的上下浮动，各阶段不再改变水平位置；减少动态效果时没有动画和 transform。

- `node tests/voyage-boat.browser.mjs http://127.0.0.1:1424`：通过。对停泊、等待、思考、工具执行、输出五种状态，在 1200×800、360×640 和浅深色主题下分别采样整个动画周期的五个时间点；断言水平漂移小于 0.1px、垂直浮动不超过 3.1px、小船留在仪表范围内、阶段切换位置稳定，并检查减少动态效果及清理。
- `npm run build`、`npm run test:styles`、`git diff --check`：通过。
- `node tests/voyage.browser.mjs http://127.0.0.1:1424 ../features/014-voyage-panel-polish/screenshots/regression/`：通过，包含原有动画与减少动态效果回归，以及 timing preview 的 20 个场景。
- 四张截图在 `screenshots/boat/`；人工检查 `light-1200-moored.png`，小船位于仪表内部，未与读数重叠。

## 顶部状态简化

2026-10-11 将右上角状态统一为运行时“航行中”、结束或空闲时“已停止”，移除该处的阶段文字与计时。状态圆点只区分运行/停止，不随思考或工具阶段切换。仪表盘保留阶段状态和计时。

`npm run build`、`npm run test:styles`、`git diff --check` 和两组浏览器验证 `voyage-boat.browser.mjs`、`voyage.browser.mjs` 均通过。五种状态、桌面/窄屏及浅深色主题断言了顶部准确文案和状态圆点；现有预览同时验证思考与工具状态仍显示在仪表盘中。截图已更新。

## 流式 usage 导致指针归零修复

2026-10-11 根据输出期间指针仍在零位的新截图复现问题：流式 `text_delta` 携带的 usage 可能全为零，事件时间线将其标为实测输出。此前 `exactSpeed` 用该累计输出覆盖可见文本采样，造成当前速度为 0，而平均/最高速度仍为正。首次指针测试未携带流式 usage，因此漏掉了这一场景。

修复 `useVoyageMetrics`：实时速度始终使用可见回复增量的平滑采样，累计 usage 不驱动实时仪表；流式速度明确标记为估算。结束后的 usage 统计、等待/思考/工具阶段归零以及历史峰值保持既有行为。

扩展 `node tests/voyage-needle.browser.mjs http://127.0.0.1:1424`，从真实 reducer 的模拟 pi 事件路径向顶层 usage 和 delta usage 分别注入零值，另注入较大的累计输出 usage。修复前稳定失败：当前船速 0、指针 -90°、峰值 28.9 且错误标记实测；修复后测试通过：思考阶段显示计时，零 usage 输出 28.9 tok/s 时指针为 -72.7°，加速至 75.3 tok/s 时转至 -44.8°，累计 usage 更新不改变即时船速或峰值，结束后回到 0 tok/s、-90°。三张截图在 `screenshots/needle/`，人工检查了 `faster-output.png`。

- `npm test`：149/149 通过。
- `npm run build`、`npm run check:ui`、`npm run test:styles`：通过，仍有既有 Vite chunk 大小提示。
- `voyage-polish.browser.mjs`：通过；`voyage-waterfall.browser.mjs`：单独重跑通过。瀑布并发初跑在 600px 视口的动画期间出现 1px 溢出断言，未修改相关样式。
- 原有航行台回归初跑因 Windows 无法写入已有 `regression/voyage-tool.png` 中断，使用独立 `screenshots/needle-regression/` 目录重跑通过，包括 3 种视口、浅深色主题、阶段展示、减少动态效果和 timing preview 的 20 个场景。
- `git diff --check`：通过。

此验证使用浏览器模拟事件，未连接真实 pi/provider 或 Tauri/WebView2。
