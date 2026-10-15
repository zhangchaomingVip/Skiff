# 018 · 对话交互完整性：插话、停止、截断与扩展对话框

状态：已实施并通过下述自动检查；桌面端验收边界见 `verification.md`。创建及修订日期：2026-10-15。依赖 `017-parallel-sessions` 的按会话运行池，复用先行实施的 019 草稿与后台状态接口、020 折叠原语。
来源：产品与设计评审及源码核对；协议边界按本机 `@earendil-works/pi-coding-agent` 1.2.0 的 `docs/rpc-commands.md`、`docs/rpc-extension-ui.md` 与 `dist/modes/rpc/rpc-mode.js` 复核。下述源码行号仅供定位，实施以实际调用和样式级联为准。

## 背景与目标

Skiff 的单轮链路（提问 → 流式 → 工具航迹 → 用量）已经完整，但一轮开始之后，用户对这次运行的控制力几乎为零：

- 运行中不能追加指令。`src/components/Composer.tsx:118` 在 `streaming` 时直接 `return`，`src/chat/usePiSession.ts:350` 同样 `return false`，发出的 `prompt` 请求从不带 `streamingBehavior`。pi 原生支持 `steer`（当前 assistant 轮的工具调用结束后、下一次 LLM 请求前插入）与 `follow_up`（当前运行没有更多待处理工作后送达），应用源码尚未接入这些通道。
- 停止动作与清空草稿共用 Esc。`Composer.tsx:131` 在 streaming 时把 Escape 绑到 `onAbort()`，而 `Composer.tsx:178` 的提示文字写的是「Ctrl K 聚焦 · Esc 清空 / 停止」。用户按清空草稿的肌肉记忆会杀掉正在跑的长任务，且没有停止回执。
- 被截断的回答看起来像正常完成。`src/chat/types.ts:76` 与 `src/chat/reducer.ts:93,192` 已经保存 `stopReason`，但没有任何组件消费它；`src/chat/reducer.ts:319` 把 `length` 与 `stop` 一样归为 `completed`。同时 `src/components/ReasoningChip.tsx:26` 提示用户「调高可减少手动『继续』」，而 Skiff 根本没有「继续」入口。
- 编辑重发是死代码。`src/components/ChatView.tsx:43` 的 `setEditing` 只在 `:53`、`:55` 被清为 `undefined`，从未被赋成某条消息；`src/chat/usePiSession.ts:315` 的 `rewind` 与 `ChatView.tsx:55` 的 rewind-后-发送路径因此永不触发。`src/components/MessageItem.tsx:74` 的 `showActions = readOnly || isUser || isLast` 使历史助手消息连复制都没有。
- pi 扩展对话框不回包。`src/chat/reducer.ts:219` 的 `extension_ui_request` 分支只处理 `method === "notify"`，全仓无 `extension_ui_response`。自带扩展只用 `notify`，但第三方扩展的 `select`/`confirm`/`input`/`editor` 请求目前无法交互。带 `timeout` 时 pi 自动返回默认值：`confirm` 为 `false`，`select`/`input` 为 `undefined`；不能一概写成 `undefined`。

本 feature 的目标是把「一轮运行期间和之后的控制权」交还给用户：能插话、能明确停止、看得出被截断、能改问重发、扩展能问到人。

## 行为约定

### 协议与生命周期边界

- 实施前先用本地回环模型服务验证 1.2.0 的队列、`prompt` disposition、`agent_end`/`agent_settled` 与扩展对话框，禁止只用模拟桥证明协议存在。验证不产生付费模型调用。
- `agent_end` 不等于整个会话已空闲；队列续跑、重试或压缩可能仍在进行。支持 `agent_settled` 的版本以它为运行生命周期的最终收束点，老版本采用经验证的 `get_state` 回退，不能提前解锁编辑重发、生成错误的停止回执或重置整轮统计。
- 队列只使用现有 `steer`、`follow_up`、`clear_queue` 与 `queue_update`。1.2.0 未暴露逐条撤回 RPC，第一版只提供「撤回全部」；禁止通过清空后重投剩余条目伪造逐条撤回。
- 不兼容版本拒绝命令或缺失能力时显示明确说明并保留未接收输入，不伪造队列成功。`get_commands` 返回的 `source` 信息需保留，用于区分 extension、prompt 与 skill。

### 插话与队列

