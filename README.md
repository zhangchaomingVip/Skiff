# Skiff

A lightweight desktop shell for AI coding agents. Any API key. Every token visible.

Skiff 是一个 AI 编程智能体的桌面外壳：Tauri 2 + React + TypeScript 前端，Rust 原生层驱动本机的 [pi](https://github.com/badlogic/pi-mono) CLI（`pi --mode rpc`），把任意 OpenAI 兼容 / Anthropic / Google 的 API Key 变成一个可用的编程助手桌面应用。聊天内容保存在 pi 会话文件中，不经过任何第三方服务器。

## 外观：一套设计系统，六种配色

浅色模式提供薰衣草紫、暖杏米、鼠尾草绿、晴空蓝四种配色；暗色模式另有星空黑、星空蓝两款暗夜主题，可开关动态星空背景。主题跟随系统明暗，也可手动锁定，所有配色由 `src/tokens.css` 的设计令牌统一驱动。

六种配色从同一套语义令牌派生，切换主题只改变颜色，不改变布局与组件结构。在设置的外观页可以预览并切换，也可以在预览页 `?theme=light` / `?theme=dark` 对照两种明暗。

## 不止 Code，还有 Design

Skiff 内置独立的 Design 工作区：图片生成（文生图、参考图生图、2K/4K 分辨率、并发队列）与 Muse 视频生成共享同一个创作台——首页是按提示词排列的作品流，画布负责把作品分组为项目，素材库沉淀可复用资产。Code 与 Design 一键切换，各自保留完整的工作状态。

两个工作区共用同一套外壳、主题与侧栏，但各自记住自己的侧栏宽度、当前工具与面板状态，来回切换时回到离开时的样子。

## 特点

**任意 API Key，六种协议线路**
- 内置 `openai`、`openai-responses`、`kimi`、`anthropic`、`google-genai`、`vertex` 六种线路协议，可添加任意 OpenAI 兼容提供商：填名称、Base URL、API Key，一键「获取模型」或手动填写模型 ID 即可使用。
- 连接测试按协议发送真实探测请求并校验模型回复，而不是只看 HTTP 200。
- 凭据保存在本机 pi 的 `auth.json`，模型配置合并到 `models.json`；尊重 `PI_CODING_AGENT_DIR`。Key 不进入浏览器存储，也从不回传已保存的值。

**每个 Token 都看得见**
- 输入框下方实时显示当前会话的累计 Token 与生成/工具耗时；点开可查看输入、缓存读/写、输出、推理的完整明细与缓存命中率。
- 内置价格表，按线路实际计费账户折算成本；恢复历史会话时重新核算用量。
- 6 档推理等级（minimal → max），可选等级由 pi 按模型能力返回。

**完整的对话体验**
- 流式渲染、思考过程折叠展示、工具调用分组为「过程行」，命令、文件改动、搜索结果各有专属摘要与明细视图。
- 运行中可 steer 插话或 follow-up 排队，随时停止；自动重试与上下文压缩过程在界面上可见。
- 附件支持图片（4 张 × 5 MiB）、UTF-8 文本（512 KiB）与 Word（.docx 本地用 mammoth 提取正文，含表格文字）；支持选择、拖放、粘贴，发送失败保留草稿，草稿跨会话持久化。
- 历史会话全文搜索；首条消息自动生成标题；空聊天不进入历史。

**项目工作区**
- 左侧多项目 + 会话管理，右侧内建文件树与 Git 面板：提交图（Git Tree）、变更列表、diff 预览（带预加载缓存）、回滚与推送。
- 文件与 diff 可直接在工作台预览，支持右键菜单操作。

**不止聊天**
- AI 浏览器：Rust 侧驱动真实 Chromium profile，pi 通过扩展工具完成网页自动化，前端可实时可视化。
- 「航行台」数据看板展示用量遥测与工具航迹时间线。
- 多会话并行：每个聊天独立 pi 进程，互不阻塞。

**可信的三层测试体系**
- 单元测试：`npm test`（node:test 直接跑 TS，约 30 个用例）+ `cargo test --lib`。
- 浏览器测试：约 50 个 Playwright 场景，配全套 mock 桥（pi / 浏览器 / 生成），独立端口预览页隔离本地存储。
- 全链路 CDP 验收：`npm run test:cdp` 驱动真实 Tauri 窗口走完 WebView2 → IPC → Rust → pi 全链路；另有真实 pi 集成测试（只连本地模拟服务、使用临时配置，不触碰真实凭据）。

## 运行

需要 Node.js（推荐 24）、Rust、平台对应的 Tauri 构建环境，以及已配置模型的 `pi` CLI（已验证 0.87.1）。

```powershell
npm ci
npm run tauri -- dev
```

可通过 `SKIFF_PI_PATH` 或 `PI_CLI_PATH` 指定 pi 启动器。应用跟随系统明暗主题；点击项目区的 `+` 输入已有文件夹的绝对路径，pi 即在该目录下运行。模型选择只使用 pi 返回的可用模型，已有 pi 配置可直接使用。

## 构建与发布

```powershell
npm run build      # TypeScript 检查 + 前端构建
npm run release    # tauri build，产出独立 exe 并归档到 releases/
```

发布产物为 Windows 独立可执行文件，按 `Skiff-v{version}-{时间戳}.exe` 归档——每次发布都是一份源码快照。

## 检查与预览

```powershell
npm test
npm run test:styles
npm run check:ui
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

浏览器视觉/交互检查使用独立端口（隔离本地存储，不调用真实模型）：

```powershell
npm run dev -- --port 1421
```

打开 `http://localhost:1421/tests/preview.html?theme=light` 或 `?theme=dark`，用 mock 桥对照浅色与暗色两种主题的界面，不调用真实模型。桌面入口始终连接真实 pi。

真实 pi 的可选集成测试只连接本地模拟服务、使用临时配置：

```powershell
node tests/pi.integration.mjs <pi安装目录>/dist/bundle/cli.js
```

## 架构速览

| 层 | 位置 | 职责 |
| --- | --- | --- |
| UI 组件 | `src/components/` | 聊天、模型选择、提供商设置、工作区、生成、浏览器 |
| 会话状态 | `src/chat/` | RPC 会话 hook、消息解析、事件 reducer、usage/成本统计 |
| RPC 桥 | `src/rpc/RpcClient.ts` | 前端与 Rust 的通信 |
| 原生层 | `src-tauri/src/` | pi 进程生命周期、多协议线路投影（`families.rs`）、Git、生成、AI 浏览器 |
| pi 适配 | `src-tauri/src/pi_extensions/` | 运行时注入 pi 的系统提示词、浏览器与联网搜索扩展 |

设计令牌集中在 `src/tokens.css`；功能设计与验收记录见 `features/`（如 `002-chat-capabilities`、`004-model-families`、`025-agent-browser`），调研与诊断文档见 `docs/`。

## 许可

MIT
