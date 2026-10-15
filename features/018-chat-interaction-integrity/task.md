# 018 · 对话交互完整性：插话、停止、截断与扩展对话框

状态：待实施。创建日期：2026-10-15。依赖 `017-parallel-sessions` 的按会话运行池。
来源：产品与设计双 agent 并行评审后逐条源码复核；本文只收录已核实为真的论断。

## 背景与目标

Skiff 的单轮链路（提问 → 流式 → 工具航迹 → 用量）已经完整，但一轮开始之后，用户对这次运行的控制力几乎为零：

- 运行中不能追加指令。`src/components/Composer.tsx:118` 在 `streaming` 时直接 `return`，`src/chat/usePiSession.ts:350` 同样 `return false`，`usePiSession.ts:362` 发出的 `prompt` 请求从不带 `streamingBehavior`。pi 原生支持 `steer`（当前 assistant 轮的工具调用结束后、下一次 LLM 请求前插入）与 `follow_up`（本轮彻底结束后送达），全仓检索 `steer`、`follow_up` 命中数为 0。
- 停止动作与清空草稿共用 Esc。`Composer.tsx:131` 在 streaming 时把 Escape 绑到 `onAbort()`，而 `Composer.tsx:178` 的提示文字写的是「Ctrl K 聚焦 · Esc 清空 / 停止」。用户按清空草稿的肌肉记忆会杀掉正在跑的长任务，且没有停止回执。
- 被截断的回答看起来像正常完成。`src/chat/types.ts:76` 与 `src/chat/reducer.ts:93,192` 已经保存 `stopReason`，但没有任何组件消费它；`src/chat/reducer.ts:319` 把 `length` 与 `stop` 一样归为 `completed`。同时 `src/components/ReasoningChip.tsx:26` 提示用户「调高可减少手动『继续』」，而 Skiff 根本没有「继续」入口。
- 编辑重发是死代码。`src/components/ChatView.tsx:43` 的 `setEditing` 只在 `:53`、`:55` 被清为 `undefined`，从未被赋成某条消息；`src/chat/usePiSession.ts:315` 的 `rewind` 与 `ChatView.tsx:55` 的 rewind-后-发送路径因此永不触发。`src/components/MessageItem.tsx:74` 的 `showActions = readOnly || isUser || isLast` 使历史助手消息连复制都没有。
- pi 扩展对话框不回包。`src/chat/reducer.ts:219` 的 `extension_ui_request` 分支只处理 `method === "notify"`，全仓无 `extension_ui_response`。自带扩展（`src-tauri/src/pi_extensions/web_search.js`、`model_families.js`）确实只用 `notify`，因此当前不发作；但任何使用 `select`/`confirm`/`input`/`editor` 的第三方扩展都会让 agent 阻塞，带 `timeout` 的确认会在超时后被静默当作 `undefined` 吞掉。

本 feature 的目标是把「一轮运行期间和之后的控制权」交还给用户：能插话、能明确停止、看得出被截断、能改问重发、扩展能问到人。

## 行为约定

### 插话与队列

- 运行中输入框保持可编辑、可提交。提交动作默认使用 `steer`，即当前 assistant 轮的工具调用执行完毕后、下一次 LLM 请求前送达。
- 提供显式的投递时机选择，默认「插话」，可切「等本轮做完」（`follow_up`）。两种时机在 UI 上必须用文字说明差异，不能只靠图标。
- 待发送队列以 pi 的 `queue_update` 事件为唯一数据源，其 `steering` 与 `followUp` 字段是**完整队列快照**，不是增量。UI 用整份快照替换本地列表，禁止本地累加导致幽灵条目。
- 沿用 pi 默认 `one-at-a-time` 投递模式；本 feature 不调用 `set_steering_mode` / `set_follow_up_mode`，除非验证发现默认模式在 Skiff 场景下有明显问题。
- `steer` 与 `follow_up` 不接受扩展命令（`/xxx`），但会展开 skill 命令与提示模板。输入以 `/` 开头且当前在运行时，需要区分处理：普通提示模板照常插话，扩展命令改走 `prompt`。
- 队列条目可逐条撤回。撤回必须调用 pi 的队列接口，不能只从本地数组移除。
- 队列非空时，在输入框上方显示条数与「将在本轮工具调用结束后插入」一类具体文案。

### 停止

