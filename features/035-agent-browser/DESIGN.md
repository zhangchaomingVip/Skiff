# 035 · AI 浏览器技术基线与设计

阶段：A–G 完成，Windows 首版最终验收通过。日期：2026-11-09。最终检查、修复与未覆盖项见 [verification.md](verification.md) 的 G 节。

## 结论

当前 Windows 环境可用 agent-browser 实现「AI 操作独立 Chrome、Skiff 内观看、人工输入」。已通过真实 CLI、Vite 页面、独立 Tauri release WebView2 和真实 pi 的隔离实验。

正式环境需要画面转发，接管需要服务端控制权屏障。不能直接复制开发环境的 WebSocket 地址，也不能把 HTTP 请求中止或 CLI 退出当作浏览器命令取消。

A 阶段新增隔离实验；B 阶段接入生产原生服务和 Tauri 命令；C 阶段接入 pi 正式工具与能力设置；D 阶段接入实时浏览器面板；E 阶段接入人工输入、接管/交还及操作记录；F 阶段接入多聊天与归档/删除生命周期。

## 固定版本与启动

| 项目 | 验证基线 |
| --- | --- |
| 系统 | Windows x64，WebView2 |
| Node.js | 24.19.0；用于安装、测试和 pi |
| agent-browser | **0.41.2**；实验脚本拒绝其他版本，升级后重新验证 |
| 浏览器 | CLI 已安装的 Chrome for Testing 157.0.8103.38 |
| 桌面框架 | 复用仓库锁定的 Tauri 2.12.1 / tauri-build 2.7.1 |
| 前端验证 | Vite `http://localhost:1421`；实验页面，不启动模型请求 |

Windows 开发安装方式：

```powershell
npm install -g agent-browser@0.41.2
agent-browser install
agent-browser --version
```

本次本机已有 CLI 和浏览器，没有执行全局升级或重新下载。npm 包内 Windows 原生可执行文件为 `bin/agent-browser-win32-x64.exe`，本机 Chrome 位于 `%USERPROFILE%\.agent-browser\browsers\chrome-157.0.8103.38\chrome.exe`。这些是发现结果，产品不能硬编码用户目录或 Chrome 版本路径。

生产服务优先直接执行原生 exe；若用户配置 npm 启动器，按已有 pi 启动器解析的方式识别，避免把带空格的参数拼入 `cmd /C`。安装需要 Node，原生 CLI 本身不需要额外启动 Node。

每个运行实例生成内部 session / namespace 标识，并为聊天使用专用 profile。实验使用随机 namespace、临时 profile 和显式空配置文件；同时清除继承的 `AGENT_BROWSER_*` 及代理变量，避免读取用户默认会话或接管用户浏览器。生产需同样明确选择托管配置，不能继承 auto-connect、provider、任意 init script 等隐含启动选项。

## 实验覆盖与观察

### 命令及结构化结果

已验证 open → snapshot → fill → click → snapshot，使用本地表单和 snapshot 返回的 `@eN` 引用。填写中文后点击，页面实际结果改变。

0.41.2 常用 JSON 返回结构：

```json
{
  "success": true,
  "data": {
    "snapshot": "页面结构文本",
    "refs": { "e3": { "name": "姓名", "role": "textbox" } }
  },
  "error": null
}
```

`data` 常带 `lifecycle`、`origin` 等字段，不适合未经筛选全部传入模型。找不到目标的操作实测返回 `success: false`、`data: null` 和错误文本。适配层必须同时检查退出码、JSON 解析和 `success`，不能以「进程结束」判定操作成功。

### 实时画面和输入

- `stream status --json` 可发现随机端口，以及 enabled、connected、screencasting。未连接观看端时 screencasting 可以为 false，不能误报故障。
- 画面为 WebSocket `frame` 事件，携带 JPEG 数据、递增 seq 和 viewport metadata；渲染后发送相应 ack，限制每客户端帧率为 10 FPS。
- 实测页面 URL 事件包含 History API 的 `#done` 更新。重连时需要主动读取当前 URL，不能仅依赖事件历史。
- Vite 页面接收到真实帧；观看端的鼠标按下/松开实际聚焦页面输入框，逐字符 `char` 键盘事件成功输入中文。
- 单条 `char` 携带整个中文字符串的初次实验未生效；逐 Unicode 字符发送成功。后续 E 阶段必须单独验证实体 IME、组合输入、粘贴、快捷键和失焦释放，本阶段不据此宣称完整输入法支持。
- 独立 release WebView2 显示真实浏览器画面，通过缩放后的 canvas 点击表单按钮，并用 CLI 读取页面结果核对。

