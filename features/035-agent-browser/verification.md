# 035 · 分阶段验证记录

日期：2026-11-09。A–G 阶段完成；Windows + agent-browser 0.41.2 首版最终验收通过。完整范围与未覆盖项见末尾 G 节。

## 执行入口

```powershell
node tests/agent-browser.spike.mjs --desktop --pi C:/Users/49772/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js
```

`--pi` 参数使用本机实际 pi CLI 路径，不应照搬其他电脑的用户名。CLI 路径可用 `SKIFF_AGENT_BROWSER_BIN` 指向固定版本的 agent-browser 原生 exe。测试需要仓库依赖、项目本地 Playwright、系统 Edge、Rust 和 Windows Tauri 构建环境。

脚本默认执行 CLI 与 Vite 实验，`--desktop` 加入隔离的 release WebView2 构建和画面转发验证；同时传 `--pi` 才执行真实 pi 与 Rust 桥接/中断实验。完整 A 阶段验收使用上面的完整参数。

## 结果

| 检查 | 结果与证据 |
| --- | --- |
| 固定版本 | agent-browser 0.41.2，脚本包含精确版本断言 |
| 本地页面操作 | snapshot 元素引用 → 中文 fill → click → 页面结果核对通过 |
| 错误输出 | 不存在的选择器返回结构化失败，通过 |
| 命名 session | 独立 profile / namespace；短空闲 session 退出后 main 保留 |
| 实时帧 | 随机端口发现、ack 画面渲染通过 |
| 鼠标/中文输入 | WebSocket 点击聚焦，逐字符中文输入，通过 |
| URL | History API 地址变化可见，通过 |
| Vite 1421 | 真实 localhost 页面直接收帧，通过 |
| Release 来源 | 实际为 `http://tauri.localhost`；直连失败符合实测 403 |
| Release 转发 | 限定来源的实验代理收帧、画面点击及页面结果核对通过 |
| pi → Rust → CLI | 真实 pi 注册工具，Rust 返回 Chrome snapshot，模型完成响应 |
| pi abort | RPC 成功；fetch 结束后 Rust 命令仍 active，确认需要显式取消协议 |
| CLI kill | daemon 仍执行在途 wait，后续 snapshot 被阻塞约 2.18 秒 |
| 关闭清理 | 浏览器 session、临时配置/profile、探针与独立 Vite 进程回收 |

本地生成证据位于 `dist/agent-browser-spike/`：`results.json`、`native-build.log`、`loopback-viewer.png`、`vite-viewer.png`、`release-viewer.png`。这些产物被忽略，不提交；可用脚本重建。

## 隔离方式

- 使用新建临时目录、随机 agent-browser namespace 和临时 profile；不使用默认浏览器会话或用户日常 Chrome。
- pi 使用临时 `PI_CODING_AGENT_DIR` 和本地 mock SSE 服务，无真实模型调用。
- 桌面探针使用独立标识 `com.skiff.browser-spike`，没有加载 Skiff workspace 或预置 localStorage。
- 原 Skiff 开发服务的 1420 端口保持运行；探针使用独立 9236 CDP 端口，Vite 使用 1421。
- 未修改生产 Tauri 配置、供应商凭据及用户会话索引。

## 未覆盖

A 阶段不是产品功能交付。后续原生服务的完成情况见下方 B 阶段；产品布局、运行池绑定及恢复、实体 IME、双主题和正式安装器仍需相应阶段验收。详细决定与限制见 [DESIGN.md](DESIGN.md)。

## B · 原生浏览器服务

### 原生测试

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --include-ignored
```

71 项通过，包括本阶段的真实 agent-browser 集成测试。该集成测试平时标记 ignored，避免没有依赖的环境意外启动浏览器；上述命令已明确执行它。

验证覆盖：

- 两个聊天独立 Chrome / profile / cookie，同聊天并发启动去重，修改配置需先关闭运行实例。
- 真实 open、snapshot、中文 fill、click；文本恰好等于 `--headed` 时仍按填写内容处理。
- HTTP 鉴权、跨聊天凭据拒绝、重复 requestId 拒绝、旧 generation 拒绝。
- `http://tauri.localhost` 来源经生产 Rust 转发收帧，其他来源拒绝；人工控制下的真实鼠标和中文字符输入。
- 接管等待在途命令结束，排队动作被丢弃；交还后可继续操作。
- 独立取消接口在长命令期间及时响应，实际排空后状态变为 stopped。
- 关闭一个聊天不影响另一个；旧凭据不可继续执行。
- daemon 崩溃、仅 Chrome 退出、空闲退出能识别，重新启动前回收旧 daemon，不自动打开默认 profile。
- 数据目录活跃租约拒绝另一服务触发回收；模拟应用异常退出释放租约后，按 exe / PID / 创建时间回收旧资源。
- 进程身份不匹配时拒绝回收；子进程输出上限和执行超时可生效。

### 真实桌面链路

```powershell
npm run test:cdp -- --browser
```

通过生产 Skiff WebView2 → Tauri IPC → 新浏览器服务 → 真实 Chrome 链路，验证双实例、操作结果、画面转发、接管/交还/停止及单实例关闭。浏览器操作后再次发送普通聊天，真实 pi 从本地 mock 模型收到回复，说明原有聊天链路正常。