- Escape 永远只做「清空输入 / 取消编辑」，不再触发停止。停止保留发送按钮原位（streaming 时替换为停止键，`Composer.tsx:168-169` 现有行为）并增加一个显式快捷键，快捷键写进 `Composer.tsx:178` 的提示行。
- 停止后必须留痕：本轮末尾显示「已手动停止」标记，并给出「继续」动作。`usePiSession.ts:395` 已有 `abort` 调用，复用即可。
- 停止只作用于当前会话，不得影响 017 引入的后台运行池。

### 截断与继续

- `stopReason === "length"` 时，本轮头部与收起态都必须显示「输出已达长度上限」，并提供「继续」按钮；点击后向 pi 发送继续提示，且该提示本身走插话/追加语义。
- `stopReason === "error"`、`"aborted"` 各自有独立标记，不与 `length` 混用同一种视觉。
- `reducer.ts:319` 的 voyage `run_end` 状态需要能表达「被长度截断的完成」，不得再压成 `completed`。
- 删除 `ReasoningChip.tsx:26` 中指向不存在功能的「手动『继续』」文案，改为不承诺未实现能力的说明。

### 编辑重发与复制

- 用户消息 hover/键盘聚焦提供「编辑并重发」，点击后把该消息装回输入框并显示现有 `editing-banner`，发送时走 `ChatView.tsx:55` 已有的 `rewind` + 替换路径。
- 最后一条助手消息提供「重新生成」。
- 所有助手消息（不只 `isLast`）都提供复制；`MessageItem.tsx:74` 的 `showActions` 条件放宽，靠样式做 hover 门控而不是靠不渲染，避免键盘用户拿不到焦点。

### 状态术语

- 全应用统一「运行中 / 等待响应 / 已停止」。`src/chat/sailing.ts:48` 的「已停泊」与 `src/components/VoyageRail.tsx:19` 的「已停止」不得同屏出现。
- 收起状态条与航行台头部只保留一处状态来源；空闲时收起状态条不再重复显示速度读数。

### 扩展对话框

- `reducer.ts` 为 `select`/`confirm`/`input`/`editor` 建立 pending 队列，按到达顺序逐个渲染为对话框，标题与正文使用扩展提供的 `title`/`message`/`options`/`placeholder`。
- 回包必须原样携带 **pi 发来的 `id`**，不是 `RpcClient` 自己生成的 `req_N`。`src/rpc/RpcClient.ts:81` 的 `request()` 只会按自身生成的 id 关联响应，因此需要新增一个不等待响应的裸发送口（例如 `sendCommand`/`notify`）。
- 客户端不需要自己计时：pi 侧带 `timeout` 的对话框会自动以默认值解决。UI 只需在超时前显示剩余时间，并允许用户明确取消（回 `cancelled: true`）。
- 超时自动解决后，若用户对话框仍打开，必须关闭并说明「已按默认处理」，不能留下可点击的陈旧入口。
- `setStatus`、`setWidget`、`setTitle` 等 fire-and-forget 方法本 feature 不实现，只保证不报错。

## 执行任务

### 1. 插话通道

- [ ] 在 `src/chat/usePiSession.ts` 增加 `steer` 与 `followUp` 发送，复用现有 owner/generation 与 `ownsRpc` 校验；处理 `data.disposition` 的 `queued`/`handled` 两种结果。
- [ ] 在 `src/chat/reducer.ts` 接入 `queue_update`，按完整快照保存 `steering`、`followUp` 队列并暴露撤回。
- [ ] 改造 `src/components/Composer.tsx`：移除 `:118` 的 streaming 静默 return，增加投递时机切换与队列条提示；`/` 开头的输入按扩展命令与普通命令分流。
- [ ] 新增队列条组件，支持逐条撤回与键盘操作。

验收：运行中提交能插话并在 `queue_update` 后与 pi 状态一致；快速连续插话不产生重复条目；撤回后 pi 侧确实不再送达；切换会话不串队列。

### 2. 停止语义

- [ ] 解除 Escape 与 `onAbort` 的绑定，更新 `Composer.tsx:178` 提示行并新增停止快捷键。
- [ ] 停止后写入本轮标记并显示「继续」动作。

验收：输入框有文字时按 Esc 只清文字；停止有可见回执；后台会话不受影响。

### 3. 截断与继续

