# 018 验证记录

日期：2026-10-15。实施顺序为 020 → 019 → 018；本项完成后停止等待用户安排。未创建提交，未增加依赖；018 未修改 Rust、Tauri 权限或 pi 安装。

## 实现结果

- 运行中默认插话，可选择等本轮做完；提交与停止各有独立按钮。按 `source` 分流扩展命令与模板/skill，消费 `started` / `queued` / `handled`，聊天记录只接受真实 pi 消息。
- `queue_update` 替换完整快照，显示实际队列模式。撤回全部保留服务端实际返回的文字，支持复制或明确追加到草稿，不自动覆盖输入、不承诺恢复图片。
- Escape 清空输入或取消编辑；Ctrl+Shift+Backspace 停止，输入法组合期间忽略。停止锁定本 owner 的提交，清队列 → 取消有效对话框 → abort → 核对空闲；失败不显示完整停止成功。
- `agent_end` 不解锁当前运行，`agent_settled` 收束计时。缺少该事件的兼容路径跨两个时间边界核对 `get_state`，重试与压缩期间保持运行。
- 长度上限、错误、中止、手动停止各有结果标记；继续追加普通提示，不 rewind。手动停止在没有助手回复时仍有回执。
- 用户消息可编辑重发，最后助手回复可重新生成，保留对应图片和文本附件。编辑草稿保存精确目标与分支 leaf 版本；发送前再次校验，fork 后迁移草稿作用域；取消恢复原普通草稿，分支变化降级而不 rewind。
- 历史助手复制按钮保留在 DOM，hover 或键盘焦点显示。运行状态使用运行中、等待响应、空闲，确认手动停止使用已停止；空闲收起条不重复速度。
- 四类扩展对话框 FIFO 显示；editor 保留多行 prefill。裸发送保留原始 pi id，不创建 response waiter。runtime 负责后台期限、窗口恢复时重查、重复 id 和回包排他。稍后处理允许隐藏对话框并导航，仍保留后台待确认状态；明确关闭发送取消。

## 自动检查

| 检查 | 结果 |
| --- | --- |
| `npm test` | 176 / 176 通过 |
| `npm run build` | 通过；保留现有大 bundle 提示，主 JS 约 738 kB |
| `npm run check:ui` | 通过 |
| `npm run test:styles` | 131 tokens，0 样式错误；126 对对比度，0 失败 |
| `git diff --check` | 通过 |
| `tests/pi.integration.mjs` | 本地真实 pi 基础回归通过：推理、图片、用量、fork 与恢复 |
| `tests/pi.interactions.integration.mjs` | 本地真实 pi 交互协议通过，见下节 |
| `tests/interactions.browser.mjs` | 全部断言通过，浏览器错误为 0 |
| `tests/session-switch.browser.mjs --samples 2` | 45 项会话隔离回归通过，含实际编辑入口；2 个采样只用于功能回归，不作为性能结论 |
| `tests/retrievability.browser.mjs` | 019 搜索、草稿与后台授权全部回归通过 |
| `tests/turn-usage.browser.mjs` | 用量、复制、折叠、弹层与窄屏通过 |
| `tests/sidebar-archive.browser.mjs` | 归档、只读预览、恢复/删除及侧栏响应式通过 |

新增纯函数/runtime 测试覆盖完整队列替换、非终态 agent_end、截断终态、无助手停止回执、对话框 FIFO 与期限、原 id 回包、重复请求和并行点击、写入不明不重发、generation 销毁，以及编辑前普通草稿附件共用容量上限。

## 本地真实 pi 协议

环境：Node 24.19.0，`@earendil-works/pi-coding-agent` 1.2.0；独立临时 agent 配置、auth、扩展、模板和 skill，模型仅访问 `127.0.0.1` 的 OpenAI SSE 服务。未调用付费或外部模型 API。

运行：

```powershell
node tests/pi.interactions.integration.mjs C:/Users/49772/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/dist/cli.js
```

实际断言包括：

- 从 `get_state` 读取模式并验证非默认 all 模式；混合 steer / follow_up / prompt 排队的 disposition 和完整快照；clear_queue 返回的实际文本及空快照。
- 本地 read 工具执行完毕后才送达 steering；模板和 skill 在队列入口展开，扩展命令被 steer 拒绝、由 prompt 处理。
- 普通混合队列完成收束；临时扩展在 agent_end 再投递 follow-up，实测第一条 agent_end 后仍有新 user / assistant 工作，最后才 agent_settled。
- clear_queue 后 abort，待处理计数归零；模型 SSE 的 length 到达实时 message_end。
- select、confirm、input、editor 四种请求的原 id 回包、取消、多行 editor prefill；前三类 timeout 默认值，其中 confirm 为 false。超时没有额外关闭事件。

发现的协议差异：length 在实时事件中可见，但 pi 的 `get_messages` 投影可能把保存结果归为 stop。本实现保留实时轮次结果，避免随 agent_end / agent_settled 丢失；不宣称重新载入后仍能从该投影重建原始截断原因。

## 模拟浏览器验证

Windows / Edge 151.0.4129.101，headless，独立 Vite 1424 端口、正式 App 与组件、模拟 Tauri bridge，真实浏览器 IndexedDB。四类方法的完整服务端交互另由上节真实 pi 测试证明。

覆盖快速连续插话、不同投递时机、撤回保留草稿、命令分流、不伪造 handled 消息；停止顺序与幂等、清队列失败仍 abort、只影响当前 owner、IME 保护；截断继续不 fork、agent_end 不提前解锁；编辑取消、导航/重载恢复、分支变化拒绝、图片/文本附件重新生成；FIFO、后台需确认、稍后处理与切换保留、排队超时不回包、迟到/重复发送约束、旧 generation 取消、未知写入不重试、旧协议连续两轮的状态回退及重试/压缩保护。

记录：[交互断言](browser-verification.json)、[并行会话回归](session-regression.json)、[019 联动回归](retrievability-regression.json)。019 本次完整界面热查询 p95 185.4 ms，输入到下一帧 p95 71.3 ms，仍满足原门槛。

截图已实际检查：[队列浅色](screenshots/queue-light.png)、[截断结果](screenshots/truncated-light.png)、[编辑器对话框](screenshots/dialog-light.png)、[深色确认](screenshots/dialog-dark.png)、[390 px 窄屏确认](screenshots/dialog-narrow.png)。

## 未覆盖与协议限制

- 没有运行 Tauri/WebView2 桌面端整条链路或桌面打包。浏览器的桥调用为模拟；真实 pi 验证直接使用本地子进程 stdin/stdout。019 既有原生文件读取测试结果不能替代此次桌面交互验收。
- 没有安装旧版 pi。旧协议回退通过实际 get_state 字段核对及浏览器抑制 agent_settled 的连续两轮测试验证，不等于所有历史版本均已验证；拒绝命令会显示错误并保留未接收输入。
- pi 1.2.0 不提供对话框关闭事件或 pending 查询。客户端期限为收到请求后的近似期限；无 timeout 的扩展自有 AbortSignal 取消无法精确感知。超时提示不代表收到服务端处理回执。
- 裸发送成功只表示本地写入完成。Native 写入失败/超时无法证明完全未写入，采用保守策略：不自动重发，提供重新连接入口。已过期请求不补发取消；重连销毁旧 generation 后不向新进程发送旧 id。
- 手动停止回执是当前 runtime 的客户端结果，不写入 pi transcript。撤回回包只有文字，不能恢复图片原始数据。
