# 上下文占用误报：定位与修复方案

调查日期：2026-10-12。范围：定位、实际 usage 核验与修复设计；本次未修改产品实现。

## 结论

截图中的 `218.81k / 128k = 170.9%` 可以由本地历史会话和当前前端函数精确复现。分子是最后一轮所有请求的完整输入累计量，不是任意一次请求的上下文大小。

- 最后一轮有 **7 次模型请求**，完整输入累计 **218,805**，输出累计 **1,871**；两者相加 **220,676**，也与截图的 `Tokens: 220.68k` 一致。
- 最后一次请求完整输入为 **32,401**，对应 **25.31%**。
- pi 自身的上下文估算包含最近一次回复输出，为 **32,679**，对应 **25.53%**。
- 该会话更早的第三轮有 **19 次模型请求**，累计输入 **283,771**，最后一次输入 **28,029**。它不是截图中 218,805 的来源。
- 全会话 `usage.input` 累计 **37,523**、缓存读取累计 **527,872**，与反馈中的“输入 37.5K”吻合。

## 实际 usage 证据

来源为本机 pi 会话 `01a12e01-e2ac-709d-b989-56b490dd69de` 的 JSONL，模型 `kimi-for-coding`，协议 `openai-completions`。检查 parentId 后确认该文件的非头部条目构成单一线性分支，没有混入被放弃的分支；没有 compaction 条目。

读取的是 pi 持久化的逐请求 usage 原字段，**不是供应商 HTTP/SSE 原始响应**；会话文件没有保留原始响应。下表仅摘录统计字段，不包含聊天正文、工具参数或密钥。

| 最后一轮请求 | 消息 ID | input | cacheRead | cacheWrite | output | reasoning | totalTokens | 完整输入 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 9fd7186a | 554 | 29,440 | 0 | 237 | 45 | 30,231 | 29,994 |
| 2 | 31b83ae7 | 456 | 29,952 | 0 | 192 | 29 | 30,600 | 30,408 |
| 3 | d49e58d8 | 543 | 30,208 | 0 | 633 | 305 | 31,384 | 30,751 |
| 4 | 22fea2e8 | 718 | 30,720 | 0 | 193 | 50 | 31,631 | 31,438 |
| 5 | bed4612c | 523 | 31,232 | 0 | 184 | 41 | 31,939 | 31,755 |
| 6 | 12027a3c | 314 | 31,744 | 0 | 154 | 17 | 32,212 | 32,058 |
| 7 | f6630318 | 401 | 32,000 | 0 | 278 | 14 | 32,679 | 32,401 |
| 合计 | — | **3,509** | **215,296** | **0** | **1,871** | **501** | **220,676** | **218,805** |

前六条的 stopReason 为 toolUse，最后一条为 stop。请求次数应由 assistant 请求计数，不能直接以工具调用次数替代：一次模型请求可以发起多个工具调用。

## 字段语义

核验本机安装的 `@earendil-works/pi-coding-agent` 1.1.0 及其 pi-ai 适配器源码：

| 协议 | 供应商输入字段的口径 | pi 的归一化 |
| --- | --- | --- |
| OpenAI Chat Completions | prompt_tokens 包含缓存输入 | input = max(0, prompt_tokens - cacheRead - cacheWrite) |
| OpenAI Responses | input_tokens 包含缓存输入 | input = max(0, input_tokens - cacheRead - cacheWrite) |
| Anthropic Messages | input_tokens 与缓存读写字段分列 | input = input_tokens；缓存量分别来自 cache_read_input_tokens、cache_creation_input_tokens |

OpenAI 兼容适配器依次识别 `prompt_tokens_details.cached_tokens`、`prompt_cache_hit_tokens`、顶层 `cached_tokens`；缓存写入来自 `prompt_tokens_details.cache_write_tokens`。具体线路若不遵守这些协议语义，应在适配器修正，不能在 UI 里凭 provider 名称重复加减缓存。

Skiff 接收到的字段是 pi 的 `usage.input`，不是供应商原始 `input_tokens`。在已经归一化的数据上：

```text
requestInput = usage.input + usage.cacheRead + usage.cacheWrite
turnInputTotal = Σ requestInput
lastRequestInput = requestInput[lastValidRequest]
```

