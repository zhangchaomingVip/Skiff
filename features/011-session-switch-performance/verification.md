# 会话切换验证

首批实现使用统一 owner（会话 ID、cwd、generation）隔离 RPC 快照，渲染时同步投影新批次的空状态。加载、就绪及错误共享同一 owner。成功、失败、finally、流事件、诊断日志以及 App 侧线路事件、授权、模型通知、搜索状态和持久化都检查同一批次。重连稳定回调在调用时立即使旧批次失效；保存新 sessionFile 不改变批次。

导航禁用原因与加载状态分开：加载时允许已有会话和项目选择，生成、发送、回退、修改模型及其他进行中操作仍禁止。侧栏、项目选择、已打开的右键菜单、Launcher 最近会话与项目入口使用相同导航限制，事件处理函数还检查同步 busy/streaming 引用。重复选择当前会话不会写索引或重启。保留按 ID/cwd 隔离的组件 key，不按 generation 重挂整个编辑器；同会话重连保留草稿，不同会话清空草稿、附件、编辑与折叠/滚动状态。历史加载时卸载旧消息列表并显示明确占位，失败保留错误与重新连接按钮。

没有修改 Rust、Tauri capabilities 或进程串行启动/清理机制。启动屏障未释放时可以更新目标和占位，但下一进程仍需等待旧启动完成及停止。测试将这种挂起启动与已经清理的资源分开记录。

| 场景 | 期望与实际 |
| --- | --- |
| 已加载 A→B | 每次 App render 检查归属；B 不接收 A 的消息，反馈与历史提交分别计时，通过 |
| 启动挂起→跨项目 B | 普通可信侧栏点击生效，A 未释放即可选中 B/显示占位；释放后只保留最新进程，通过 |
| switch_session/get_messages 挂起→B | 保持旧屏障挂起直到 B ready，验证 stop 拒绝旧 RPC，无需等 35 秒，通过 |
| 旧错误、消息与退出迟到 | B 的内容、模型、错误、连接、日志、文件与计时快照不变化，通过 |
| A→B→C→A | 最新 generation 生效；被越过的等待目标不进入后续恢复/读取，迟到启动清理，通过 |
| 同会话重连/cwd 变化 | 加载期间立即清空模型和消息；同 ID 的旧成功/退出不覆盖新模型和文件，Probe 补充通过 |
| 初始化失败 | start、switch_session、get_messages 三阶段分别失败；错误/重试可见、不永久 loading；重试新批次成功，通过 |
| 重复选择当前目标 | start、stop、restore、history 请求数量不变化，通过 |
| 导航入口 | 鼠标、Enter、项目、右键、Launcher 加载中导航通过；生成和操作中禁用通过 |
| 草稿/附件/编辑/折叠/滚动 | 同会话重连保留草稿；切换会话清空草稿和文本附件，不继承编辑状态、执行折叠与滚动跟随状态，通过 |
| 空历史 | 成功后显示空会话，结束占位，通过 |
| 元数据 | sessionFile、模型、RouteSnapshot、RouteEvent、elapsedMs 存入各自会话；重载仍正确，通过 |
| 卸载/连续切换 | 所有已释放批次的进程、监听器清理；Node 单测验证 stop 立即拒绝 pending RPC，清除其 35 秒计时器，通过 |

验证命令：