### 来源限制与正式构建

| 连接来源 | 实测握手 |
| --- | --- |
| `http://127.0.0.1:<测试端口>` | 101，可直接观看 |
| `http://localhost:1421` | 101，Vite 实际页面收帧通过 |
| `http://tauri.localhost` | 403，release 实际页面直连失败 |
| `tauri://localhost` | 101，仅原始握手测试，未验证其他操作系统 |

已编译开启 `custom-protocol` 的独立 release 探针，实际页面来源确认是 `http://tauri.localhost`，经限定来源的本机 WebSocket 转发后收帧和点击通过。探针具备 release 下的 CDP 调试能力，仅供测试；不改变 Skiff 产品构建选项。

**采用方案：Rust 浏览器服务提供受控的本机转发端点。** React 不直接连接上游流端口。转发必须透传画面 ack，不能在接收到帧时提前代替渲染端 ack。人工输入经过同一服务的控制权校验。

本阶段使用 Node TCP 转发验证底层协议可行性；生产转发属于 B 阶段，仍需实现实例鉴权、输入过滤、限流、监听清理及来源校验。它不是可以原样搬进产品的通用代理。不能以放开所有 Origin 或加载远程页面到有 IPC 权限的 WebView 替代。

### 命名会话、空闲退出及关闭

实验使用 `main` 与 `idle` 两个命名 session，各自独立 profile 和 daemon。`idle` 设置显式 1500ms 超时后从会话列表消失，`main` 仍在；显式 close 及临时 profile 清理通过。

服务必须容忍端口随 daemon 重启变化，绑定运行实例而不是缓存固定端口。产品可沿用上游默认一小时空闲退出，但要将空闲退出映射成可重开的状态；不能把「上一轮完成后保留页面」理解为永久常驻。

## pi 到 Rust 的桥接与取消

使用临时 `PI_CODING_AGENT_DIR`、本地 SSE 模型服务和临时 pi 扩展，验证以下真实链路：

```text
pi 工具 → 带实例凭据的本机 HTTP 请求 → Rust → 原生 CLI → Chrome snapshot
           ←                   工具结果                ←
```

Rust 端对缺少凭据的请求实测返回 401。snapshot 返回到 pi 工具结果后，本地模型完成下一次响应。本阶段的最小 Rust 服务只用于验证通信，并未实现生产命令队列和所有权状态机。

取消实验有两个明确结果：

1. 发送真实 pi RPC `abort` 后返回成功，扩展的 fetch 使用 AbortSignal 结束，但 Rust 正在执行的命令仍然 active。中止 HTTP 客户端不会自动通知服务终止工作。
2. 对 CLI 发出 `wait 2500`，350ms 后杀掉 CLI 客户端，再发 snapshot，后续命令仍被 daemon 阻塞约 2.18 秒。**CLI 已退出，daemon 内命令仍在继续。**

实验另用显式 `/cancel` 结束 Rust 持有的 CLI 客户端，并观察服务 active 归零。这个结果只证明客户端进程可回收，不证明 daemon 内动作已取消。

### 接管和停止的实施决定

pi 当前有 abort，没有本阶段已验证的暂停/恢复协议。首版接管使用中断当前 pi 轮次；交还后读取新 snapshot，使用明确的续跑请求启动下一轮。

建议状态转换：

```text
AI 控制 → 正在接管 → 人工控制 → 正在交还 → AI 控制
                ↘ 操作未结束 / 连接故障
```

「正在接管」必须按顺序执行：

1. 服务先关闭该运行实例的新 AI 请求入口，移除尚未发出的队列，递增控制权版本。
2. 中断 pi 当前轮次，并以独立取消协议通知浏览器服务回收客户端等待；取消请求不能排在正在执行的命令后面。
3. 等待上游 daemon 内已有动作结束。优先等待原请求真实终态；若客户端已退出，使用同一 session 的只读 snapshot 作为排空屏障，并设置截止时间。
4. 排空完成后读取新状态并开放人工输入。屏障失败时显示故障及重新打开选项，不能提前标记「已接管」。重建可能丢失页面运行状态，要明确告知。

