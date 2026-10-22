# 第五轮：总用时与内层思考摘要

2026-10-22。正常顶部仅显示真实总用时；ChatView 的 activeRun.startedAt 经 MessageList/MessageItem 传给过程头，首次等待共用 useTurnElapsed。只为有真实起点的活动轮启动 1000ms interval，缺起点显示“用时统计中”，完成使用既有实测/约值，未知为“用时未记录”。错误/缺失结果提示保留。时钟状态局限于显示组件，不改消息数组或自动滚动依赖。

当前末尾思考的摘要仅在外层展开、无 pending 工具且 activeKind=thinking 时显示最新有效片段；其他/完成思考为“思考”。同一块追加继续 400ms 节流，跨 messageId:key 的新思考立即初始化，避免把上一块摘要借给新条目；嵌套摘要具有单行 ellipsis，稳定可访问标签和内层展开不变。删除 typing/streaming Markdown 的伪光标及 caret-blink，未改 textarea 真光标或编辑。

## 验证

- `npm run build`、`npm test`（276/276）、`npm run test:styles`（139 tokens / 0 errors / 126 contrast pairs / 0 failures）、`npm run check:ui`、`git diff --check` 通过。
- `process-lifecycle.browser.mjs` 双主题通过：等待1→2秒、思考/工具/正文连续用时、顶部不泄露内容、内层400ms追加更新、新思考 identity 立即切换且旧条目简化、内外层展开/焦点、完成简化、历史45秒与当前3→5秒隔离、缺真实起点、多个 Markdown/typing 的 after 不生成光标。旧失败、并行结果、缺失、旁白/最终正文/用户附件搜索和窄屏覆盖保留；工具执行计数断言移到具体工具行，纯逻辑计数测试保留。
- `chat-layout.browser.mjs`、`chat-reading.browser.mjs` 双主题通过，`turn-usage.browser.mjs` 通过。
- 独立 Edge 双主题复核：等待10→11秒，切思考不归零；摘要仅在内层当前思考，同块追加更新且展开保持；工具时回“思考”，旧条目不显示新片段；真实 streaming Markdown 的 after 均为 none，360px ellipsis/无溢出；完成15秒，3秒后读数不动。独立计时器拦截验证等待恰好1个、完成0、缺起点0、再次开始1、卸载0。
- 真实 session mock 的 `timing.html` 已适配旧摘要/模型身份断言，并通过等待2秒→空助手3秒→正文4秒及完成4300ms，证明 ChatView 时间传递。完整旧 harness 在后续 pre-start abort 场景仍失败：pending=true、streaming=true、既有100ms航行台interval和新1000ms显示interval各1；本轮仅改显示，没有修改 runtime abort。后续完整 timing 场景因此未执行，不能声称全套 timing 通过。其后的显示计时器切换/卸载由上述独立 focused mock 验证。

截图在 `screenshots-round5/`，独立截图 `review-live-{light,dark}.png`；旧轮次截图保留。所有检查使用 localhost:1421 mock，无真实模型/示例工具执行；families.rs 保留原有改动，生成 style-audit 已恢复。

---

# 第四轮：每段思考独立折叠

主代理独立双主题复核通过：默认折叠、Enter/Space、流式及完成保留状态、外层收放保留状态、无重复标题。截图：[浅色](./screenshots-round4/review-thinking-folded-light.png) / [深色](./screenshots-round4/review-thinking-folded-dark.png)。

2026-10-22。TurnProcessGroup 的每段思考使用现有 ProcessDisclosure，默认折叠，摘要仅“思考”与小图标/箭头；展开后无重复标题且全文保留。ThinkingContent 的可选 showLabel 默认开启，其他调用不变。保留稳定 entry key，不修改聚合、旁白、工具或顶部动态摘要。

`npm run build`、`npm run check:ui` 通过；`process-lifecycle.browser.mjs` 双主题通过，扩展覆盖外层展开时思考仍收起、Enter/Space 开关、全文保留、流式和 settle 后内层展开保持、第二段独立默认折叠、外层收放不重置内层。原有顺序、搜索、失败/缺失、复制/用量等覆盖保留。其余浏览器没有依赖思考全文默认可见的断言，无需适配。截图在 `screenshots-round4/`，旧轮次截图保留为历史记录。仅使用 mock；未修改 families.rs 或配置，也未执行示例工具。

---

# 第三轮：旁白归入过程验证

2026-10-22。此节对应最新实现，覆盖下方第二轮“中间正文外置”的证据；历史记录和截图保留。