```powershell
npm run build
npm test
npm run check:ui
npx vite build --config tests/session-switch.vite.ts
npx vite preview --config tests/session-switch.vite.ts --port 1432 --strictPort
# 另一终端：
node tests/session-switch.browser.mjs http://localhost:1432 dist/current.json
node tests/session-switch.scale.mjs http://localhost:1431 http://localhost:1432 dist/session-switch-scale
# 分析构建，与无 profiling 的性能采样分开运行：
$env:SKIFF_SWITCH_PROFILE="1"
$env:SKIFF_SWITCH_OUT="dist/session-switch-profile"
npx vite build --config tests/session-switch.vite.ts
Remove-Item Env:SKIFF_SWITCH_PROFILE, Env:SKIFF_SWITCH_OUT
npx vite preview --config tests/session-switch.vite.ts --outDir dist/session-switch-profile --port 1433 --strictPort
node tests/session-switch.browser.mjs http://localhost:1433 dist/profile.json --profile --perf-only --query "messages=1000&kind=tool"
node tests/session-switch.analyze.mjs dist/profile.json dist/session-switch-profile
# 大侧栏诊断使用 4 次点击，仅用于调用栈与成本定位，不作为响应 P95 验收：
node tests/session-switch.browser.mjs http://localhost:1433 dist/sidebar-profile.json --profile --perf-only --samples 4 --query "messages=100&chats=3000&expanded=0"
node tests/session-switch.analyze.mjs dist/sidebar-profile.json dist/session-switch-profile
node tests/pi.integration.mjs <本机pi-cli.js>
```

普通 production 构建保持默认产物；本轮最终重跑用了 `npm run build -- --outDir dist/session-switch-app`，以免清空正在采样的独立 fixture。Node、UI 类型检查及本地 pi 验证结果以最终记录为准。Rust 未修改，不要求额外的 cargo 验证。

最终行为回归 45/45 通过；`npm test` 121/121 通过，包含 stop 立即拒绝挂起请求及清理监听器回调；`npm run build`、`npm run check:ui` 通过。样式审计无错误，112 对颜色对比通过。本机 pi 1.1.0 的隔离集成通过 reasoning、images、usage、fork、commands、history 与进程清理。测试只使用临时配置和本机 HTTP 服务。

性能采样使用固定 150 ms 历史延迟、1440×1000 视口、DPR 1、不限速。A 分别生成 100、1,000、10,000 条可见消息，B 固定两条；两个方向各 30 次可信点击，汇总 60 个样本。纯文本、每条 80 行代码块、带独立 toolResult 的工具、320×240 PNG 单列，故不能将同条数不同类型视为同负载。工具的原始 entry 数为可见消息数的 1.5 倍，其余类型等于可见消息数；总 UTF-8 字节数、代码行数和图片尺寸随原始规模记录保存。侧栏分别为 30、300、3,000，A 历史固定 100 条，项目折叠/展开单列。冷加载另存。发生超时或中止的场景标为未完成，不填 P95。

计时不保存 API key 或聊天正文。归属检查使用合成 fixture 标签，仅保留会话标识、错误计数、模型及文件归属等测试元数据。起点为可信 click 事件捕获阶段，不包含操作系统或自动化输入排队时间。DOM 高亮提交、加载占位提交、两次 rAF 绘制机会、历史提交和可发送快照分别统计；两次 rAF 与 React commit 均不能证明操作系统屏幕已实际绘制。

首批实现已消除加载禁用及旧历史交付窗口。1,000 条大代码块和 10,000 条纯文本的反馈 P95 仍超过本设备上的 100 ms 目标。卸载旧 DOM、挂载完整新历史与布局仍有成本；不能宣称全部规模都已经流畅，也不能把 mock 的启动/停止跨度当作真实 Windows 退出耗时。