排空前已经发出的动作可能实际发生，界面不承诺撤销。「停止」采用同样的底层排空规则，保留页面。浏览器接管、关闭及交还时的异步结果都要校验实例和控制权版本。

B 阶段必须进一步验证排空覆盖范围和故障恢复，尤其是导航、点击后的异步页面动作与长等待；snapshot 屏障只能证明命令处理已越过原请求，不能撤销站点自身已经启动的定时器或网络请求。

## 后续接口边界

生产接口名称可随实现调整，必要语义如下：

| 入口 | 所需语义 |
| --- | --- |
| 依赖查询 | CLI 来源、精确版本、安装状态、可理解的失败原因 |
| 启动/查询 | chatId + generation，返回实际连接与控制权状态 |
| 扩展命令 | 服务签发的实例凭据、requestId、结构化动作和参数；不接收自由 shell |
| 取消 | 独立通道，按 requestId / 控制权版本取消队列及等待，终态与浏览器排空分开 |
| 接管/交还 | 服务端状态转换，返回已生效的版本；交还后重新 snapshot |
| 观看/输入 | 绑定 chatId / generation；画面丢旧保新；输入仅人工控制期有效 |
| 关闭 | 仅回收该聊天拥有的 daemon、Chrome、观看连接和队列 |

实时帧不存入聊天 reducer 或 localStorage。工具结果与操作终态保留现有 pi 会话历史语义；页面文本、执行详情和截图按需进入模型上下文。

## A 阶段的验证边界

- A 阶段验证的是隔离 Tauri release 探针；生产原生转发和实际 Skiff 窗口的后续结果见下方 B 阶段记录。
- 同系统其他进程和拥有任意 shell 的代理不形成操作系统级隔离。接管依赖中断当前代理轮次和托管服务控制权，不能宣称上游 CLI 自带不可绕过的独占锁。
- 多聊天并行操作、cookie / profile 恢复、崩溃回收、上传下载、实体中文输入法、完整双主题和产品 UI 回归在后续对应阶段验收。
- 默认空闲一小时没有等待整小时；通过显式短超时验证退出机制。
- 非 Windows 平台及安装器打包未验证；Windows release 可执行文件已验证。

## B 阶段落地

### 模块与接口

- `src-tauri/src/browser/mod.rs`：服务、每聊天实例、控制权状态、队列和 Tauri 命令。
- `runtime.rs`：CLI 探测、受控环境、参数执行、输出/时间限制、Windows 进程身份和句柄。
- `bridge.rs`：仅 loopback 监听的 HTTP 命令/取消接口，以及 WebSocket 画面/输入转发。
- `src/browser/native.ts`：前端类型与调用契约；尚无产品面板或设置入口。

Tauri 命令为 `browser_dependencies`、`browser_configure`、`browser_start`、`browser_find`、`browser_status`、`browser_connection`、`browser_control`、`browser_close`。连接信息只通过显式连接命令提供，普通状态不含凭据。

服务按需初始化，不在启动 pi 时创建浏览器。数据目录默认在应用数据目录的 `browser/`；测试可用绝对路径 `SKIFF_BROWSER_DATA_DIR` 隔离。`settings.json` 只保存可选 CLI 路径；也可用 `SKIFF_AGENT_BROWSER_PATH` 指定原生 CLI。profile 名使用聊天 ID 的 SHA-256，实例目录和命名 session 使用随机 generation，不接受模型自选目录。

### 命令和取消的最终选择

上游 0.41.2 并不把 fill 中的 `--` 当作标准参数终止符：实测它被填进输入框。因此页面操作使用 `batch --json --bail --omit-command`，通过 stdin 传入单条 JSON 参数数组。批次结果的正文键是 `result`，与普通命令的 `data` 不同。测试覆盖中文、shell 特殊字符及精确等于 `--headed` 的填写内容。

每个实例最多排队 32 项、保留最多 4096 个请求标识；同一标识重复请求被拒绝。stdout/stderr 分别限制 4 MiB；一般操作外层限时 20 秒，单次 wait 最多 10 秒。结构化页面失败与执行结果不确定分别处理，后者关闭操作入口，要求关闭重开。

相较 A 阶段的候选方案，B **保留在途 CLI 等待其真实终态**，不在普通取消时杀客户端。HTTP 请求本身即使断开，服务端操作任务仍持有串行锁。独立取消接口立即关闭 AI 入口、失效排队任务，并异步等待原操作及 snapshot 屏障；完成后才进入 stopped。控制权转换同样等待排空，期间不会开放人工输入。