- 运行中输入框保持可编辑、可提交。提交动作默认使用 `steer`，即当前 assistant 轮的工具调用执行完毕后、下一次 LLM 请求前送达。
- 提供显式的投递时机选择，默认「插话」，可切「等本轮做完」（`follow_up`）。两种时机在 UI 上必须用文字说明差异，不能只靠图标。
- 待发送队列以 pi 的 `queue_update` 事件为唯一数据源，其 `steering` 与 `followUp` 字段是**完整队列快照**，不是增量。UI 用整份快照替换本地列表，禁止本地累加导致幽灵条目。
- 沿用 pi 配置的投递模式，从 `get_state` 读取实际 `steeringMode`/`followUpMode`；未配置时通常为 `one-at-a-time`，不得假设用户设置一定是默认值。本 feature 不改写模式。
- `steer` 与 `follow_up` 不接受扩展命令（`/xxx`），但会展开 skill 命令与提示模板。输入以 `/` 开头且当前在运行时，需要区分处理：普通提示模板照常插话，扩展命令改走 `prompt`。
- 「撤回全部」调用 `clear_queue`，同时撤回 steering 与 follow-up；UI 队列仍由 `queue_update` 完整快照替换。回包中的 `steering`/`followUp` 文本作为本次实际撤回的结果展示，允许复制或明确装回草稿，不自动覆盖用户正在输入的内容。1.2.0 此回包不含图片原始数据，不得承诺完整恢复附件。
- 队列非空时，在输入框上方显示条数与「将在本轮工具调用结束后插入」一类具体文案。
- 排队输入在 `queued` 后从编辑器移除，`handled` 时按已被扩展处理展示，不插入虚假的 user 消息；真正的聊天消息以 pi 消息事件为准。发送失败保留文本与附件，快速连续提交不得受单轮 `busyRef` 锁误拦截，也不得重置正在运行的计时。
- streaming 时保留独立的提交入口（Enter 及「插话 / 排队发送」按钮），原发送位置的停止按钮继续可达，避免输入框解锁却没有可点击的发送动作。

### 停止

- 输入框内 Escape 只做「清空输入 / 取消编辑」，不再触发停止；对话框和菜单中的 Escape 沿用关闭/取消语义。停止使用 Ctrl+Shift+Backspace，并将快捷键写入提示行；不在输入法组合输入期间触发。
- 停止必须先锁定当前会话的新提交，依次执行 `clear_queue` → 取消该会话已知的 pending 扩展对话框 → `abort`，确认该 owner 的运行已收束后再解锁。pi 1.2.0 的 `abort` 会继续处理尚在队列中的消息，因此不能只复用现有单次 `abort` 调用。
- 清队列失败时仍尝试中止，并明确显示「未能确认队列已清空」，不得报告完整停止成功。撤回文本按上述队列规则保留，继续动作不自动重投它们。
- 成功停止后本轮末尾显示「已手动停止」与「继续」。尚未产生助手消息时也有可见回执；重复点击停止幂等，已自然完成的轮次不改标为手动停止。
- 停止只作用于当前会话，不得影响 017 引入的后台运行池。

### 截断与继续

- `stopReason === "length"` 时，本轮头部与收起态都必须显示「输出已达长度上限」，并提供「继续」按钮；点击后向 pi 发送继续提示，且该提示本身走插话/追加语义。
- `stopReason === "error"`、`"aborted"` 各自有独立标记，不与 `length` 混用同一种视觉。
- `length` 采用该轮最终助手结果，不因中间工具调用结束或随后 `agent_end` 抹掉。继续是在原分支追加普通继续提示：空闲时走 `prompt`，仍忙时走 steer/follow-up；不执行 rewind，不承诺恢复已经被截掉而未生成的文字。重复点击期间禁用动作，失败可重试。
- `reducer.ts:319` 的 voyage `run_end` 状态需要能表达「被长度截断的完成」，不得再压成 `completed`。
- 删除 `ReasoningChip.tsx:26` 中指向不存在功能的「手动『继续』」文案，改为不承诺未实现能力的说明。

### 编辑重发与复制

- 用户消息 hover/键盘聚焦提供「编辑并重发」，点击后把该消息装回输入框并显示现有 `editing-banner`，发送时走 `ChatView.tsx:55` 已有的 `rewind` + 替换路径。
- 最后一条助手消息提供「重新生成」。
- 编辑重发与重新生成只在当前会话真正空闲、无待发送队列时可用。重新生成定位该回复对应的 user 轮次，复用其文本和附件；先 fork 到该轮之前再发送，原 pi 文件由现有 fork 语义保留。
- 复用 019 草稿存储：编辑草稿保存消息定位信息和分支版本，取消编辑恢复进入编辑前的普通草稿。切回时仅在分支未变且目标仍存在时恢复编辑；否则降级为普通草稿并说明原因，禁止对同序号的另一条消息 rewind。
- 所有助手消息（不只 `isLast`）都提供复制；`MessageItem.tsx:74` 的 `showActions` 条件放宽，靠样式做 hover 门控而不是靠不渲染，避免键盘用户拿不到焦点。

### 状态术语

