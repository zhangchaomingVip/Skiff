# 001 · Tauri Hello World — Skiff 最小骨架

> 目标：用 **React + Vite + Tauri (Rust)** 搭一个能跑的最小 demo，验证核心链路：
> **Tauri 拉起 `pi --mode rpc` 子进程 → stdin/stdout 管道 → 事件回传前端 → 读 `~/.pi/agent/auth.json`**。
> UI 只做占位（RPC 控制台 + 终端流），最终会换成 GPUI 原生重写，所以 Web 层是"可丢弃原型"。

## 1. 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| 桌面壳 | Tauri 2 (Rust) | 轻量、WebView2 渲染、未来可对照迁移到 GPUI |
| 前端框架 | React 18 + Vite 7 | 组件化避免 pi-desktop 那种 170KB 巨型文件，对人/AI 都好读 |
| 终端 | xterm.js v6 | 验证子进程管道最省力；GPUI 阶段重做 |
| 样式 | 纯 CSS 变量 | 最小化依赖，避免 Tailwind/PostCSS 配置踩坑 |
| 后端 | Tauri command (Rust std::process) | 直接 spawn `pi`，不走 shell 插件 |

## 2. 目录结构

> 注：原型已进化为**可对话的聊天界面**（非最初占位的调试控制台），UI 分层如下。

```
Skiff/
├─ package.json              # React + Vite + Tauri 脚本
├─ vite.config.ts            # dev 端口 1420（与 Tauri 对齐）
├─ index.html
├─ tsconfig.json
├─ src/
│  ├─ main.tsx               # React 入口
│  ├─ App.tsx                # 编排 RPC 会话 + 布局（StatusBar / ChatView / RawDrawer）
│  ├─ index.css              # 暗色主题
│  ├─ rpc/RpcClient.ts       # ★ RPC 桥：invoke + 事件监听（协议无关，将来平移 GPUI）
│  ├─ chat/                  # ★ 会话状态机（协议无关，将来平移 GPUI）
│  │  ├─ usePiSession.ts     #   usePiSession：持有 PiRpc，发起 start/get_state/get_available_models
│  │  ├─ reducer.ts          #   把流式 RpcEvent 折叠进 SessionState（messages / notices / streaming）
│  │  ├─ parse.ts            #   parseModels()：把 get_available_models 的扁平列表按 provider 分组
│  │  └─ types.ts            #   SessionState / ModelInfo / Message 等类型
│  └─ components/
│     ├─ StatusBar.tsx       # 连接态 + 已配置供应商（auth.json）+ 模型选择器 + Raw 开关
│     ├─ ChatView.tsx        # 聊天主区：MessageList + Composer
│     ├─ MessageList.tsx     # 消息列表（you / pi 气泡，含 reasoning 折叠）
│     ├─ MessageItem.tsx     # 单条消息渲染
│     ├─ Composer.tsx        # 输入框，回车发送 prompt
│     ├─ Markdown.tsx        # 消息 Markdown 渲染
│     ├─ ToolCallBlock.tsx   # 工具调用展示
│     ├─ ModelPicker.tsx     # 按 provider 分组的模型下拉（来自 get_available_models）
│     ├─ RawDrawer.tsx       # 原始 RPC 流抽屉（调试用）
│     └─ TerminalView.tsx    # xterm 渲染 pi RPC 原始 stdout 流
└─ src-tauri/
   ├─ Cargo.toml
   ├─ build.rs
   ├─ tauri.conf.json        # identifier: com.skiff.desktop
   ├─ capabilities/default.json
   ├─ icons/                 # 32/128/512 png + ico（exe 编译必需）
   └─ src/
      ├─ main.rs
      └─ lib.rs              # ★ 核心：rpc_start/rpc_send/rpc_stop + get_pi_auth_status
```

## 3. 核心链路（已验证设计，参考 pi-desktop）

```
React (RpcClient)
   │ invoke("rpc_start", { options })        ─┐
   ▼                                          │ Tauri 命令
Rust rpc_start()                              │
   └─ Command::new("pi").arg("--mode").arg("rpc")
        ├─ stdout → 线程 BufReader::lines() → app.emit("rpc://main", line)
        ├─ stderr → 线程 BufReader::lines() → app.emit("rpc-stderr://main", line)
        └─ stdin  (Arc<Mutex<ChildStdin>>)  ← invoke("rpc_send", { message: JSON })
                                              ┘
React listen("rpc://main") → setLines() → xterm.write / ChatView 响应
```