- [ ] 让 `stopReason` 从 `reducer.ts` 贯通到 `TurnSummary.tsx`/`MessageItem.tsx`，区分 `length`、`aborted`、`error`。
- [ ] 修正 `reducer.ts:319` 的 voyage 状态映射并更新相关断言。
- [ ] 实现「继续」发送路径；清理 `ReasoningChip.tsx:26` 文案。

验收：人为把 max output 压到极小制造截断时，界面显示截断标记且「继续」能续上；正常结束不显示任何截断痕迹。

### 4. 编辑重发与复制

- [ ] 接通 `ChatView.tsx:43` 的 `editing`，用户消息提供「编辑并重发」，复用 `usePiSession.ts:315` 的 `rewind`。
- [ ] 助手消息提供「重新生成」。
- [ ] 放宽 `MessageItem.tsx:74` 的 `showActions`，复制对历史助手消息可用。

验收：编辑重发只替换本轮及之后；取消编辑不改动历史；三天前的回答可复制；键盘 Tab 能到达复制。

### 5. 状态术语统一

- [ ] 收敛 `sailing.ts` 与 `VoyageRail.tsx` 的状态词表，消除「已停泊 / 已停止」并存。
- [ ] 空闲时收起状态条不再显示速度读数。

验收：同一状态在收起条、航行台头部、消息标记三处用词完全一致。

### 6. 扩展对话框回包

- [ ] 在 `src/rpc/RpcClient.ts` 增加不等待响应的裸发送口。
- [ ] 在 `src/chat/reducer.ts` 建立 pending dialog 队列，在 `src/components/` 用现有 Dialog 原语渲染四类方法。
- [ ] 覆盖取消、超时后关闭、会话切换与运行池隔离。
- [ ] 更新 `tests/` 的模拟 pi 桥，使其能发出 `extension_ui_request` 并断言回包 `id` 与字段。

验收：模拟一个带 `select` 的扩展，Skiff 弹窗、选择后 agent 继续；不选时超时按默认解决并给出说明；回包 `id` 与请求 `id` 一致。

## 验收矩阵

| 场景 | 必须验证 |
| --- | --- |
| 运行中插话 | steer 在当前轮工具调用后送达；`queue_update` 快照与 UI 一致 |
| 插话与 follow-up 混用 | 两种时机各自送达顺序正确，不互相吞掉 |
| 队列撤回 | 本地与 pi 侧同时消失，无残留 |
| `/` 输入分流 | 扩展命令不被 `steer` 拒绝；模板与 skill 正常展开 |
| 停止 | Esc 不再杀任务；停止有标记与「继续」；只影响当前会话 |
| 截断 | `length` 与 `stop`、`aborted`、`error` 视觉与文案可区分 |
| 编辑重发 | rewind 边界正确，取消编辑无副作用 |
| 复制 | 历史助手消息与键盘可达性 |
| 扩展对话框 | 四类方法、取消、超时、跨会话隔离、回包 id |
| 多会话并行 | 上述行为在 017 运行池下互不串扰 |

## 非目标

- 不做视觉系统收敛、仪表盘重排与字阶统一，归 `020-voyage-visual-convergence`。
- 不做会话标题、正文搜索与侧栏结构改造，归 `019-session-retrievability`。
- 不修改 Rust 桥接协议、Tauri 权限与 pi 侧实现；只使用 pi 已有 RPC 命令。
- 不实现 `setStatus`/`setWidget`/`custom()` 等扩展 UI 全集。
- 不引入新依赖。

## 验证要求

- 运行 `npm test`、`npm run build`、`npm run check:ui`、`npm run test:styles`。
- 在独立 Vite 端口用 `tests/preview.html` 模拟 pi 桥验证插话、队列快照替换、撤回、截断标记、编辑重发与扩展对话框回包；无回包路径必须被测试断言捕获。
- 若本机可用，用 `node tests/pi.integration.mjs <pi-cli.js>` 做本地 real-pi 插话与截断验证，避免真实付费调用。
- 新增或改写的 reducer 逻辑保持框架无关可单测（`src/chat/reducer.ts` 现有约定），队列与 stopReason 用数值/结构断言，不依赖截图。
- 实施完成后在本目录新增 `verification.md`，分别记录模拟结果、真实 pi 结果与未覆盖的 Tauri/WebView2 行为。
