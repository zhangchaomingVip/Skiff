# 012 航行台优化验证记录

实施及验证日期：2026-10-11。

本轮平均速度包含提交等待、思考和工具执行时间；仅完整的本轮 output usage 校正平均值，否则标注文字估算。最高速度保留 500ms 窗口平滑峰值，不受仪表盘 300 tok/s 刻度限制，也不接受 usage 校正。航行台和折叠后的底部状态条显示并排统计。原有航行记录中的输出 tokens 仍使用已报告 usage，等待确认时显示「—」。

思考中、等待响应的状态胶囊与底部状态条会同步显示本轮计时，例如「思考中 · 3s」；工具执行中改用当前未返回工具调用的独立计时，例如连续调用从「工具执行中 · 0s」重新开始，不继承整轮的 10s。整轮计时仍从提交开始，跨过首 Token 等待、思考、工具和回复阶段，结束后冻结到本轮耗时。

任务提交立即钓鱼；思考或回复文字新增时航行，连续 800ms 无新增输出后归零并钓鱼；停止后静止停泊。工具结果按调用 ID 配对，已输出的工具调用尚无结果时显示「工具执行中」，当前思考块显示「思考中」，其余等待显示「等待响应」。上下文压力独立于活动状态，90% 起持续提示；100% 和超过上限有各自文案。仅底部提醒提供 polite 状态播报。

## 自动检查

| 检查 | 实际结果 |
| --- | --- |
| `npm run build` | 通过，严格 TypeScript 与 Vite 构建成功 |
| `npm test` | 128/128 通过；其中航行统计、活动状态及上下文测试 10 项 |
| `npm run check:ui` | 通过 |
| `npm run test:styles` | 通过：123 个变量，0 样式错误，112 组对比度，0 不达标 |
| `node tests/voyage.browser.mjs http://localhost:1423` | 通过可控时钟 hook 回归、模拟应用布局及动画检查、原有计时预览 20 场景 |
| `git diff --check` | 通过 |

构建仍有 >500KB chunk 提示。未新增运行时依赖或原生接口。样式审计重新生成了 `features/009-ui-system-hardening/style-audit.json`，已检查差异：只有原有工作区报告的 `src/index.css` 行号变动，审计错误仍为零。实施前已有 `usage.ts`、`TurnUsage.tsx`、`VoyageRail.tsx` 的 Token 格式改动，均保留。

## 确定性回归

`tests/sailing.test.ts` 使用指定时间和 Token 样本，验证 500ms 窗口、平滑峰值超过 300、低于 5 的非零读数、799/800ms 边界、等待后的恢复、重复结束不再计时、新轮清零、工具参数排除、工具结果配对、连续工具调用 ID 切换、思考状态、多段 usage 求和、不完整 usage 保留估算、无效分母及历史平均值。覆盖 89.9%、四舍五入显示 90% 但实际不足阈值、90%、95%、100%、超限、未知数据和模型上限变化。

`tests/voyage.html` / `voyage.preview.mjs` 在 React StrictMode 下用可控时钟及可手动推进的 interval 驱动真实 `useVoyageMetrics` 和组件。验证提交尚未确认时不读取上一轮、结束 usage 不抬高峰值、结束后均值冻结、取消/失败/卸载无 interval、会话清空消除旧峰值、恢复正在运行的历史文字作为采样基线、后续新增文字才开始航行、多段输出保留峰值、连续工具调用从 0s 重新计时、不完整 usage 回退估算，以及上下文提示更新和消失。

## 浏览器与视觉检查

在独立 Vite 端口 1423，使用本机 Microsoft Edge 的 headless 浏览器及模拟 pi bridge；未访问真实模型。检查 1200×800、900×700、600×400 三种视口，浅色和深色主题各一组。

- 展开统计并排、一位小数与 tok/s 单位、历史峰值「—」、估算文字均可读。
- 折叠后底部上下文提醒仍可见，95% 保留 warning 配色；状态仍显示实际停泊或活动。
- 600×400 详情通过现有模态窗口展开，可滚动访问提醒及航行记录；无横向溢出。
- 钓鱼小人、鱼竿及浮标未裁切；钓鱼时尾流 opacity 为 0、海浪无横移动画；航行时恢复海浪。
- 减少动态效果下，小船、浮标、尾流和海浪的计算动画均为 none；静态姿态和文案保留。
- 提醒与模型状态通知在宽屏和窄屏同时出现，无文本裁切；浏览器无 pageerror。

截图保存在 [screenshots](screenshots/)，代表记录：

| 检查内容 | 截图 |
| --- | --- |
| 展开与高上下文（浅色宽屏） | [light-1200-context.png](screenshots/light-1200-context.png) |
| 折叠与高上下文（深色中屏） | [dark-900-context.png](screenshots/dark-900-context.png) |
| 窄屏底部提醒 | [light-600-context.png](screenshots/light-600-context.png) |
| 窄屏展开统计 | [dark-600-expanded.png](screenshots/dark-600-expanded.png) |
| 窄屏滚动查看记录 | [light-600-details.png](screenshots/light-600-details.png) |
| 钓鱼及工具等待 | [voyage-fishing.png](screenshots/voyage-fishing.png)、[voyage-tool.png](screenshots/voyage-tool.png) |
| 思考和回复输出 | [voyage-thinking.png](screenshots/voyage-thinking.png)、[voyage-output.png](screenshots/voyage-output.png) |
| 减少动态效果 | [voyage-fishing-reduced.png](screenshots/voyage-fishing-reduced.png) |
| 窄屏提醒与模型通知共存 | [context-with-model-notice-narrow.png](screenshots/context-with-model-notice-narrow.png) |

截图禁用动画以捕捉稳定帧；动画启停另由 computed style 及可控时间回归验证。

## 复现与限制

启动 `npm run dev -- --port 1423 --strictPort`，打开 `/tests/preview.html?fixture=voyage-high&theme=light`。新增 fixture：`voyage-output`、`voyage-thinking`、`voyage-fishing`、`voyage-tool`、`voyage-moored`、`voyage-high`。输出和等待场景需发送一条消息；发送后 fishing/tool 会保持等待，可用停止按钮结束。

浏览器脚本需要外部可用的 Playwright，不添加到本项目依赖。本次 PowerShell 使用：

```powershell
$env:NODE_PATH = 'C:\Users\49772\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
node tests/voyage.browser.mjs http://localhost:1423
```

默认浏览器 channel 为 `msedge`，可用 `SKIFF_BROWSER_CHANNEL` 指定已有浏览器。原生 Tauri WebView、真实 pi/提供商输出节奏及屏幕阅读器实际播报未验证；浏览器检查不代替这些平台验证。未改 Rust，因此未运行 native 构建及测试。