- 运行状态区统一使用「运行中 / 等待响应 / 空闲」，明确手动中止显示「已停止」；轮次结果再分别标注「已完成 / 输出已达长度上限 / 已手动停止 / 运行失败」。不得把所有自然完成都叫「已停止」，也不得继续混用「已停泊」。019 后台角标复用同一状态推导，确认和错误保持其优先级。
- 收起状态条与航行台头部只保留一处状态来源；空闲时收起状态条不再重复显示速度读数。

### 扩展对话框

- `reducer.ts` 为 `select`/`confirm`/`input`/`editor` 建立按 owner/generation 隔离的 pending 队列，按到达顺序逐个显示当前会话对话框；保留 `title`/`message`/`options`/`placeholder`，editor 使用 `prefill` 初始化多行正文。
- 回包必须原样携带 **pi 发来的 `id`**，不是 `RpcClient` 自己生成的 `req_N`。`src/rpc/RpcClient.ts:81` 的 `request()` 只会按自身生成的 id 关联响应，因此需要新增一个不等待响应的裸发送口（例如 `sendCommand`/`notify`）。
- pi 负责超时默认处理，客户端负责显示期限：到达时记录 `receivedAt` 和 `expiresAt = receivedAt + timeout`，用独立于组件挂载的 runtime 定时器淘汰已过期请求。后台会话、排在后面的对话框、窗口失焦期间都计算在内，重新显示和提交前再次检查期限。
- 1.2.0 超时或扩展自身 AbortSignal 取消时不发关闭通知，且没有服务端截止时间/待处理查询接口。客户端期限只能近似服务端期限；到期关闭并显示「等待已超时，pi 将按默认值处理」，不声称收到默认处理回执。无 timeout 的外部信号取消无法精确感知，此协议限制必须记入 verification，不伪造关闭事件。
- 取消回 `cancelled: true`；确认回 `confirmed`，其他三类回 `value`。每个 id 至多一个并行回包，成功写入后移出 pending 且不再发送；只有明确未写入的失败可在有效期内重试，结果不明时不自动重发。裸发送成功仅证明本地写入，不代表 pi 提供处理回执。过期请求不补发取消；切会话或暂时隐藏视图不取消远端请求，明确关闭对话框则按取消处理，后台角标反映仍有效的 pending。
- 停止、重连、归档或卸载前处理仍有效的请求；可通信时显式取消，owner 被替换或进程退出时清理本地请求与定时器，不向新实例回旧 id。不得把一般 `agent_end` 视为所有扩展请求已解决。
- `setStatus`、`setWidget`、`setTitle` 等 fire-and-forget 方法本 feature 不实现，只保证不报错。

## 执行任务

### 1. 插话通道

- [x] 在 `src/chat/usePiSession.ts` 增加 `steer` 与 `followUp` 发送，复用现有 owner/generation 与 `ownsRpc` 校验；处理 `data.disposition` 的 `queued`/`handled` 两种结果。
- [x] 在 `src/chat/reducer.ts` 接入 `queue_update`，按完整快照保存 `steering`、`followUp` 队列，增加 `clear_queue` 撤回全部路径。
- [x] 改造 `src/components/Composer.tsx`：移除 `:118` 的 streaming 静默 return，增加投递时机切换与队列条提示；`/` 开头的输入按扩展命令与普通命令分流。
- [x] 新增队列条组件，支持撤回全部、撤回文本恢复、键盘操作与不支持版本提示。
- [x] 区分普通 prompt 的 `started`/`queued`/`handled`，复核 `agent_end` 与 `agent_settled` 的续跑边界。

验收：运行中提交能插话并在 `queue_update` 后与 pi 状态一致；快速连续插话不产生重复条目；撤回后 pi 侧确实不再送达；切换会话不串队列。

### 2. 停止语义

- [x] 解除 Escape 与 `onAbort` 的绑定，更新 `Composer.tsx:178` 提示行并新增停止快捷键。
- [x] 实现清队列、取消 pending 对话框、中止和收束确认的顺序，覆盖失败及无助手消息的停止回执。
- [x] 停止后写入本轮标记并显示「继续」动作，保留撤回文本且不自动重投。

验收：输入框有文字时按 Esc 只清文字；带 steering/follow-up 队列时停止后不再因原队列自动续跑；停止有可见回执；失败不误报；后台会话不受影响。

### 3. 截断与继续

- [x] 让 `stopReason` 从 `reducer.ts` 贯通到 `TurnSummary.tsx`/`MessageItem.tsx`，区分 `length`、`aborted`、`error`。
- [x] 修正 `reducer.ts:319` 的 voyage 状态映射并更新相关断言。
- [x] 实现「继续」发送路径；清理 `ReasoningChip.tsx:26` 文案。