- 子进程 key 固定为 `"main"`（demo 单会话；多会话时改为动态 instanceId）。
- 每个 RPC 命令是**一行 JSON**：`rpc.send({ type: "get_state" })` → 写 `{"type":"get_state"}\n` 到 stdin。
- `get_pi_auth_status` 直接读 `HOME/USERPROFILE/.pi/agent/auth.json`，解析每个 provider 的 `type`（`oauth` / `api_key`），不做任何硬编码。

### 3.1 聊天界面（在 3 的桥之上实现）

原型已进化为可对话界面：`usePiSession` 持有 `PiRpc`，启动后发 `get_state` / `get_available_models`；`reducer.ts` 把后续每一条流式 `RpcEvent`（文本增量、reasoning、工具调用）折叠进 `SessionState.messages`，`ChatView` 渲染成 you/pi 气泡。Composer 发 `prompt`，ModelPicker 用 `get_available_models` 返回的 provider 分组列表。`RawDrawer` 仍是原始 RPC 流抽屉，便于调试。协议语义全部在 `rpc/` 与 `chat/` 里，Web 组件保持"可丢弃"，将来平移 GPUI 时只重写 `components/`。

## 4. 关键文件说明

| 文件 | 职责 | 将来去留 |
|---|---|---|
| `src/rpc/RpcClient.ts` | RPC 桥（协议无关） | **平移到 GPUI**（逻辑不变） |
| `src-tauri/src/lib.rs` 的 `rpc_*` | spawn/管道/事件 | **平移到 GPUI**（用 `gpui::App` 异步任务重包） |
| `src-tauri/src/lib.rs` 的 `get_pi_auth_status` | 读 auth.json | **平移**（同一份 `~/.pi/agent/`） |
| `src/components/*` 全部 | Web UI | **丢弃**，GPUI 重写 |
| `tauri.conf.json` / capabilities | Tauri 壳 | 丢弃（GPUI 不需要） |

> 决策原则：投资在 **Rust 核心逻辑**（进程管理、RPC 协议、配置读取），它跨框架复用；Web UI 只求快速验证布局与交互。

## 5. 本地运行步骤

> 本机已装好 Rust + VS Build Tools（MSVC），`cargo build` 可正常链接出 `skiff-desktop.exe`。以下仅作全新机器参考。

1. 安装 Rust（Windows 用 rustup，勾选 MSVC 工具链）：
   ```powershell
   winget install Rustlang.Rustup
   # 重开终端后确认
   cargo --version
   ```
2. 安装前端依赖：
   ```powershell
   cd D:\workspace\Skiff
   npm install
   ```
3. 启动（会编译 Rust 后端并拉起窗口）：
   ```powershell
   npm run tauri dev
   ```
4. 验证：
   - 顶部状态栏出现已配置的 provider（如 `deepseek`）→ 说明读到了 `auth.json`。
   - 右侧终端流出 `pi` 的 RPC 文本 → 说明子进程管道通了。
   - 点 `get_state` / `get_available_models` → 左侧出现响应 JSON。

## 6. 已知限制 / 后续

- 单会话、无重连、子进程未随窗口关闭自动回收（demo 仅验证链路）。
- 终端为只读流展示，未做交互式 PTY、分屏、链接点击（这些在 GPUI 阶段实现）。
- **当前仅 deepseek 走通**：模型下拉里虽有 claude/codex 等全部目录模型，但只有 `auth.json` 里配了 key 的 provider 才能真正出字。claude / codex 接入**推迟到下一期**，方案见 `features/002`（不走 cc-switch 网关路由 `pi`，原因见 002）。
- 接 cc-switch 时踩过的坑（已归档，避免重蹈）：`pi` 的 anthropic provider 在构造 client 时写死用 `model.baseUrl`，**不读 `ANTHROPIC_BASE_URL` 环境变量**；因此往 `pi --mode rpc` 子进程注入 cc-switch 的 env 无法把 claude 调用重定向到网关。
- **应用自定义命令默认开放**：Tauri 2 的权限系统只管 `core:*` 与第三方插件；应用自身的 `#[tauri::command]` 无需在 capabilities 里加 `allow-*` 条目（也不会生成 `com.skiff.desktop:allow-*` 这类标识符）。`capabilities/default.json` 只保留 `core:default` / `core:event:default` 等。注意 permission 标识符只允许小写字母、连字符与单个冒号，包名里的点号不进入权限标识符。
- 若 `npm run tauri dev` 报图标缺失，执行 `npm run tauri icon <任意png>` 重新生成 `src-tauri/icons/`。