| 后续候选 | 证据、决定与验收方向 |
| --- | --- |
| 工具结果索引化 | 1,000 条工具恢复解析最大约 3.5 ms；10,000 条工具达到约 51.6 ms，已有触发证据。建议后续实施索引化并保留缺失/重复 ID、未匹配回退及顺序；其约 2,775 ms 主线程长任务还表明解析优化不能替代虚拟化。本批不捆绑该算法改动 |
| 日志与渲染更新收敛 | 1,000 条工具的 60 次点击仍产生 520 次 React 提交；大侧栏 4 次点击产生 35 次提交。堆栈发现 Sidebar 每次 effect 读取滚动几何信息，触发昂贵样式/布局计算；建议稳定关键 props、减少无关更新并收敛这些读取。未证明日志缓冲是主要瓶颈，不修改日志完整性或错误 memo 比较 |
| 消息和侧栏虚拟化 | 新目标反馈时旧消息挂载数为 0，但历史 ready 后仍全量挂载，10,000 条纯文本出现秒级长任务。侧栏即使项目折叠，最近列表仍挂载 3,000 行，展开时同会话还出现在项目列表；其反馈仍超目标。建议下一批重点实施消息与侧栏虚拟化，并覆盖动态高度、图片、流式追加、滚动锚点、键盘与跨边界回合信息 |
| 延迟高亮与 Worker | 10,000 条纯文本 JSON.parse 最大约 7.9 ms、归一化约 4.5 ms，不支持先引入解析 Worker；10,000 条工具 JSON.parse 约 15 ms、归一化约 51.6 ms，先索引化，再复测是否需要分块或 Worker。代码块先限制挂载范围，再评估可见后高亮；不能用 Worker 掩盖同步 DOM 工作 |
| 索引持久化合并 | 3,000 会话的短诊断中 stringify 最大 9.5 ms、localStorage 最大 11.4 ms，低于约 320 ms 的样式计算；优先处理全量侧栏与读布局。本批只跳过重复选择/无变化更新，不批量保存；如后续合并保存，仍需验证退出与存储失败边界 |
| 原生启动取消 | 挂起启动期间导航反馈已可用，下一 RPC 仍遵守既有串行清理。mock 不足以证明真实 native 等待主导；本批不修改 Rust，先在真实 Tauri 中测进程树和配置互斥，再决定取消登记/回收与重叠启动 |

尚未验证真实 Tauri/WebView2 的进程树启动与退出耗时；本机 pi 集成通过不代表这一平台边界已通过。

## 性能结果

普通 production 最终采样单独串行运行，分析工具关闭，两个方向各 30 次。下表单位 ms。

| 阶段 | 修复前 P50/P95 | 修复后 P50/P95 |
| --- | ---: | ---: |
| 目标高亮 DOM 提交 | 18.8 / 57.2 | 11.2 / 15.8 |
| 加载占位 DOM 提交 | — / — | 11.3 / 15.8 |
| 两次 rAF 绘制机会 | 34.9 / 86.1 | 23.3 / 29.5 |
| 历史 DOM 提交 | 208.0 / 231.0 | 185.6 / 208.1 |
| 可发送快照 | 208.0 / 231.0 | 185.6 / 208.1 |

分规模探索矩阵计划前后各 60 次，超时项不填分位数。首个纯文本场景与早期诊断采集重叠，最终普通场景以以上独立复测为准。最长主线程任务覆盖冷加载、预热和采样，不能与仅覆盖预热后 60 次的反馈分位数当作相同统计窗口。0 表示未观测到 ≥50 ms 的 longtask，不代表没有主线程工作。所有成功 current 场景在目标高亮时旧消息挂载数为 0；ready 后的最大挂载数仍等于 A 的可见消息数。