`reasoning` 是 `output` 的子集，不能再次加入上下文或总消耗。缓存命中仍然占用单次请求上下文，只影响计费和处理成本。

“输入 37.5K”准确说是累计未缓存输入，并非全会话去重后的新内容量：相同内容在缓存失效后也可能再次计入 input。因此它不是上下文大小的严格上界。本次结论由逐请求 usage 和代码复现直接证明。

## 根因与影响路径

1. `src/chat/parse.ts:115` 原样恢复每个 assistant 的 usage，历史文件没有把它们预先合并。
2. `src/chat/sailing.ts:163` 的 `advanceVoyageContext()` 按消息 ID 保存每次完整输入的最大值；第 172 行对所有请求求和，随后将累计值用于 context。
3. 同函数第 176 行再保留整个航行的历史最大值。这样，即使后续出现更小的真实读数，旧读数也不能回落。
4. `src/chat/useVoyageMetrics.ts:90` 使用上述结果计算 ratio，第 111 行送入 `contextReminder()`，第 121 行又用同一 input 覆盖本轮输入统计。
5. `src/chat/sailing.ts:129` 的提醒函数对传入分子按阈值工作；错误主要来自分子来源，而非百分比或提醒阈值。
6. `tests/voyageContext.test.ts` 明确断言跨请求求和等于 context。`features/014-voyage-panel-polish/task.md` 与 verification.md 也记录了这一设计，所以现有测试通过并不能证明口径正确。

历史恢复和实时展示共用这个路径，都会受影响。`summarizeUsage()` 的累加仍然适合展示消耗和计算费用，无须改成只取最后一次。

## 推荐修复

### 1. 拆开上下文与消耗

保留独立字段，避免继续复用一个 input：

```ts
type ContextReading = {
	tokens?: number;
	limit?: number;
	source: "pi" | "last-request" | "local-estimate" | "unknown";
};

// 消耗：跨请求累计，供本轮统计和费用使用。
// 上下文：pi 当前读数，或最近一次有效请求的读数，绝不跨请求求和。
```

UI 将本轮统计标为“累计输入 tokens（含缓存）”；需要单列请求输入时使用“最近请求输入”。上下文窗口展示 pi 的当前上下文估算，并说明它与累计消耗不同。此例累计输入仍为 218.81k，上下文显示约 32.68k / 128k。

### 2. 优先读取 pi 已有 contextUsage

本机 pi 的 `get_session_stats` RPC 已返回：

```ts
contextUsage?: {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}
```

其实现位于 pi `dist/core/agent-session.js` 的 `getContextUsage()`：使用当前分支的会话投影，参考最近一次有效 assistant usage，再估算后续消息；压缩后如果尚无新的有效 usage，则返回 tokens/percent 为 null。

Skiff 当前 `usePiSession()` 没有请求这个 RPC。建议：

- 在历史恢复、切换会话、回退/分叉、切换模型后刷新；在 message_end、工具结果、agent_end、压缩完成后合并刷新。
- 流式阶段按请求边界刷新或节流，不在每个 token 事件上发 RPC。
- 在 `SessionState` 保存单独的 context reading，并传给 `useVoyageMetrics()`；沿用当前 owner/generation 校验，同时用刷新序号或上下文版本防止同一会话内的旧响应覆盖新响应。
- 明确区分“旧版 pi 没有该字段”和“pi 明确返回 tokens: null”。前者允许兼容降级，后者必须显示待更新，不得用压缩前 usage 补回。
- tokens 与 contextWindow 使用同一快照；模型变化后旧读数暂作估算，等待 pi 刷新，避免旧 timeline 的 limit 遮盖新窗口。
- pi contextUsage 本身可能含估算，不应把 `source: pi` 一律标为绝对精确。

现有 Rust/RPC 桥按通用命令转发，接入 get_session_stats 不需要新增原生命令或权限。

### 3. 兼容降级及最小修复

对于没有 contextUsage 的旧 pi，或先发布前端最小修复：