测试还特意留下一个托管浏览器，在还原 localStorage 并等待落盘后正常关闭实际 Skiff 窗口；确认其 daemon 已退出、owned.json 已清除。退出检查通过后才执行测试进程兜底清理，避免强杀掩盖生命周期问题。

本流程使用临时 `PI_CODING_AGENT_DIR`、`SKIFF_BROWSER_DATA_DIR` 和 WebView2 profile；保留原有 localStorage 快照、finally 还原和 8 秒等待，没有使用真实账户或真实模型服务。

正式来源复现入口：

```powershell
node tests/browser-native.release.mjs
```

这个入口构建真实 Skiff release 可执行文件，并仅为测试启用 `tauri/devtools`、`tauri/custom-protocol` 和相对测试数据目录 `./browser-cdp-data`。可执行文件复制到临时目录后运行，因此应用目录及 WebView2 数据都位于临时目录；不修改生产 `tauri.conf.json`。测试页面匹配实际 `http://tauri.localhost` 来源，再复用上述完整服务及退出流程。

Release 复核暴露了正常退出与强制回收之间的竞态：Windows 可能在进程已开始退出、句柄尚未 signalled 时拒绝 TerminateProcess。现已等待核对实际退出状态，修复后 release 服务及退出检查通过。

浏览器专项在触碰 localStorage 前，通过 `Browser.getBrowserCommandLine` 检查真实 `--user-data-dir`，确认它位于本次临时目录；release 实际检查已通过。release 初始化后快照为 8 个键，finally 已全部还原，不能仅用键数判断 profile 是否隔离。

### 其他检查

| 检查 | 结果 |
| --- | --- |
| `npm test` | 384 项通过 |
| `npm run build` | TypeScript 和 Vite 生产构建通过 |
| `npm run check:ui` | 通过 |
| `npm run test:styles` | 0 样式错误，0 对比度失败；未保留无关的生成报告变动 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --include-ignored` | 71 项通过，含真实浏览器 |
| `npm run test:cdp -- --browser` | 真实桌面服务及普通 pi 回归通过，正常窗口关闭清理通过 |
| `node tests/browser-native.release.mjs` | 真实 release 构建和 `tauri.localhost` 下的生产服务验证通过；补充命令行目录断言后直接重跑该 release 二进制的 CDP 也通过 |

### B 阶段交付边界

依赖查询、安装指引、配置接口和前端类型已就绪，尚无产品设置页和浏览器面板。控制权在原生服务端有效；中断 pi 轮次、模型自动使用工具、人工输入法完整交互、聊天归档/删除绑定在 C–F 阶段继续。当前仅支持已实测的 Windows 和 agent-browser 0.41.2。

B 阶段结束后等待用户消息，未开始 C。

清理说明：浏览器进程和本轮 CDP 临时目录已清理。一次工具策略拦截了旧测试临时目录 `skiff-browser-service-4c709b42884c484fae00122381530159` 的额外删除操作（仅返回 `blocked by policy`）；该旧目录保留，未尝试绕过。

## C · pi 浏览器工具

### 可重复入口

```powershell
npm run test:cdp -- --browser-tools
node tests/browser-native.release.mjs --browser-tools
node tests/browser-settings.browser.mjs
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --include-ignored
```

设置预览验证需要先运行 `npm run dev -- --port 1421`；脚本默认连接 `http://localhost:1421`，使用项目本地 Playwright 和系统 Edge。桌面及 release 脚本独立管理应用进程，端口 1420、9222 需要空闲。

### 真实桌面结果

开发版和 release 版本均通过同一 C 流程：

1. 默认关闭时，真实 pi 的模型请求没有 browser 工具，普通聊天成功，浏览器未启动。
2. 通过实际设置开关保存并重连；仅开启能力仍不启动 Chrome。
3. 本地 mock 模型向真实 pi 发出工具调用：open → snapshot → 根据真实页面引用填写中文 → press / scroll / wait → 新 snapshot → 根据新引用点击 → snapshot 核对提交结果 → screenshot。8 类操作全部执行；截图实际作为 PNG 图片进入后续模型请求。
4. 原生查询确认浏览器 chatId 与启动台实际创建的活动聊天一致，避免把测试预置 ID 或 RPC instanceId 当作聊天归属。
5. 在轮次之间用原生接口接管，再让 pi 尝试点击；模型收到明确的控制权错误，UI 工具状态为失败，未执行点击。这里没有验证「接管正在运行的轮次后自动中断 pi」；该用户入口在 E。
6. 交还后让 pi 开始 7 秒 wait；通过真实输入框的「停止生成」发出 abort。工具独立取消到达原生服务，最终查询成为 stopped，未发起额外模型请求，页面保留。
7. 设置关闭并重连后，真实模型请求再次不包含 browser，普通聊天成功；浏览器 generation 保留。
8. 继续复用 B 原生双浏览器、实时帧、控制权和单实例关闭回归。还原 localStorage 并等待 8 秒后正常关闭窗口，确认托管 daemon 退出、owned.json 清除。

Release 流程构建真实 Skiff release 二进制（仅测试启用 devtools 和 custom-protocol），实际来源为 `http://tauri.localhost`。在写 localStorage 前核对 WebView2 实际命令行的数据目录位于本次临时目录；本轮 release 快照及还原 8 个键，开发版为 0 个键。pi、浏览器 profile、WebView2 和模型服务均使用隔离测试目录或本地服务，无真实模型/登录/账户调用。

