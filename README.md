# Skiff
A lightweight desktop shell for AI coding agents. Any API key. Every token visible

## 本地开发

需要 Node.js（推荐 24）、Rust、平台对应的 Tauri 构建环境，以及已配置模型的 `pi` CLI。

```powershell
npm ci
npm run tauri -- dev
```

应用跟随系统明暗主题，左侧管理项目与聊天，右侧显示会话。点击项目区的 `+` 输入已有文件夹的绝对路径；pi 在该目录运行。模型选择只使用 pi 返回的可用模型，已有配置可直接使用。可通过 `SKIFF_PI_PATH` 或 `PI_CLI_PATH` 指定 pi 启动器。

聊天内容保存在 pi 会话文件中，项目与会话索引保存在 WebView 的本地存储中。空聊天不会成为历史记录；首条消息自动生成标题。索引只包含通过 Skiff 创建的聊天，不自动导入其他 pi 历史。

## 聊天能力

- 点击输入框的模型按钮，选择模型与推理等级。可选等级由 pi 返回；`xhigh`、`max` 仅在模型支持时展示。已验证 pi 0.87.1。
- 输入框下方显示当前聊天累计 Token 和生成/工具执行耗时。点击 Token 查看输入、缓存、输出、推理与回复明细；未返回的推理拆分显示「未提供」。恢复历史时重新读取用量，耗时从 Skiff 索引恢复。
- 顶部齿轮可添加 OpenAI 兼容提供商：填写名称、Base URL（如 `https://api.example.com/v1`）、API Key，点击「获取模型」或手动填写模型 ID，然后「保存并使用」。接口使用 Chat Completions；按服务商声明勾选推理和图片能力、填写限制，勾选本身不改变模型能力。
- 凭据保存在本机 pi `auth.json`，模型配置合并到 `models.json`；尊重 `PI_CODING_AGENT_DIR`。编辑已有提供商时，留空 Key 保留原凭据。Key 不存入浏览器索引，也不回传已保存值。
- 图片支持文件选择、拖放和粘贴；最多 4 张，每张 5 MiB，格式为 PNG/JPEG/WebP/GIF。先选择支持图片的模型，可仅发送图片；发送前可删除附件，发送失败保留草稿。pi 可能按自身配置缩放图片。

## 检查与预览

```powershell
npm run build
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

浏览器视觉/交互检查可使用独立端口：

```powershell
npm run dev -- --port 1421
```

打开 `http://localhost:1421/tests/preview.html?theme=light` 或 `?theme=dark`。此页面使用测试专用模拟桥，不调用真实模型；桌面入口始终连接真实 pi。测试预览应使用与桌面开发不同的端口，隔离本地存储。

设计与验收记录见 [features/002/DESIGN.md](features/002/DESIGN.md)。

本次能力设计与验证见 [features/003-chat-capabilities/DESIGN.md](features/003-chat-capabilities/DESIGN.md)。真实 pi 的可选集成测试只连接本地模拟服务、使用临时配置（不调用已配置的在线提供商）：

```powershell
node tests/pi.integration.mjs <pi安装目录>/dist/bundle/cli.js
```