- 按消息顺序找最近一次有效 assistant 请求，使用该次 `input + cacheRead + cacheWrite` 作为“最近请求输入占用”。
- 若展示“当前上下文估算”，以该次完整输入加该次 output 为基线，再估算它之后尚未进入请求的用户/工具内容；输出只加该次，不能加本轮全部输出。
- 跳过 pending 的全零占位、无效数值、error/aborted 且无可靠 usage 的请求。没有有效数据时显示未知或明确标记的估算，不能把占位零解释成空上下文。
- 前端 parse 会把 toolResult 合并到 assistant.blocks：做后续增量估算时要识别这些块，避免因它们与 usage 同属一条 UI 消息而漏算，也不要重复加入已包含在后续请求里的工具结果。
- 没有 usage 时，不能只估算最后一轮并声称它是整个会话上下文；系统提示、工具 schema、图片和压缩投影均可能缺失，应标明粗估或未知。

不要仅把跨请求 `sum()` 换成 `max()`：最大单次请求可以另列为“本轮峰值”，但压缩、模型/提示变化或分支回退后，峰值不等于当前上下文。

### 4. 去掉全航行单调锁定，调整提醒

- 去掉对 context 的永久 `Math.max(previous.context, observed)`。合法的新请求读数及真实 usage 对估算的校正均允许下降。
- 同一个请求的重复事件应幂等处理；使用事件完成状态和版本保证终态优先，不靠全航行最大值掩盖乱序或占位零。
- 新会话、分叉、历史恢复和压缩应刷新/失效旧 context 状态；累计消耗按其独立范围保留。
- 阈值仍可沿用现有 90% 提醒，但只读取 context reading。估算时写“估算上下文接近/超过窗口”，不能无条件宣称 API 已拒绝。
- 实际 context_length_exceeded 属于 API 错误路径，应单独展示；不能以“成功请求意味着永远不超限”作为算法，因为新工具结果、新输入或模型切换可能让下一次请求超限。

## 验收用例

1. 本文 7 次请求：累计输入 218,805、输出 1,871、总消耗 220,676；最近请求输入 32,401；pi 上下文估算 32,679；128,000 窗口下无超限警告。
2. 多次工具请求输入均小于窗口，但累计超过窗口：不得误报；一条真实上下文超阈值的读数仍应触发提醒。
3. 缓存全命中、部分命中、缓存写入三种情况：完整输入只计一次，reasoning 不重复加入 output。
4. streaming 全零占位、重复 usage、迟到事件、error/aborted、NaN/负数/缺失字段：不把未知当零，不重复累计。
5. 大文本粗估后收到更小的有效 usage：真实读数替换估算并清除旧警告。
6. 压缩后 tokens 为 null，再收到较小 usage：先待更新后正确回落，不保留压缩前峰值。
7. 历史恢复与实时结束读数一致；切会话、回退和分叉不串读数；模型切换使用新的窗口。
8. 用户新输入和工具结果产生于最后一次 usage 之后：pi 的估算能反映增量，前端降级不会重复或漏计已合并的工具结果。
9. 旧 pi 不支持 contextUsage：兼容降级；支持但明确返回 null：保留未知；快速刷新响应乱序：旧版本不能覆盖新版本。

修改测试时需更新 `voyageContext.test.ts`，以及 `voyage-waterfall.browser.mjs`、`voyage-polish.browser.mjs` 等依赖“上下文等于累计输入”的 DOM 断言；为 usePiSession 的新 RPC 更新 mock。feature 014 的旧规则应注明已被新方案替代。

## 本次验证

- 直接将真实 JSONL 消息传入当前 `parseMessages()` 和 `advanceVoyageContext()`，得到 context=218805、ratio=1.7094140625、estimated=false，以及完全一致的“上下文已超出上限（170.9%）”文案。
- 调用本机 pi 的 `estimateContextTokens()` 处理同一历史，得到 tokens=32679、usageTokens=32679、trailingTokens=0。
- `node --import ./tests/register.mjs --test tests/voyageContext.test.ts tests/capabilities.test.ts`：13/13 通过；其中若干测试验证的是当前错误语义，修复时必须改写。
- 运行现有 `tests/pi.integration.mjs` 对本机 pi 的纯 loopback 集成验证，通过。它验证供应商 prompt_tokens=100、cacheRead=60、cacheWrite=10 被转换成 pi input=30，以及历史恢复后 usage 保持；未向外部模型发送请求。
- 尚未实施上述修复，故这些结果是定位证据，不是修复后的验收结果。