### 自动化和 UI 检查

| 检查 | 结果 |
| --- | --- |
| `npm test` | 390 项通过，含新增 6 项工具扩展回归；最终错误文案改动后专项 6 项再次通过 |
| `npm run build` | TypeScript + Vite 通过；release 入口也重新执行同等构建 |
| `npm run check:ui` | 通过 |
| `npm run test:styles` | 0 样式错误，0 对比度失败，未保留生成报告变动 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --include-ignored` | 73 项通过，含 B 真实服务及 C 真实工具租约集成 |
| `npm run test:cdp -- --browser-tools` | 真实 WebView2 → Tauri → pi → Rust → Chrome 通过，正常退出清理通过 |
| `node tests/browser-native.release.mjs --browser-tools` | release 工具、来源、普通聊天和退出清理全部通过 |
| `node tests/browser-settings.browser.mjs` | light/dark、键盘开关、保存重连、重新打开保持设置、600×400 窄窗通过；已目视检查截图 |

扩展测试覆盖无效运行时不注册、按操作校验字段、从新 context 绑定实例、截图与元数据、独立取消、撤销后去除工具及人工控制错误。原生新增测试覆盖默认关闭、重连旧凭据失效、禁止 Origin、取消早于命令且不启动浏览器、重复请求、设置持久化，以及真实表单/PNG/接管/排空/关闭。B 的配置回归断言更新为「有运行实例时不能改 CLI 路径」，允许独立修改能力开关。

生成证据在 `dist/cdp-browser-tools.png`、`dist/cdp-dev.log`、`dist/browser-settings/{light,dark}.png` 和对应 `-narrow.png`；均不提交，可由上述入口重新生成。

### C 交付边界

能力入口为「设置 → AI 浏览器」，默认关闭。浏览器只在首次 open 时启动，禁用立即撤销所有进程租约；其他已存在的聊天需要重连才加载刚开启的工具。C 尚不提供实时画面产品面板、依赖安装及路径编辑界面、人工输入 UI、交还后续跑或归档/删除绑定，分别留在 D、E、F。首版仍仅支持实测 Windows + agent-browser 0.41.2。

C 已完成，按阶段约定等待用户消息再开始 D。

## D · 实时画面与聊天布局

### 交付内容

聊天顶部新增「浏览器」按钮。首次观察到当前聊天的新浏览器实例会自动展开右侧面板，显示同一 Chrome 的实时画面、网址、控制状态及连接状态；手动收起后，该实例的后续操作不会再次展开。浏览器和航行台互相切换显示。宽窗口复用 ResizeSeparator 调宽并保存偏好；窄窗口显示独立浏览器视图，返回按钮或 Escape 回到保留草稿的聊天。

观看通过生产 Rust 转发，只发送 config 和 ack；未发送鼠标或键盘事件。画面以 JPEG 解码到 canvas，保持比例，最多 10 FPS；一个解码任务加一个待处理最新帧，替代帧不再绘制，所有 bitmap 在绘制、丢弃或迟到完成时释放。隐藏面板、切到另一聊天/工具或文档后台时关闭观看连接，浏览器本身继续运行。断连时清空旧画面，重连只获取最新帧。

设置新增依赖重新检测、固定版本安装命令复制和 CLI 路径编辑。检测不下载或启动 Chrome。`configuredCliPath` 与实际解析的 `cliPath` 分开，空配置保持自动查找；修改路径仍由原生服务拒绝与运行实例冲突的操作。故障可选择关闭并重新准备，明确提示当前页面会关闭、profile 保留，不自动重放页面动作。

### 验证入口与结果

```powershell
npm run dev -- --port 1421
# 另一个终端：
node tests/browser-panel.browser.mjs
node tests/browser-settings.browser.mjs
npm run test:cdp -- --browser-tools
node tests/browser-native.release.mjs --browser-tools
```

| 检查 | 结果 |
| --- | --- |
| `npm test` | 392 项通过，含新增面板实例状态和帧丢弃/释放回归 |
| `npm run build` | TypeScript、Vite 生产构建通过；最终 release 入口再次构建最新前端 |
| `npm run check:ui` | 通过 |
| `npm run test:styles` | 新增 browser.css 也纳入审计；0 样式错误、0 对比度失败，生成报告变动未保留 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --include-ignored` | 最终 73 项通过，含真实浏览器服务、工具租约和清理 |
| `node tests/browser-panel.browser.mjs` | 明暗主题、真实 JPEG 解码 mock、首次展开、手动收起、航行台互切、键盘调宽/返回、长网址、草稿、后台释放、旧聊天迟到查询、实例替换、断连重连、关闭/故障重试、依赖指引、路径保存及恢复自动查找均通过 |
| `node tests/browser-settings.browser.mjs` | 开关/保存重连、明暗主题和 600×400 布局回归通过 |
| `npm run test:cdp -- --browser-tools` | 最终开发版生产面板收帧和 canvas 像素检查通过；8 类 pi 操作、中文表单、截图、取消、普通聊天、原生双实例及正常退出清理通过 |
| `node tests/browser-native.release.mjs --browser-tools` | 最终 release 在实际 tauri.localhost 下的产品面板、工具及退出清理通过 |