人工输入必须携带当前 controlVersion，只有 human 状态可发送；输入在同一上游流上完成 ping/pong 往返后才释放控制权转换锁，避免交还越过尚在上游读取队列中的输入。这个屏障确认事件已被上游接收，不承诺网页脚本或网络请求全部完成，续跑仍必须读取最新页面。

### 转发和资源归属

生产转发校验精确 Origin 和随机观看凭据；AI 命令另用独立 bearer 凭据，拒绝来自浏览器 Origin 的 HTTP 命令请求。两类凭据不能交叉使用。HTTP 正文和客户端 WS 消息最大 64 KiB，观看连接每实例最多两个，输入每秒最多 240 条；画面强制 ack 模式及有限帧率，不代替渲染端确认。

仅转发画面、URL、状态、标签事件，不转发控制台或网络日志。转发不在应用 WebView 中执行远程页面。现有 capabilities 只允许 main 窗口且没有 remote 范围，保持原样；未添加通用 shell 或远程页面 IPC 能力。

运行目录持有系统文件锁，同数据目录的另一活跃服务不能触发残留回收。启动后记录 daemon PID、创建时间和规范化 exe 路径，并保留真实 Windows 进程句柄。异常重启只回收记录与实际身份一致的进程，拒绝 PID 复用；不按名称结束 Chrome。

关闭先调用上游 close，失败时使用已核实句柄回收自有 daemon，其拥有的 Chrome 由上游 Windows Job 回收；正常退出在窗口 Destroyed 回调中等待清理。生成的实例运行文件清理，聊天 profile 保留。Chrome 与 daemon 健康探测使用进程句柄和已发现 CDP 实例的只读版本端点，不通过可能自动重启 daemon 的 CLI 查询，因此空闲退出不会意外启动默认 profile。

### 阶段边界

B 已验证真实双聊天浏览器服务、请求隔离、中文输入、转发及正常退出。尚未注册产品 pi 浏览器工具，未在现有聊天运行池中实现自动绑定/归档/删除，也没有产品浏览器面板；这些继续由 C、D、E、F 完成。依赖状态和安装指引已具备接口，实际设置页展示留在 D。

下一步是 C 阶段 pi 浏览器工具；按用户要求，本阶段完成后等待新消息。

## C 阶段落地

### 工具加载与聊天归属

`rpc_start` 接收稳定的 `chatId`；每次启动 pi 时，Rust 根据浏览器能力设置签发进程租约，并把扩展写入当前 `PI_CODING_AGENT_DIR` 下的 `skiff-agent-browser.js`，通过现有 `--extension` 加载。保留系统提示词、搜索、家族扩展和现有供应商配置。

桥接 URL 和随机凭据通过 `SKIFF_BROWSER_RUNTIME` 环境传给 pi，不加入提示词、工具 schema 或操作结果。启动前清除继承的旧运行时变量。每个聊天的新租约撤销旧租约；pi 停止或 stdout 退出、关闭浏览器和禁用能力也会撤销租约。

租约只绑定聊天，不启动 Chrome。工具在第一次 `open` 时创建浏览器，随后绑定 generation；之后每次调用先读 context，再携带 generation、controlVersion 和独立 requestId 提交。关闭后的租约不能自动重开新实例执行旧点击；需要重新连接聊天。若浏览器已停止，则需要显式交还后继续；产品交互在 E 阶段提供。

### 操作与结果

一个 `browser` 工具支持 `open`、`snapshot`、`click`、`fill`、`press`、`scroll`、`wait`、`screenshot`。工具和 Rust 双重校验参数，不接受任意命令、端口或路径。说明要求使用最新 snapshot 的引用、核对操作结果，并把页面文字视为数据。

普通结果返回简洁文本，snapshot 最多返回 24000 字符。截图写入实例专用文件，由 Rust 校验 PNG、限制 3 MiB、读取并删除，再以图片内容交给 pi；实际模型需要视觉能力才能读取图片。`details.skiffBrowser` 保存 requestId、toolCallId、操作、目标、耗时、终态和浏览器状态；填写内容不进入目标元数据。pi 的 `tool_result` hook 将失败标记为 `isError`，避免页面失败显示为成功。

### 取消及设置