- 聚合层按同一用户轮的最后工具调用划分旁白/答复，不使用文字启发式，不跨用户轮，不受 usage-only 尾部影响。原消息、工具结果匹配、复制全文和用量不变。
- 过程展开按原顺序显示思考、Markdown 旁白、工具；思考标签明确为“思考”。最终答复仅在过程外出现一次。无工具多段/多消息正文仍全部外置。
- 流式工具出现前正文可读，出现后迁入过程；相同 head id 保持展开和键盘焦点。停止且无最终答复不补造内容，旁白仍可展开，失败/缺失状态仍可见。
- 历史搜索按 query 选择原消息内匹配 text 块，旁白定位到过程内实际 Markdown，混合消息的最终答复定位到外部实际正文；辅助搜索源保留。

## 检查与截图

`npm run build`、`npm test`（276/276）、`npm run test:styles`（139 tokens / 0 errors / 126 contrast pairs / 0 failures）、`npm run check:ui` 均通过。`process-lifecycle.browser.mjs`、`chat-layout.browser.mjs`、`chat-reading.browser.mjs` 双主题通过；`turn-usage.browser.mjs` 通过。

新增回归覆盖思考→多段旁白→工具→思考→旁白→工具→最终答复、跨消息、用户轮边界、无工具多正文、usage-only 尾部、工具证据到达才迁移、展开/焦点保持、停止无答复及缺失结果、旁白搜索、同消息最终正文搜索，以及长回复后搜索用户文本附件能滚回实际附件块。保留旧有并行/乱序结果、失败、持续思考预览、键盘、窄屏、CSS zoom、复制及用量检查。用量测试仅将原精确新增输入断言限定于详情浮层，避免与行内新增输入重复匹配。

本轮截图位于 `screenshots-round3/`（另含独立复核的 `review-expanded-*`、`review-collapsed-*`），包括双主题 `narration-expanded-*`、`narration-collapsed-*`、`process-expanded-*`、`process-collapsed-*`、阅读矩阵和行内用量表格。已查看双主题旁白展开截图，思考/旁白/工具层级与答复边界可辨识。缓存继续使用用户最终选择的静态灰色双圆环靶子 A。

仍仅使用 localhost:1421 mock，无真实模型/工具；CSS zoom 不等同系统 DPI 或原生浏览器缩放。未修改 RPC/parser 协议或原有 families.rs。第一轮记录的无关 interactions harness 初始化限制仍适用。

---

# 030 第二轮修订验证

日期：2026-10-22。此节对应最终实现；下方保留第一轮验证，不将第一轮截图作为第二轮证据。所有浏览器场景均使用 localhost:1421 的 mock bridge，无真实模型调用或示例工具执行。

## 结果

- `npm test`：275/275 通过；`npm run build` 通过。
- `npm run test:styles`：139 tokens、0 style errors、126 contrast pairs、0 failures；`npm run check:ui` 通过。
- `process-lifecycle.browser.mjs`：双主题通过。验证单一默认折叠入口、最新思考片段节流、工具优先、正文顺序、实测/近似/未知耗时、跨完成展开和焦点保持、并行 2 次调用与乱序结果、未解决失败及 360px 缺失结果。混合思考/工具/正文消息的历史定位保持唯一正文锚点。
- `turn-usage.browser.mjs`：通过。行内入口后仍覆盖原有用量汇总、缓存边界、精确复制、历史快照、无记录、未知费用、弹层键盘和窄矮窗口边界。
- `chat-layout.browser.mjs`：双主题通过，覆盖开放布局、复制/详情、窄屏、正文顺序和 usage-only 尾部。
- `chat-reading.browser.mjs`：双主题 1440/1000/600/600×400，CSS zoom 100/150/200% 通过；新增行内用量 Enter/Space、缓存图标的可访问名称、360/600px 无溢出、短表格标识符不换行与长文字换行、详情键盘验证。
- `draft-recovery.browser.mjs`：通过；StrictMode、4 秒恢复提示、编辑/发送/清空、存储错误、目标切换和卸载回归保留。
- 独立复核：完整应用双主题底部间距 31.875 CSS px、输入框 760px、无页面横向溢出；自定义中间正文/思考/工具轮次保持单入口及正文顺序，360/600px 用量无溢出。同一思考块追加内容更新预览，600px 行高稳定，工具动作优先，完成保持展开。

## 截图与边界