真实桌面新增断言：表单任务后面板自动展开；面板 chatId/generation 与工具实际使用的实例一致；canvas 具有有效尺寸且像素已由 Chrome JPEG 绘制；输入草稿后收起/重开，恢复真实画面并保留草稿。截图为 `dist/cdp-browser-panel.png`，不是独立实验观看器。

Mock 流程在 1421 独立端口下验证两个聊天的不同画面。切换后只保留当前聊天 socket，旧查询释放后不能覆盖当前归属；后台 visibilitychange 触发连接归零，返回后重新观看。窄窗是 600×400，检查无横向溢出且返回入口可操作。故障流程确认只在用户选择重新准备时调用 browser_close；普通观看、收起和切换不启动/停止/关闭浏览器。帧回归验证解码期间连续收到更新只绘制最新帧，所有被丢弃和卸载后迟到的 bitmap 均关闭。

调试期间依赖状态新增字段曾暴露同一 struct 初始化中重复获取 settings 锁导致卡住的问题；已改为一次复制 settings，最终完整 Rust 和桌面/release 流程均通过。该失败轮次停在隔离测试的依赖查询阶段，未启动托管 Chrome；测试进程树已回收。

### 证据及边界

本地截图：`dist/browser-panel/light.png`、`dark.png`、`light-narrow.png`、`dark-narrow.png`、`missing-dependency.png`；已目视检查明暗桌面、窄窗及真实桌面面板。生成文件均在忽略的 dist 中，不提交。

完整链路仍只用临时 PI_CODING_AGENT_DIR、浏览器数据和 WebView2 目录及本地 mock 模型；核对真实 user-data-dir 后才操作 localStorage。最终开发版快照/还原 0 个键，release 快照/还原 8 个键，均等待刷盘后正常关闭窗口并核对 daemon 清理，未触碰真实 pi 凭据或用户工作区。

本阶段验收的是观看面板。鼠标/滚动/键盘/中文输入、接管时中断 pi、交还后读取新页面继续，以及正常停止/关闭浏览器入口由 E 完成；归档、删除、profile 恢复及完整多聊天生命周期仍由 F 验收。首版范围仍为 Windows + agent-browser 0.41.2。

D 已完成，按阶段约定等待用户消息再开始 E。

## E · 人工接管、交还与操作记录

### 可重复入口

```powershell
# 1421 的 mock 预览服务运行时：
node tests/browser-control.browser.mjs
node tests/browser-panel.browser.mjs
node tests/browser-settings.browser.mjs

# 空闲 1420/9222 时：
npm run test:cdp -- --browser-tools
node tests/browser-native.release.mjs --browser-tools
```

本机已有用户的 Tauri/Vite 开发服务占用 1420，本轮开发版完整链路改用已有 harness 支持的 `SKIFF_CDP_BINARY`：复制最新 debug 可执行文件到测试临时目录运行，前端使用当前 Vite，pi/浏览器/WebView2 仍全部隔离。未停止用户的开发服务或使用其真实 pi 目录。正式包使用独立 release 来源和临时应用目录。

### 已通过的实际交互

1. 真实 pi 通过浏览器工具开始 7 秒 wait。面板接管先由原生 begin 将入口变为 takingOver，再清空 pi 队列和 abort；等待真实在途命令和 snapshot 屏障。等待时不存在人工输入 textarea；最终 human 时才开放。
2. 控制权变化拒绝原轮次的在途/排队操作，接管期间没有额外模型请求。原生专项另外启动真实 CLI wait，在 450ms 后杀掉 CLI 客户端，接管仍需等待 daemon 剩余工作及 snapshot；实际等待超过 1200ms。
3. 人工通过等比例缩放画面点击真实 Chrome 字段，Control+A 选择原文字，提交 composition 中文「人工中文」并粘贴「粘贴」。交还先 flush 输入，原生逐条等待 Chrome 的 CDP 应答后才确认。
4. 交还成为 AI 状态但不自动调用模型，标记 requiresSnapshot。扩展与原生同时拒绝 snapshot 前的页面操作。点击「继续浏览任务」发起新 pi 轮次；mock 模型先请求真实 snapshot，确认其中出现人工输入，再使用新引用点击并核对「完成：人工中文粘贴」。开发版和 tauri.localhost release 都通过。
5. composer「停止生成」与面板「停止任务」均验证最终 stopped，页面与 generation 保留；面板「关闭浏览器」验证 closed，收起则仅释放观看/输入连接，保留 human 状态。
6. 真实工具详情可展开具体动作、终态和元数据，截图可打开图片预览；fill UI 显示「填写内容已隐藏」。截图和元数据采用同一 parseBlocks 历史解析，并有回归测试。

### 检查结果