工具的 AbortSignal 和 75 秒外层等待上限都会在独立连接发出取消请求（3 秒请求超时）；取消可先于命令到达，服务保存该 ID 的取消标记。取消只结束工具等待，不承诺 daemon 立即结束，工具明确返回排空尚未确认。原生服务关闭 AI 入口、丢弃排队工作，并等待真实在途终态及 snapshot 屏障，完成后才成为 stopped。绑定目标后尚未注册队列的取消同样关闭入口；已完成请求的迟到取消不会停止新操作。

设置新增「AI 浏览器」开关，默认关闭，存于浏览器服务的 settings.json。保存后重连当前聊天；其他已有聊天在下次重连时应用开启配置。关闭时立即撤销所有租约，旧进程在下一次轮次检查或工具请求时移除可用工具；重新连接时不加载浏览器工具。关闭保留页面，不自动关闭 Chrome。完整依赖安装/路径设置界面仍留在 D。

### 验证边界

真实桌面流程覆盖从设置开关、pi 工具到实际 Chrome 表单，以及截图回传、人工控制拒绝和 composer abort 后的 stopped 状态。原生测试另覆盖旧凭据、请求去重、提前取消、重连和关闭失效。实时画面面板、人工输入 UI、交还后续跑及归档/删除生命周期继续由 D、E、F 完成。

C 完成后等待用户消息再进入 D。

## D 阶段落地

### 状态与布局

`src/browser/useBrowserPanel.ts` 按活动聊天保留面板是否展开、已观察的 generation 和最近状态；每秒串行调用 `browser_find`，不使用重叠轮询。切换聊天后返回新聊天自己的记录；旧查询的响应和旧流的回调必须同时通过聊天与实例校验。已有实例的 controlVersion 不能倒退，迟到的 starting 状态不能覆盖已运行状态。界面记录不进入聊天 reducer 或 localStorage。

首次观察到每个新 generation 时展开；同一实例被手动收起后，后续状态和操作不再次展开。收起或隐藏释放观看连接，保留浏览器与聊天。仅面板宽度写入 `skiff.browser.width`。打开浏览器时隐藏航行台，点击航行台可切回；两者不会同时挤压聊天。

`BrowserWorkspace` 以剩余聊天工作区宽度判断布局：至少 720px 时在右侧显示可调宽面板，聊天保留至少 368px；工作区不足或视口不超过 760px 时显示独立浏览器视图，聊天组件保留在隐藏容器中以保留草稿，按钮或 Escape 返回。窄窗自动收起导航抽屉，避免遮挡返回入口。手动打开将焦点放到面板，返回后恢复到标题栏浏览器按钮；桌面自动展开保持原有输入焦点。

### 画面处理

`viewer.ts` 通过 Tauri 查询实例连接，再连接 B 的 loopback WebSocket 转发。帧、URL 与 control 事件只作用于绑定的 chatId / generation；流不向模型或聊天历史传入内容。观看只发送 config 和 ack，不发送任何人工输入。

`LatestBrowserFrames` 最多同时保留一个解码任务和一个待解码最新帧，新的待解码帧替代旧帧；已解码但被更新的帧不绘制。JPEG 使用 `createImageBitmap` 解码，绘制后关闭 bitmap，前端绘制最多 10 FPS，并在绘制或丢弃后 ack。Canvas 使用等比例 contain，保留留白。消息、编码与像素数均有边界检查。

隐藏面板、切换聊天、切换工作区工具和文档进入后台时关闭 socket、取消定时器、清空待处理帧和 canvas；晚到的 bitmap 只释放，不再绘制。重开重新查询实例连接并只看当前帧。连接失败或上游断开时清空旧画面，显示失效状态，手动重新连接不会重复执行网页操作。15 秒内无法连接或拿到首帧时同样进入可重试状态。

### 依赖与故障

面板覆盖未启用、未开始、启动中、画面连接中、仅观看、人工控制、已停止、关闭中、已关闭、断连与故障。状态由原生服务确认；依赖检测不启动或下载浏览器。设置中新增依赖重检、可复制的固定版本安装命令和 CLI 路径配置；原生依赖状态区分实际解析路径 `cliPath` 与用户配置 `configuredCliPath`，清空后恢复自动查找。

画面断开可只重连观看连接；浏览器故障或进程断连提供「关闭并重新准备」，明确会丢失当前页面、保留聊天 profile。此动作先关闭服务实例并确认，再重连当前 pi；下一次 open 才启动新浏览器，失败不自动重放上一次动作。运行中的聊天禁止重新准备，避免把当前轮次强行变成恢复流程。停止/接管/交还和正常关闭浏览器的完整用户入口仍留在 E。