第二轮自动截图位于 `screenshots-round2/`，包括 `process-collapsed-{light,dark}.png`、`process-expanded-{light,dark}.png`、`inline-usage-table-{light,dark}.png` 和阅读矩阵。独立复核截图位于 `screenshots/revision-review-{light,dark}.png` 与 `screenshots/revision-usage-{light,dark}.png`。用户最终改选 A：静态灰色双圆环靶子（◎，target），保留 title/aria-label；此前 refresh B 的截图与图标候选保留为历史评审材料。图标切换后，主代理已确认 build 通过，浅色/深色行内用量及 360/600px 无溢出复核通过；实际图标截图为 [浅色](./screenshots/target-cache-light.png) / [深色](./screenshots/target-cache-dark.png)。

CSS zoom 验证不等同于操作系统 DPI 或浏览器原生缩放；未运行真实 Tauri/pi。旧 `interactions.browser.mjs` 的 fixture.currentSession 初始化问题已在第一轮确认，第二轮未重跑或修改该无关 harness。未修改原有 families.rs、RPC、费用算法或工具执行逻辑。

---

## 第一轮验证（历史记录）

# 030 实施验证

日期：2026-10-22。环境：Windows、Node.js 24.19.0、Vite dev、headless Microsoft Edge 151.0.4129.101、mock Tauri/pi bridge。全部浏览器场景不调用真实模型或执行示例工具。

## 实施结果

- 聊天专用 `--chat-content-width: 760px` 对齐消息、等待态、输入框和提示；其他页面继续使用全局宽度。助手保留 article/轮次锚点，移除整轮可见卡片及顶部模型身份；表格在消息内部滚动。
- 过程分组 ID、工具结果匹配、正文顺序和展开状态保留。默认思考只显示入口；最多两类工具动作，更多类别退回调用总次数。读取/编辑均使用“次”，grep/find 保留实际类别。失败不因后续无关成功消失；缺失结果有独立可见状态，不能标为完成。
- 箭头常驻；无详情等待态不显示展开入口。Enter/Space 可操作，流式与完成不重置用户展开或焦点。正文与过程的邻接间距使用 8px，未压缩 Markdown 内部段落。
- 默认页脚只显示时间和详情入口；详情在左端，复制操作在其后且保留键盘/悬停可达性。用量、缓存、思考、估算说明、精确费用及模型复制保留在弹层内。没有 usage 显示消息详情及“用量未记录”，无历史来源保留未知；不借用当前模型。
- 草稿成功提示位于输入框内部固定状态位，实际兼容文字或附件恢复后只播报一次，4 秒消失；编辑、发送、清空提前关闭。恢复标记仅来自 IndexedDB hydrate，save/remove 清除旧标记；兼容 StrictMode，目标切换/卸载清理计时器。持续错误与成功提示分开。

## 自动检查

| 检查 | 结果 |
| --- | --- |
| `npm run build` | 通过 |
| `npm test` | 271/271 通过 |
| `npm run test:styles` | 通过：139 tokens、0 style errors、126 contrast pairs、0 contrast failures |
| `npm run check:ui` | 通过，包含新增草稿恢复 harness |
| `git diff --check` | 通过 |

只修改前端及测试，无需 Rust 检查或真实 pi 回归。用户原有 `src-tauri/src/families.rs` 改动未修改；主代理核对其 SHA256 与开始一致。检查写出的旧 feature 样式审计/截图已还原，不纳入交付。

## 浏览器回归

从仓库根目录启动 `npm run dev -- --port 1421`。本机既有服务绑定 localhost/IPv6，使用 `http://localhost:1421`；127.0.0.1 无法连接。Playwright 已存在于独立工具目录，不修改仓库依赖：

```powershell
$env:SKIFF_PLAYWRIGHT_DIR = "C:/Users/49772/.codex/tmp/skiff-028-browser/node_modules/playwright"
node tests/chat-layout.browser.mjs http://localhost:1421 features/030-chat-reading-experience/screenshots
node tests/process-lifecycle.browser.mjs http://localhost:1421 features/030-chat-reading-experience/screenshots
node tests/turn-usage.browser.mjs http://localhost:1421
node tests/draft-recovery.browser.mjs http://localhost:1421
node tests/chat-reading.browser.mjs http://localhost:1421 features/030-chat-reading-experience/screenshots
node tests/retrievability.browser.mjs http://localhost:1421 ../features/030-chat-reading-experience
```

以上全部通过：

