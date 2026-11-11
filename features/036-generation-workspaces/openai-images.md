# OpenAI 文生图（第一期）

## 使用

1. 生图页点击「配置生成服务」，或打开「设置 → 图片生成」。
2. 点击「添加生成服务」，填写 API Key。OpenAI 官方地址默认是 `https://api.openai.com/v1`，自定义服务也必须实现 OpenAI Images 接口。
3. 填写账户已开通的图片模型 ID 和实际支持的尺寸，选择默认模型并保存。默认预填 `gpt-image-2.5-flare`；模型支持情况以服务商和当前账户为准。可添加多个服务、多个模型。保存不会调用接口或消耗额度。
4. 回到生图页，填写提示词，选择服务、模型、尺寸与质量，然后生成。每次一张，按服务商计费。
5. 成功作品自动保存，支持大图预览、复用提示词、另存为和打开所在文件夹。导入作品仍只在当前运行期间保留。

官方协议依据：[Image generation](https://developers.openai.com/api/docs/guides/image-generation)、[Create image](https://developers.openai.com/api/reference/resources/images/methods/generate)。调用 `POST /images/generations`，携带 `model`、`prompt`、`size`、`quality`、`n: 1`、`output_format: png`。不发送 GPT Image 不支持的旧参数 `response_format`。接受 `data[0].b64_json`，也兼容返回 `data[0].url` 的服务；第一期只保存 PNG。尺寸由模型配置提供，实际输出尺寸从 PNG 头读取，不拉伸或裁切。

## 实现与存储

- `src/components/ImageGenerationSettings.tsx`：服务与模型编辑，密码输入框不回填已保存的 Key；编辑时留空保留原密钥，删除服务清除其密钥并保留作品。
- `src/workbench/imageGeneration.ts`：图片专用 IPC 类型和调用；`useImageGeneration.ts`：共享配置、提交与任务轮询；`useGenerationStudio.ts`：合并持久作品与临时导入图片。
- `src-tauri/src/generation.rs`：独立于 pi 的请求、密钥、任务、下载和持久化。Windows 复用 DPAPI；其他平台按现有密钥模块拒绝新增秘密写入，不回退明文。
- 默认根目录是 Tauri 的应用数据目录下的 `generation/`：`config.json` 存服务与加密 Key，`jobs/<uuid>.json` 存任务和作品信息，`assets/<uuid>.png` 存原图。可用 `SKIFF_GENERATION_DIR` 指定隔离目录，供测试使用。
- 配置读取返回 `configured` 和 `keyHint`，不返回密钥。生成仅传服务 ID。密钥不进入 localStorage、聊天上下文、pi 配置或日志。
- `asset://` 仅动态授权 `assets/` 目录的直接文件；未放开整盘或应用配置目录。预览不会把大幅 Base64 图片往返传输给前端。另存为的原生文件窗口由 Rust 打开，前端不获任意文件写入权限。

## 任务语义

同一时间运行一个任务，点击提交立即落下任务记录。每次提交携带客户端 UUID，相同 ID 的 IPC 重放只返回已有记录，不重复请求服务。任务分为生成中、保存中、完成、失败、已停止等待和已中断。

网络连接超时 20 秒，整个生成请求等待上限 10 分钟；请求与图片下载均有响应大小上限。关闭自动重试，不进行自动服务切换。HTTP 错误仅返回状态与脱敏后的服务消息；下载地址不携带服务的 Authorization，也不跟随重定向。

切换工具、打开设置和 WebView 重载不会取消 Rust 任务。停止等待会取消本地请求，但无法承诺取消服务端计费。应用重启后，仍处于生成中而无活动执行器的记录标记为已中断，明确提示服务端可能继续处理，不自动恢复付费请求。已完成记录保留提示词、服务、模型、请求尺寸、实际尺寸、时间、服务返回的用量和 revised_prompt。

第一期不包括图片编辑、参考图生图、视频生成、自动模型发现、批量出图和价格估算。真实 OpenAI 账户权限与计费仍需用户配置 Key 后验证。

## 验证

- `npm run build -- --emptyOutDir=false`
- `npm run check:ui`
- `npm run test:styles`
- `npm test`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`
- `node tests/generation-workspace.browser.mjs`：原图片/视频空间回归。
- `node tests/image-generation.browser.mjs`：1421 独立预览，浅深色服务配置、密钥不回填、未保存变更、尺寸、切页、取消、生成、导出入口、错误、重载和窄屏。
- `npm run test:cdp -- --images`：真实 WebView2 → Tauri → Rust → 本地图片服务 → 原图落盘 → asset 预览；额外验证配置密文、资产目录范围、任务重载、幂等、取消、429 以及随后真实 pi 聊天。已有开发服务占用 1420 时，可通过 `SKIFF_CDP_BINARY` 指定已构建的 debug exe，由测试复制到临时目录运行。

CDP 保留现有临时 pi 目录、临时 WebView2 profile 与 localStorage 快照/恢复，并新增临时 `SKIFF_GENERATION_DIR`，不读写用户的生图配置和作品。所有自动验证使用虚拟 Key 和本地服务，不产生付费请求。截图位于 `dist/image-generation/` 和 `dist/image-generation-cdp.png`，不入库。