| 检查 | 结果 |
| --- | --- |
| `npm test` | 395 项通过：新增坐标、元数据/截图恢复、交还 snapshot 门禁回归 |
| `npm run build` | TypeScript/Vite 通过；最终 release 入口重新构建最新前端 |
| `npm run check:ui` | 通过 |
| `npm run test:styles` | 0 样式错误、0 对比度失败；生成报告未保留 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --include-ignored` | 74 项通过，含 3 个真实浏览器集成测试 |
| `node tests/browser-control.browser.mjs` | 明暗主题、600×400、等待确认/失败不开输入、缩放坐标、滚轮、组合键/blur 松键、IME/paste、flush/交还/明确续跑、停止/关闭通过 |
| `node tests/browser-panel.browser.mjs` / `node tests/browser-settings.browser.mjs` | 观看、草稿、两聊天切换、故障与设置回归通过 |
| debug 二进制的 `tests/app.cdp.mjs --browser-tools` | 最新产品 UI → Rust → 真实 pi → Chrome 接管及续跑、截图详情、停止/关闭、B/D 回归通过 |
| `node tests/browser-native.release.mjs --browser-tools` | 正式来源下相同接管/人工输入/续跑和正常窗口退出清理通过 |

输入确认已从上游 stream ping/pong 改为 Rust 直接等待该托管 Chrome 的 CDP Input 应答。每条输入仍受 human/controlVersion 门禁与字段/大小/速率限制，不开放任意 CDP 方法。失焦、交还、连接关闭和浏览器关闭均释放临时按键/鼠标状态；人工文本不进入 reducer、聊天或 localStorage。没有把人工输入写成工具日志；AI fill 自己的参数仍沿用 pi transcript 语义，UI 隐藏不等于删除原始 transcript。

调试中真实浏览器大集成测试增大 async future 后触发 Windows 默认测试线程栈溢出，已将新增「CLI 退出后排空」抽为独立测试并装箱控制转换 future；最终完整 74 项测试通过。早期失败测试的隔离目录可能保留，检查其 owned.json 已为空且对应 Chrome 主进程已不在运行；没有触碰用户日常 Chrome。

证据：`dist/cdp-browser-control.png`、`dist/cdp-browser-panel.png`、`dist/cdp-dev.log`；mock 的 `dist/browser-control/light-human.png`、`dark-human.png`、`light-narrow.png`、`dark-narrow.png`。已目视检查桌面浅色、窄窗深色以及真实提交结果截图。生成文件均忽略，不提交。

最终开发版还原 0 个 localStorage 键，release 还原 8 个键，均保留 finally 还原及 8 秒刷盘等待，并在正常关闭窗口后确认 daemon 与 owned.json 清理。没有调用真实模型或登录站点。

### E 交付边界

中文 composition 与 paste 提交通过实际 WebView2/Chrome 全链路，但实体中文输入法的系统候选窗和系统剪贴板手工操作未做设备验收。首版仍为单受控页面、Windows、agent-browser 0.41.2；网页自身的异步请求不承诺因接管而撤销。归档/删除/恢复、profile 保留及完整多聊天生命周期由 F 继续验收。

E 已完成，按阶段约定等待用户消息再进入 F。

## F · 多聊天、归档与恢复清理

### 可重复入口

```powershell
# 独立 mock 预览：先运行 npm run dev -- --port 1421
node tests/browser-lifecycle.browser.mjs

# 完整真实链路：空闲 1420 / 9222
npm run test:cdp -- --browser-lifecycle
node tests/browser-native.release.mjs --browser-lifecycle

# 原生真实 profile 与恢复测试
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --include-ignored
```

本机已有用户开发服务占用 1420，因此 debug 验证通过 `SKIFF_CDP_BINARY` 指定最新 debug exe，由 harness 复制到临时目录运行；不停止用户开发服务。实际 WebView2 命令行的 user-data-dir 在本轮临时目录内才进行 seeding，pi 和 browser data 另用临时目录。release 使用已有隔离构建入口及 tauri.localhost 来源。

### 真实双聊天验证

本地 mock 模型为 A/B 两个真实 pi 分别生成 browser 操作，两个进程在同一聊天运行池内运行。测试明确断言 B 开始时 A 的 6 秒 wait 尚未结束，避免把顺序执行算作并行。A/B 分别访问本地站点设置持久 `owner=A` / `owner=B` cookie；snapshot 返回的 cookie 必须匹配所属聊天，模型请求和工具终态互不混入。

切换到 B 后让 A 在后台完成，再返回 A，产品面板的 chatId/generation 与实际服务一致。接管 A 后切到 B，B 仍为 AI 控制且没有人工输入层，A 保持 human。整页 reload 后，pi 重连及旧凭据失效，两个浏览器均保持原 generation；新轮次先 snapshot 才能继续，页面不会因重连被意外重开。

通过实际侧栏菜单归档 A 后，`browser_find(A)` 为 null、A 的 profile 仍存在、B 的 generation 不变。实际设置页恢复 A 后仍无浏览器，显式发出 open 后新 generation 启动并恢复 `owner=A`。永久删除 A 后只移除 A 的 SHA-256 profile，B 的 profile、cookie 和 generation 均保留。随后完成原生双实例回归与普通 pi 聊天，正常关闭窗口确认 daemon 和 owned.json 清理。

### 原生与 mock 覆盖

- 原生新测试验证：归档撤销租约、retired 拒绝新启动与授权、恢复不启动实例、持久 cookie 保留、删除后 cookie 清空且另一 profile 不变、并发 close/start 等待旧 profile owner 退出、启动未完成时 retire 等待并回收、恢复后不自动重放旧操作。
- profile 删除测试用含 `../../` 的聊天 ID 仍只生成哈希目录，保护其他聊天目录和父目录哨兵；被普通文件替换的 profile 被拒绝删除，错误可重试。生产代码同时拒绝符号链接和规范化父路径不匹配，不接收外部文件路径。
- 异常恢复在临时 service root 上模拟系统租约释放，新 Service 核验并回收旧 daemon，再显式重开页面；已通过正常关闭确认落盘的 cookie 能恢复，两个 profile 仍隔离。原 B 测试继续覆盖 PID 身份不匹配拒绝回收、另一活跃 owner 的租约阻止回收、daemon/Chrome 崩溃和短 idle 退出。
- 双主题 mock 验证 A 的 pending takeover 不锁住 B 的接管按钮，A 的迟到状态不污染 B；回收失败保留聊天索引并显示错误，重试成功后归档；回收尚未确认时索引保留且输入框发送禁用，防止处理中插入新轮次；恢复清除旧面板且不启动浏览器，删除归档传递 deleteProfile=true，B 保留。
- 批量侧栏回归通过，新的异步归档/删除逐项 await，避免只回收首项。普通观看、接管/交还和设置预览回归继续通过。

### 检查结果

| 检查 | 结果 |
| --- | --- |
| `npm test` | 395 项通过 |
| `npm run build` / 最终 release 前端构建 | TypeScript、Vite 通过 |
| `npm run check:ui` | 通过 |
| `npm run test:styles` | 0 样式错误、0 对比度失败；生成报告不保留 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --include-ignored` | 76 项通过；新增异常 cookie 恢复检查后原生 lifecycle 专项最终 2 项也通过 |
| `node tests/browser-lifecycle.browser.mjs` | 浅色/深色下独立 pending 操作、归档失败/重试、懒恢复与删除范围通过 |
| `node tests/browser-control.browser.mjs` / `browser-panel.browser.mjs` | 人工控制、后台释放、实例切换、草稿和面板回归通过 |
| `sidebar-bulk.browser.mjs`（项目本地 Playwright） | 批量归档/两种删除及运行中禁用回归通过 |
| debug 的 `tests/app.cdp.mjs --browser-lifecycle` | 两个真实 pi 并行、cookie、重连、归档/恢复/删除、普通聊天及退出清理通过 |
| `node tests/browser-native.release.mjs --browser-lifecycle` | 实际 release 来源下同一完整生命周期流程通过 |