验收：人为把 max output 压到极小制造截断时，界面显示截断标记且「继续」能续上；正常结束不显示任何截断痕迹。

### 4. 编辑重发与复制

- [x] 接通 `ChatView.tsx:43` 的 `editing`，用户消息提供「编辑并重发」，复用 `usePiSession.ts:315` 的 `rewind`。
- [x] 最后一条助手消息提供「重新生成」，复用对应 user 提示与附件，校验分支和空闲边界。
- [x] 接入 019 编辑草稿恢复/降级约定，取消编辑恢复原普通草稿。
- [x] 放宽 `MessageItem.tsx:74` 的 `showActions`，复制对历史助手消息可用。

验收：编辑重发只替换本轮及之后；取消编辑不改动历史；三天前的回答可复制；键盘 Tab 能到达复制。

### 5. 状态术语统一

- [x] 收敛 `sailing.ts` 与 `VoyageRail.tsx` 的状态词表，消除「已停泊 / 已停止」并存。
- [x] 空闲时收起状态条不再显示速度读数。

验收：同一状态在收起条、航行台头部、消息标记三处用词完全一致。

### 6. 扩展对话框回包

- [x] 在 `src/rpc/RpcClient.ts` 增加不等待响应的裸发送口。
- [x] 在 `src/chat/reducer.ts` 建立 pending dialog 队列，在 `src/components/` 用现有 Dialog 原语渲染四类方法。
- [x] 在 runtime 维护请求期限，覆盖后台排队过期、迟到点击、重复回包、取消、重连和进程退出；接入 019 的 `needsConfirmation` 状态。
- [x] 更新 `tests/` 的模拟 pi 桥，使其能发出 `extension_ui_request` 并断言回包 `id` 与字段。

验收：四类扩展请求能交互并继续；超时请求关闭且不能再提交，confirm 默认 false 的服务端行为由本地真实 pi 测试验证；回包 id 与请求一致，切会话后后台待确认可见。

## 验收矩阵

| 场景 | 必须验证 |
| --- | --- |
| 运行中插话 | steer 在当前轮工具调用后送达；`queue_update` 快照与 UI 一致 |
| 插话与 follow-up 混用 | 两种时机各自送达顺序正确，不互相吞掉 |
| 队列撤回 | 撤回全部后本地快照与 pi 一致，撤回文本可恢复且不覆盖草稿，不伪造逐条撤回 |
| `/` 输入分流 | 扩展命令不被 `steer` 拒绝；模板与 skill 正常展开 |
| 停止 | Esc 不再杀任务；清队列后中止，无自动续跑；失败不误报；只影响当前会话 |
| 截断 | `length` 与 `stop`、`aborted`、`error` 视觉与文案可区分 |
| 编辑重发 | rewind/重新生成边界正确，附件保留，取消恢复原草稿，分支变化时降级 |
| 复制 | 历史助手消息与键盘可达性 |
| 扩展对话框 | 四类方法及 prefill、默认值、后台过期、迟到点击、至多一次回包、id/owner 隔离 |
| 生命周期 | queued/handled/started、agent_end 后续跑、agent_settled 最终收束、不支持版本说明 |
| 多会话并行 | 上述行为在 017 运行池下互不串扰 |

## 非目标

- 不做视觉系统收敛、仪表盘重排与字阶统一，归 `020-voyage-visual-convergence`。
- 不做会话标题、正文搜索与侧栏结构改造，归 `019-session-retrievability`。
- 不修改 Rust 桥接协议、Tauri 权限与 pi 侧实现；只使用 pi 已有 RPC 命令。
- 不实现 `setStatus`/`setWidget`/`custom()` 等扩展 UI 全集。
- 不实现逐条撤回，不修改 pi 来增加队列 API 或扩展关闭通知；本版超时显示保留上述协议限制。
- 不引入新依赖。

## 验证要求

- 运行 `npm test`、`npm run build`、`npm run check:ui`、`npm run test:styles`。
- 在独立 Vite 端口用 `tests/preview.html` 模拟 pi 桥验证插话、队列快照替换、撤回、截断标记、编辑重发与扩展对话框回包；无回包路径必须被测试断言捕获。
- 扩展 `tests/pi.integration.mjs` 或新增独立本地脚本，使用真实 pi、临时扩展、隔离配置与回环模型服务验证混合队列、clear_queue → abort、截断和四类对话框；不调用真实付费 API。若环境不可用，记录阻塞项，不把模拟结果记作真实协议通过。
- 新增或改写的 reducer 逻辑保持框架无关可单测（`src/chat/reducer.ts` 现有约定），队列与 stopReason 用数值/结构断言，不依赖截图。
- 实施完成后在本目录新增 `verification.md`，分别记录模拟结果、真实 pi 结果与未覆盖的 Tauri/WebView2 行为。