D 完成后等待用户消息再进入 E；归档/删除及完整多聊天生命周期仍由 F 验收。

## E 阶段落地

### 接管、交还与停止

新增 `browser_begin_control` 和 `browser_complete_control`。前者在原生输入锁内关闭 AI/人工输入入口并递增 controlVersion，后者在同一实例的操作队列排空并完成 snapshot 屏障后返回真实终态。原有 `browser_control` 保留组合入口供测试和既有调用。接管界面先 begin，再清空 pi 消息队列、取消对话并发出真实 abort；只有 pi 收束确认成功，才 complete 为 human。中途失败显示错误，保持 takingOver 或原生故障状态，不开放输入。工具自身的 abort 取消不会覆盖已在进行的人工接管。

交还先释放前端按键并发送输入 flush，收到原生确认后关闭人工入口；服务释放残留键/鼠标，再完成 snapshot 排空，进入 AI 控制并设置 `requiresSnapshot`。该标志由工具扩展和原生命令入口共同执行，第一次成功 snapshot 才清除，旧引用点击或填写不会执行。用户点击「继续浏览任务」发出一条明确的新轮次请求，要求以新 snapshot 开始。交还本身不自动调用模型。

「停止任务」先关闭浏览器入口，再中断 pi，最后等待原生排空为 stopped；composer 的停止也接入相同原生停止过程。无法确认浏览器停止时仍尝试中断 pi，但保留错误，不报告完整停止成功。「关闭浏览器」关闭入口、释放输入、撤销租约，回收该实例，同时中断当前 pi；收起面板则只销毁观看和输入订阅，保留页面与控制权。

### 人工输入确认

E 阶段修正 B 的输入确认边界：上游 WebSocket ping/pong 只能确认接收，不能证明其异步输入任务已完成。因此实时帧仍走 agent-browser stream，人工输入由 Rust 的 `input.rs` 连接该托管 Chrome 的 CDP，并逐条等待 `Input.dispatchMouseEvent`、`Input.dispatchKeyEvent` 或 `Input.insertText` 的实际应答。所有输入继续经过原生 human/controlVersion 门禁、字段过滤、大小和速率限制；不向前端提供 CDP 连接地址或任意执行接口。首版单受控页面按服务记录 URL 匹配当前 page target，保留备用 about:blank 时不选错页面。

输入与控制权转换共享原生输入锁。服务维护仅含待释放键/鼠标的临时状态，连接关闭、交还、停止、关闭浏览器时释放；输入失败进入 faulted，不继续假称可控。前端 flush 在相同输入 socket 中排在先前输入之后；原生顺序等待 CDP 回复后才回 input_ack，避免交还越过已发送但未完成的人工输入。确认代表 Chrome 接收并处理该输入命令，不承诺网页后续异步网络或定时器已结束。

画面覆盖一个透明 textarea 以接收真实键盘和 IME composition。坐标按 canvas contain 缩放减掉留白；留白点击不发给页面。鼠标移动和滚轮节流，键盘维护按下状态，blur 和组件卸载发送释放，人工模式退出后不再发送旧事件。文本以 Input.insertText 提交，composition 避免重复提交，粘贴作为单个有上限的文本命令处理（最多 16384 UTF-16 单元）。在画面中按 Escape 发给网页，焦点移到面板按钮后 Escape 仍可收起。剪贴板读取只来自用户触发的 paste 事件。

人工文本、密码不写入聊天状态、持久存储或操作日志；实时截图/后续 snapshot 仍按页面实际内容处理。AI 自己的 browser fill 参数属于 pi 原有工具历史语义，UI 仅隐藏其填写文字，不能宣称从 pi transcript 中抹除。

### 操作记录与验证

`parseBlocks` 保留受限的 `skiffBrowser` 元数据和最多一张 PNG 截图；不保留凭据或任意 details 字段。现有 ToolCallBlock 直接显示「打开网页」「填写字段」「点击元素」等动作，目标不含填写文字，详情含耗时、操作 ID 和终态；截图按需展开并复用图片放大组件。流式工具与历史恢复使用同一路解析。