旧 `sidebar-archive.browser.mjs` 在本轮尝试时暴露过时断言：不接受已有归档预览的只读 get_entries 请求，后续还假设旧模型 route ID 与已移除的模型分类 UI。未把它计作通过，未保留为迁就断言而修改测试的临时改动；当前归档行为由新的两主题 lifecycle 流程、bulk 流程与真实桌面流程覆盖。

本地证据：`dist/cdp-browser-lifecycle.png` 与 `dist/cdp-dev.log`。所有生成产物在 dist 内，不提交。debug 最终存储还原 0 个键；release 首轮还原 0 个键，最终轮快照为 7 个键，均在实际命令行目录检查后操作，并沿用 finally 还原、8 秒刷盘等待及正常窗口关闭清理。未使用真实模型、账户或日常 Chrome。

### 恢复边界

正常关闭与归档保留聊天 profile；删除清理其专用 profile。异常退出只能恢复已落盘的数据，崩溃前尚未写入磁盘的 cookie 可能丢失。DOM、网页脚本内存、页面加载进度、人工焦点与旧元素引用不保证恢复；重开后需要打开网页并读新 snapshot。浏览器/profile 与 transcript 清理是顺序操作，失败时索引保留供重试，已成功删除的资源不回滚。

F 已完成，按阶段约定等待用户消息再进入 G 最终汇总验收。

## G · 最终验收与交付

### 结论与基线

2026-11-09 最终验收通过，交付范围为 Windows x64 / WebView2、agent-browser **0.41.2**、单聊天单受控页面。使用本机已有 Chrome for Testing；未重新下载依赖、访问真实登录站点或调用真实模型。最终代码在开发版及实际 `http://tauri.localhost` 的 release 可执行文件下通过工具与生命周期完整链路。

G1–G5 沿用并审查 A–F 已落地的测试：前端状态/帧释放/坐标与历史恢复测试、原生服务/租约/生命周期测试、4 个浏览器 mock UI 脚本，以及 `--browser-tools` / `--browser-lifecycle` 两个真实 pi 流程。最终阶段额外补强了 `tests/browser-tools.cdp.mjs` 的动态 DOM、页面错误、真实超时与故障关闭回归。

### 本轮新增验收及修复

本地动态站点在点击 300ms 后替换整段 DOM。真实 pi 必须先等待、重新 snapshot，确认旧按钮消失和新按钮出现，再以新引用提交，最后 snapshot 核对结果。测试分别验证无效选择器和不存在元素返回实际页面失败，不把失败调用当作成功。

本地延迟导航 25 秒，超过原生 20 秒执行上限，触发真正的不确定超时。测试确认 pi 收到超时、工具详情显示“超时”、原生状态为 `faulted`，后续操作入口关闭；再通过实际“关闭并重新准备”按钮确认资源关闭和聊天重连。超时不承诺撤销已发出的导航或网页异步行为。

这个用例发现并修复了一个错误：`execute_checked` 将不确定执行结果失效为 `faulted` 时会递增 `controlVersion`，随后通用版本检查把真实超时覆盖成“操作已中止”。现在失效后直接返回原始执行错误，保留 timeout 终态，同时继续关闭操作入口。新增真实 pi / Rust / Chrome 回归已在最终 debug 和 release 下通过；修复后完整 Rust 76 项测试和 cargo check 再次通过。