- `chat-layout`：双主题、整轮开放容器、无身份行、右侧用户气泡、悬停及键盘复制、历史模型详情、360/520/1100px 无溢出、回到底部、等待态、多步骤正文顺序、usage-only 尾部不新增空行。
- `process-lifecycle`：双主题，真实 mock 流式状态、并行计数、段落冻结、正文顺序、缺失结果、展开/收起、用户展开和焦点跨流式及完成保持。
- `turn-usage`：整轮多消息汇总、缓存/新增输入边界、历史快照、无 usage/无来源、当前模型不能替代历史身份、未知费用、精确费用/模型复制、点击及键盘/Escape 回焦、360×240 极矮窗口的弹层滚动与边界。
- `draft-recovery`：StrictMode、首次真实文字/附件恢复、空记录/缺失附件/不兼容/读取失败不误报、精确 4 秒、聚焦不关闭、编辑/成功发送/清空、保存状态不重复、跨目标切换、卸载、save/remove 清除旧恢复标记、存储失败持续显示。使用受控浏览器时钟。
- `chat-reading`：双主题 1440×960、1000×750、600×750、600×400，CSS zoom 100%/150%/200%，长回复不产生整页横向溢出，回到底部按钮在 transcript 内。上翻阅读时等待态替换/首正文不抢到底部。
- `retrievability`：100 个聊天检索与命中定位、只读压缩前历史、草稿跨导航/重载、失败发送保留/接受发送清空、缺失附件与重新添加、后台授权、删除清理、真实 IndexedDB 配额回退和 tombstone。详细证据见 [browser-verification.json](./browser-verification.json)。

## 截图与独立审核

| 场景 | Light | Dark |
| --- | --- | --- |
| 实际 app 短回复 | [app-light](./screenshots/app-light.png) | [app-dark](./screenshots/app-dark.png) |
| 窄屏阅读及页脚 | [360px](./screenshots/conversation-light-360.png) | [360px](./screenshots/conversation-dark-360.png) |
| 多步骤完成 | [settled](./screenshots/settled-light.png) | [settled](./screenshots/settled-dark.png) |
| 长回复 | [long](./screenshots/long-light.png) | [long](./screenshots/long-dark.png) |
| 矮窗口 | [600×400](./screenshots/short-window-light.png) | [600×400](./screenshots/short-window-dark.png) |
| 主代理独立审核 app | [review-light](./screenshots/review-app-light.png) | [review-dark](./screenshots/review-app-dark.png) |

主代理另独立验证 1440px app 的 composer=760px、顶部身份行=0、无页面溢出；并在 1440/600/360px 检查缺失结果、超宽表格和无 usage 历史来源。360px 下“未收到结果”尾部仍可见，详情为记录中的 old-route · old-model，无 pageerror。证据：[review-narrow-detail](./screenshots/review-narrow-detail.png)。

交付后的最终独立审核已完成：审阅实现与回归断言，确认此前指出的旧草稿恢复标记残留、缺失结果状态的窄屏可见性及隐藏复制按钮造成的页脚缩进均已修正。页脚调整后重新运行独立布局与历史来源探测，通过；最终 `git diff --check` 通过。未发现本次改动尚未解决的阻断问题。

针对旧 interactions harness 无法初始化的限制，主代理另从实际页面执行基础编辑撤销检查：打开 `/tests/session-switch.html?messages=4&chats=3&expanded=1`，等待输入框启用，输入普通草稿，编辑历史提问并修改文字，按 Escape 后恢复原普通草稿，退出编辑状态且不误报草稿恢复。该检查通过，无 pageerror；不代表旧套件中的继续、队列等全部场景已验证。

## 边界与未验证内容

没有方案范围外的行为改动；RPC、pi 生命周期、路由、费用算法和持久化草稿格式未变。恢复事件标记仅保存在应用内存。

未运行原生 Tauri/WebView、系统 150%/200% 缩放、真实模型/工具请求；CSS zoom 仅验证浏览器字体与布局缩放，不能替代原生桌面缩放。未穷举全部内容 × 状态 × 尺寸 × 侧栏/Voyage 组合；现有 app 预览覆盖默认侧栏，独立窄屏与长回复覆盖响应式。浏览器过渡期旧身份/页脚/草稿字样断言已更新，新断言保留实际交互与汇总覆盖；要求的构建/单测/样式/UI 检查及以上六组浏览器回归均通过。

额外尝试旧 `tests/interactions.browser.mjs` 时，在第 26 行的初始 `ready()` 超时（20 秒），尚未进入复制/编辑/继续用例；无 pageerror。定位到该脚本依赖 `window.switchFixture.currentSession`，而 `session-switch.preview.tsx` 仅通过 `fixture.render(value)` 设置它，当前应用源码中没有该测试 render hook 的调用连接，因此无法达到 ready。未为本次展示改动扩大修复旧 harness；编辑撤销/继续的这套专用浏览器回归未完成，需要后续修复测试接线后再运行。相关纯状态单测已通过，复制/键盘由 chat-layout 覆盖。