真实 WebView2 和 release 均通过在途 wait 接管、缩放点击、Control+A、中文 composition、粘贴、交还确认、最新 snapshot 和新引用点击后的提交结果。Mock 覆盖等待/失败不开放输入、blur 松键、两主题和 600×400；原生覆盖旧版本拒绝、排队动作丢弃和 CLI 客户端退出后仍等待 daemon。实体中文输入法候选窗及系统剪贴板交互未进行人工设备验收；自动化测试使用 composition/paste 事件验证提交链路。

E 完成后等待用户消息再进入 F。

## F 阶段落地

### 多聊天与重连

沿用现有 `usePiSessions` 的独立运行池，每个 pi 通过稳定聊天 ID 取得自己的原生租约。`useBrowserActions` 将原来的单个操作锁改为每聊天锁，pending/error 也携带实例归属；A 正在接管时可切到 B 操作，A 的迟到结果只更新 A，不占用 B 或把控制权投影到 B。画面/人工输入继续只订阅当前聊天；后台 pi 和浏览器不因切换而停。

重连不关闭健康的现有浏览器；新进程替换旧租约，并对 AI 控制的页面设置 requiresSnapshot，防止从旧上下文直接点击。人工控制或 stopped 保留其实际状态。新 lease 不绑定旧关闭实例，旧凭据无法操作显式重开的新 generation。端口只在查询 connection 时读取，未把任何观看地址写入存储。

前端清理聊天面板记录会递增该聊天查询 epoch，清理前发出的查询即使迟到也不能把已归档/删除的页面重新装回。轮询与 stream 的归属检查、版本单调合并继续生效，旧 generation 的事件不能覆盖新运行实例。

### 归档、恢复与删除

原生新增 `browser_retire_chat(chatId, deleteProfile)` 和 `browser_restore_chat(chatId)`。retire 在注册锁内标记该聊天 retired，撤销全部关联 pi 租约，等待关闭该聊天的实例；若要求删除，再处理其 profile。retired 聊天拒绝新 start 和新租约，关闭期间迟到的启动只能完成回收。restore 只解除 retired 标记，不启动浏览器或恢复旧内存页面。

App 先完成原生回收，再更新 workspace 索引；归档保留 profile，恢复清空旧面板记录。删除归档记录/从侧栏删除清理其浏览器登录数据但沿用原有 pi transcript 保留语义；永久删除同时删除 transcript。项目永久删除逐个处理所属聊天，保留失败时的项目/聊天索引以供重试。浏览器/profile 删除和 transcript 删除是顺序操作，不构成跨文件事务，部分已成功的清理不会回滚。批量归档/删除改为逐项 await，避免异步回收只处理首项。

生命周期操作期间阻止重复导航/删除，错误在工作区显示。原生 profile 路径只由 chatId 的 SHA-256 构造为专用 profiles 目录的直接子目录；拒绝被替换的父目录、符号链接或非目录目标，核对规范化父路径后删除，不接受模型/前端提供任意文件路径。

### 快速关开和异常恢复

start、close 和 retire 共用原生 registration 锁。close 确认自有 daemon 退出后才释放锁；快速重开不会与旧进程同时占用 profile。启动过程插入 entry 后按实例 operation 锁完成，retire 可先失效门禁，再等启动终态和资源回收；不会把迟到启动当作新任务重试。

异常退出仍按 B 的系统租约、PID/创建时间/exe 与 Windows 句柄核对回收原 daemon，持久 profile 保留。F 进一步实测 cookie：正常关闭、归档与显式重开能保留持久 cookie；删除仅清空所属聊天；模拟异常退出恢复可保留此前已落盘 cookie。刚写入尚未落盘的 cookie 可能在强制回收时丢失，不能承诺恢复全部登录状态；页面 DOM、JavaScript 内存、输入焦点和旧元素引用不恢复。恢复始终重新打开网页并读取新 snapshot。

### 验证

新增原生生命周期测试覆盖 hash 路径边界、失败保留无关数据、retired 拒绝重开、双 profile 持久 cookie、归档/删除、快速关开、启动中回收与模拟异常退出。双主题 mock 覆盖两个聊天同时控制转换、回收失败保留索引、懒恢复与删除范围。新增真实 `--browser-lifecycle` 流程由两个独立 pi 并行浏览本地不同 cookie 页面，切换并后台完成，随后重载重连、接管、归档/恢复和永久删除；开发版和 release 均使用隔离目录和本地模型服务。

F 完成后等待用户消息再进入 G 最终验收。