| 场景 | 前→后高亮 P50 | 前→后高亮 P95 | 后加载 P95 | 前→后历史 P95 | 前→后最长任务 | 留存样本数 前/后 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 · text | 9.1 → 6.4 | 30.3 → 8.0 | 8.0 | 194.5 → 184.4 | 76.0 → 56.0 | 60/60 |
| 100 · code | 12.8 → 17.0 | 234.0 → 28.3 | 28.4 | 401.0 → 415.6 | 294.0 → 263.0 | 60/60 |
| 100 · tool | 8.5 → 6.4 | 39.8 → 8.1 | 8.1 | 211.3 → 195.0 | 68.0 → 70.0 | 60/60 |
| 100 · image | 7.9 → 6.5 | 34.4 → 7.5 | 7.5 | 202.1 → 191.2 | 60.0 → 0.0 | 60/60 |
| 1000 · text | 8.1 → 6.3 | 177.4 → 19.8 | 19.9 | 365.0 → 296.1 | 256.0 → 182.0 | 60/60 |
| 1000 · code | 24.3 → 6.9 | 2432.0 → 138.4 | 138.4 | 2832.4 → 1508.6 | 3117.0 → 1528.0 | 60/60 |
| 1000 · tool | 9.7 → 7.4 | 296.4 → 36.2 | 36.2 | 511.1 → 357.9 | 500.0 → 257.0 | 60/60 |
| 1000 · image | 8.3 → 7.4 | 235.6 → 22.7 | 22.8 | 438.2 → 363.7 | 362.0 → 216.0 | 60/60 |
| 10000 · text | 18.7 → 11.6 | 3760.9 → 160.3 | 160.4 | 5355.2 → 1744.2 | 5424.0 → 1932.0 | 60/60 |
| 10000 · code | — → — | — → — | — | — → — | — → — | 0/10（未完成） |
| 10000 · tool | — → 8.4 | — → 349.9 | 349.9 | — → 2173.8 | — → 2775.0 | 50/60（未完成） |
| 10000 · image | 20.4 → 14.7 | 2470.1 → 336.6 | 336.6 | 3631.0 → 3916.3 | 6935.0 → 4087.0 | 60/60 |
| 侧栏 30 · 折叠 | 17.7 → 11.0 | 57.3 → 15.9 | 15.9 | 228.2 → 217.5 | 86.0 → 50.0 | 60/60 |
| 侧栏 30 · 展开 | 21.4 → 14.6 | 67.6 → 18.5 | 18.5 | 241.7 → 217.9 | 102.0 → 51.0 | 60/60 |
| 侧栏 300 · 折叠 | 59.6 → 50.5 | 98.6 → 64.3 | 64.8 | 293.2 → 307.1 | 162.0 → 131.0 | 60/60 |
| 侧栏 300 · 展开 | 94.2 → 55.7 | 165.2 → 91.5 | 92.2 | 404.2 → 334.1 | 272.0 → 271.0 | 60/60 |
| 侧栏 3000 · 折叠 | 307.1 → 264.1 | 470.0 → 487.4 | 490.8 | 1113.7 → 1269.7 | 927.0 → 1073.0 | 60/60 |
| 侧栏 3000 · 展开 | 482.3 → 570.7 | 921.9 → 1022.8 | 1032.8 | 2082.5 → 2673.5 | 1739.0 → 2275.0 | 60/60 |

10,000 条代码块前后均达到五分钟预算：前版未留下完整原始报告，后版仅存 10 次样本；10,000 条工具前版仅存 50 次样本。缺失的字段记为未知，不能将未取得的 longtask/解析数据记为 0。当前采样驱动支持预算到期先保存部分数据，再关闭浏览器；早期已启动的父驱动未使用更新后的 IPC 停止流程。

后台 mock 跨度（包括冷加载和预热）独立记录，单位 ms：

| 阶段 | 前 P50/P95 | 后 P50/P95 |
| --- | ---: | ---: |
| rpc_start | 0.0 / 0.1 | 0.0 / 0.1 |
| switch_session | 3.5 / 6.0 | 1.8 / 2.5 |
| get_messages | 151.5 / 155.7 | 152.6 / 157.9 |
| rpc_stop | 0.0 / 0.1 | 0.0 / 0.0 |

get_messages 包含固定 150 ms 注入等待；桥接 invoke 跨度可能包含回应事件处理的同步解析，不能将其全部解释为后台进程计算。串行 previousTeardown 的墙钟等待与 DOM 反馈是不同指标。挂起启动回归证明目标可立即变化，但后台初始化仍需等待释放；挂起恢复/历史请求回归证明 stop 拒绝 pending RPC，无需等 35 秒超时。

## 独立分析采集

React profiling 构建与 CDP trace 同时开启，串行运行前后版本。1,000 条工具/30 会话采集 60 次；3,000 会话折叠/100 条文本的补充诊断只采集 4 次，用于定位成本，不使用其 P95 验收。以下 React 耗时是 onRender 的 actualDuration，即该次提交对应的渲染成本，未包含完整 DOM 提交、布局与绘制。Performance trace 中的 Layout、UpdateLayoutTree 和 FunctionCall 分开统计；存在嵌套，不能将全部总时长相加当作墙钟时间。