调试过程中没有把失败轮次记为通过：0.41.2 对缺失元素返回 `Element not found`，并非等待超时；最终以延迟导航触发原生执行超时。失败 UI 断言限定到本轮工具，避免历史折叠/更新影响数量。所有失败轮次也执行 localStorage 恢复、8 秒刷盘等待及正常窗口关闭兜底清理。

### 执行结果

| 检查 | 最终结果 |
| --- | --- |
| `npm test` | 395 通过，0 失败、0 跳过 |
| `npm run build` | TypeScript 和 Vite 生产构建通过 |
| `npm run check:ui` | 通过 |
| `npm run test:styles` | 233 tokens、126 对比度组合，0 样式错误、0 对比度失败；生成报告还原 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 修复后通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --include-ignored` | 修复后 76 通过，0 失败、0 ignored，含真实 Chrome 集成 |
| `node tests/browser-panel.browser.mjs` | 明暗主题、600×400、草稿/面板切换、后台释放、迟到查询、断连/重开、依赖指引均通过 |
| `node tests/browser-settings.browser.mjs` | 明暗主题、键盘切换、设置持久化/重连、600×400 通过 |
| `node tests/browser-control.browser.mjs` | 两阶段接管、坐标/留白、鼠标/滚轮、键盘/松键、composition/paste、flush/交还/续跑、停止/关闭均通过 |
| `node tests/browser-lifecycle.browser.mjs` | 两主题下并行控制、归档失败/重试、懒恢复和删除范围通过 |
| `sidebar-bulk.browser.mjs` | 使用项目本地 Playwright 和 localhost:1421 参数后通过批量选择、运行中禁用、归档及两种删除 |
| debug `tests/app.cdp.mjs --browser-tools` | 最终修复后的真实画面、8 类工具、中文接管/交还/续跑、动态 DOM、页面错误/超时、故障关闭、普通聊天和正常退出回收通过 |
| debug `tests/app.cdp.mjs --browser-lifecycle` | 真实双 pi 并行、独立 cookie/页面/控制权、重连、归档/恢复/删除及退出清理通过 |
| release `tests/app.cdp.mjs --browser-tools` | 最终 release 来源下同一完整工具/接管/动态页面流程通过 |
| release `tests/app.cdp.mjs --browser-lifecycle` | 最终 release 来源下同一多聊天生命周期流程通过 |

本机 1420 被已有开发服务占用，直接 `npm run test:cdp -- --browser-tools` 的首轮因 Vite 端口冲突未完成，未算通过。最终 debug 按 harness 已有 `SKIFF_CDP_BINARY` 支持复制最新 exe 到临时目录运行，前端使用现有 Vite；没有停止用户服务。`sidebar-bulk` 初次运行缺少根目录 playwright 包，随后默认 127.0.0.1 地址也无法连接只监听 localhost 的 Vite；使用已安装的项目本地 playwright-core 和脚本原有 origin 参数后通过，没有新增根依赖。

Release 首先用 `node tests/browser-native.release.mjs --browser-tools` 和 `--browser-lifecycle` 验证构建/来源；超时修复后按同一 wrapper 的 TAURI_CONFIG 和 `tauri/devtools,tauri/custom-protocol` 特性重新构建 release，再对最新二进制直接运行两个 CDP 流程。没有修改生产 tauri.conf.json。前端没有随本轮 Rust 修复改变。

### 最终矩阵与证据

| 场景 | 结果与主要证据 |
| --- | --- |
| 首次使用 | 通过；默认关闭、缺依赖安装命令/路径/重检，普通 pi 回归通过 |
| AI 浏览 | 通过；真实 pi 8 类工具和模型读取结果，canvas 有效像素来自同一 Chrome |
| 动态页面 | 通过；DOM 替换后新 snapshot / 引用，两个选择器失败及导航超时终态 |
| 人工接管 | 通过；在途 wait 和排队操作排空前无人工输入层，pi 轮次中断 |
| 交还继续 | 通过；输入确认、requiresSnapshot 双重门禁、新轮次核对人工中文并提交 |
| 停止与关闭 | 通过；两种停止、面板收起保留任务、故障准备关闭及正常退出回收 |
| 多聊天 | 通过；真实双 pi 并行、cookie/画面/控制权隔离，迟到结果不覆盖另一聊天 |
| 异常恢复 | 通过；原生测试覆盖 Chrome/daemon 崩溃、短 idle、PID 身份与异常回收、快速重开；mock 覆盖断流；真实链路覆盖 pi 重连和故障关闭 |
| 布局与主题 | 通过；两主题、600×400、键盘、等比例坐标、composition/paste，截图目视检查；实体 IME 边界见下 |
| 正式包 | release 可执行文件通过；实际 tauri.localhost 画面转发和接管续跑；未验证安装器 |
| 数据保留 | 通过；专用 profile/cookie、删除范围、目录哨兵、临时 pi/WebView2、localStorage 恢复与正常退出 |

本地截图已目视检查：`dist/browser-panel/{light,dark}.png`、`dist/browser-control/dark-narrow.png`、`dist/browser-panel/missing-dependency.png`，以及真实 CDP 的人工中文提交、动态错误/超时截图。最终证据保留在 `dist/agent-browser-acceptance/`：debug/release 的 `*-dynamic.png`、`*-control.png`、release 的 `release-panel.png`、`release-lifecycle.png` 和对应运行日志。常规输出仍为 `dist/cdp-browser-*.png` 与 `dist/cdp-dev.log`，会被下一轮覆盖。生成产物均忽略，不提交。

每次浏览器专项在写入 localStorage 前检查真实 WebView2 命令行的 user-data-dir 位于本轮临时目录，使用独立 PI_CODING_AGENT_DIR、SKIFF_BROWSER_DATA_DIR、本地 mock 模型与测试页面。最终 debug 工具及生命周期各快照/恢复 0 个键，最终 release 工具为 7 个键、生命周期为 8 个键；都保留 finally 恢复、8 秒刷盘等待及正常窗口关闭后的 daemon/owned.json 断言。恢复键数受临时 release 初始化影响，不能代替实际目录核验。验收自启的 1421 Vite 服务已停止，原有 1420 开发服务保留。

### 安装与复现

开发和运行基线安装：

```powershell
npm install -g agent-browser@0.41.2
agent-browser install
agent-browser --version
```

在 Skiff 的“设置 → AI 浏览器”重新检测依赖；默认关闭，开启后自动重连当前聊天，其他已有聊天下次重连生效。首次 open 才启动 Chrome。可在无运行浏览器时保存 CLI 路径；留空自动查找。安装需要 Node.js，本轮使用 24.19.0。

复现 mock UI：先运行 `npm run dev -- --port 1421`，再逐一执行上表 4 个浏览器脚本。批量侧栏入口为：

```powershell
$env:SKIFF_PLAYWRIGHT_DIR = (Resolve-Path '.playwright-cli/node_modules/playwright-core').Path
node tests/sidebar-bulk.browser.mjs http://localhost:1421
```

1420/9222 空闲时可直接运行 `npm run test:cdp -- --browser-tools` 和 `--browser-lifecycle`；1420 已有本仓库开发服务时，先 `cargo build --manifest-path src-tauri/Cargo.toml --no-default-features`，再设置 `$env:SKIFF_CDP_BINARY = (Resolve-Path 'src-tauri/target/debug/skiff-desktop.exe').Path` 执行相同入口。每个 CDP 流程独占 9222，不能同时运行。正式来源完整复现用 `node tests/browser-native.release.mjs --browser-tools` / `--browser-lifecycle`，无需修改产品配置。

### 未覆盖与交付限制

- 未进行实体中文输入法候选窗、系统剪贴板的人工设备验收；实际 WebView2 的 composition/paste 事件到真实 Chrome 的中文结果已验证。
- 未验证 macOS/Linux、Windows 安装器安装/升级/卸载或干净系统的全新依赖下载。此次验证的是实际 Windows release 可执行文件及来源；不能据此扩大平台支持。
- 默认一小时 idle 未等待整小时，使用短 idle 机制验证；异常恢复只保证已落盘 profile 数据，不保证崩溃前未落盘 cookie、DOM 或页面内存。
- 多标签管理、文件上传/下载、共享用户日常浏览器、真实登录/支付网站与真实模型自主规划不在本次首版验收范围；本地 mock 模型只决定确定性工具调用，真实 pi、Rust、agent-browser、Chrome 与 WebView2 全部参与。
- 旧 `sidebar-archive.browser.mjs` 的过时断言仍按 F 节记录，不算通过；本功能归档/恢复/删除由新的双主题 lifecycle、bulk、真实 CDP 和原生测试覆盖。

G1–G7 已完成，M4 交付验收通过。

### 2026-11-11：关闭实例后直接重开

修正手动关闭浏览器同时撤销 pi 工具凭据的问题：关闭仍取消待执行请求、结束当前 generation 并保留 profile，但保留当前 pi 的浏览器能力。只有携带关闭后最新 generation/controlVersion 的显式 open 才能创建新实例；关闭前的迟到 open 和关闭后的 snapshot 均不能隐式启动浏览器。禁用、归档、删除及 pi 重连仍撤销原凭据。关闭态移除“重新连接聊天”按钮，说明直接让 AI 再次打开网页。

验证结果：

- `npm test`：406/406；浏览器扩展覆盖关闭后工具保留、禁止 snapshot 隐式重开、显式 open 后绑定新实例。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`：75 通过、4 项需要真实浏览器的测试保持忽略；新增原生测试验证凭据仍可认证、取消排队请求及拒绝关闭前的迟到 open。
- `npm run build`、`npm run check:ui`、`npm run test:styles` 通过；样式审计与对比度检查均为 0 错误。
- `browser-control.browser.mjs`、`browser-panel.browser.mjs` 深浅主题通过；关闭态截图位于 `dist/browser-control/{light,dark}-closed.png`。
- `node tests/browser-native.release.mjs --browser-lifecycle` 通过真实 release WebView2 → Tauri → Rust → pi → agent-browser → Chrome。新增步骤点击真实“关闭浏览器”，无需重连同一 pi 即可再次 open；模型请求仍包含 browser，新 generation 恢复原聊天的 Cookie，另一聊天的 generation 不变。后续原有接管、重连、归档、恢复和删除回归同样通过。

全链路使用临时 pi、浏览器 profile 和 WebView2 数据目录，已在写入测试工作区前核验实际 user-data-dir，并保留 localStorage 快照、finally 还原与刷盘等待。没有调用远程业务系统或真实模型。