| 分析指标 | 1,000 工具前→后（60 次） | 3,000 侧栏前→后（4 次诊断） |
| --- | ---: | ---: |
| React 提交数 | 553 → 520 | 34 → 35 |
| 最大 actualDuration | 528.6 → 249.8 ms | 201.9 → 226.8 ms |
| 最长 longtask | 1,250 → 264 ms | 1,408 → 1,329 ms |
| 最大 Layout | 150.7 → 66.3 ms | 75.1 → 57.2 ms |
| 最大 UpdateLayoutTree | 135.6 → 59.6 ms | 287.3 → 320.4 ms |
| 最大 parseMessages | 2.7 → 1.5 ms | 见原始分析 JSON |
| 最大 JSON.parse | 3.7 → 2.2 ms | 见原始分析 JSON |
| 最大 workspace.stringify | 1.5 → 0.3 ms | 5.6 → 9.5 ms |
| 最大 workspace.localStorage | 0.8 → 0.2 ms | 9.8 → 11.4 ms |

分析器保存所有 >50 ms 的 FunctionCall 位置，以及最长调用内 CPU 样本的五组主要堆栈，并通过 production sourcemap 映射到源码。工具场景当前最长调用为 Scheduler 的 `R`（262.2 ms），堆栈经过 React 工作循环、DOM 提交和 `react-markdown → remark-parse → mdast-util-from-markdown → micromark`。它支持减少挂载与重复渲染，不能推导 JSON 解析是主因，也不能据此认为已有 Markdown memo/高亮缓存失效。

大侧栏当前最长调用约 587.9 ms，其主要 CPU 样本（约 326.8 ms）落在 [Sidebar.tsx](../../src/components/Sidebar.tsx) 的 `updateScrollFades`（第 105 行）读取滚动几何信息处，另外包含 React DOM 属性更新和垃圾回收。trace 单次样式计算约 320.4 ms；该 fixture 实际挂载 3,000 个 `.chat-link`，即使项目折叠也保留完整最近列表。序列化/存储的短诊断最大耗时明显更小，支持先处理侧栏挂载和读取布局；4 次样本不足以证明所有持久化尾延迟已受控。代表场景的完整长调用及堆栈见分析 JSON，未对每个规模场景逐一采集 trace。

## 原始数据与截图

- [基线环境与复现](baseline.md)，[原版原始数据](baseline.json.gz)，[最终原始数据与 45 项回归](current.json.gz)，[普通场景摘要](results/official-summary.json)。
- [修复前截图](baseline.png)、[修复后截图](current.png)、[加载占位截图](loading.png)。
- [规模矩阵及原始数据索引](results/scale-summary.json)：索引 0–11 是消息规模，12–17 是侧栏规模；每项列出 query、字节数、entry 数、结果、错误和对应 `.json.gz`。缺失的 9-baseline 原始文件明确记为 null，其超时记录保留在索引中。
- [工具基线分析](results/profile-baseline.analysis.json)、[工具修复后分析](results/profile-current.analysis.json)，对应的 `profile-*.json.gz` 保存原始计时，`profile-*.trace.json.gz` 保存完整 trace。
- [侧栏基线分析](results/sidebar-profile-baseline.analysis.json)、[侧栏修复后分析](results/sidebar-profile-current.analysis.json)，对应的 `sidebar-profile-*.json.gz` 和 `sidebar-profile-*.trace.json.gz` 保存四次诊断的原始数据。
- [最终测试源码 SHA-256](results/source-hashes.json)记录工作区版本；各原始报告还记录实际加载的 bundle URL。

解压 trace 后可在 Edge DevTools Performance 中加载。分析器复现命令见前文；构建产物与旧采集留在被 Git 忽略的 dist 中，不纳入源码提交。规模矩阵采集后最后补上 cwd 模型偏好失效保护；最终普通场景、45 项行为回归和独立分析均使用最后构建的源码，该保护不改变矩阵正常已就绪往返的路径。
