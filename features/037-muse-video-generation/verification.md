# 037 验证记录

日期：2026-11-12。首版验收完成：文生视频、持久任务和作品链路通过既有验证，用户随后在 Skiff 中完成真实图生视频并确认可用。单图的实验开关仍保留，当前默认关闭。

## 已运行检查

| 检查 | 结果 |
| --- | --- |
| `npm run build -- --emptyOutDir=false` | 通过，TypeScript 与 Vite 构建成功 |
| `npm run check:ui` | 通过 |
| `npm run test:styles` | 通过，0 样式错误、126 组对比度检查无失败；未保留与本 feature 无关的生成审计文件改动 |
| `npm test` | 406 项通过，无失败 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 通过 |
| `cargo build --manifest-path src-tauri/Cargo.toml` | 通过，Windows debug 原生程序可运行 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib video_generation` | 8 项通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 89 项通过、0 失败；4 项需要真实 agent-browser 环境的既有测试按原配置忽略 |
| `node tests/generation-workspace.browser.mjs` | 浅/深主题、导入与播放、参考图 URL 生命周期、切换工具、聊天/Commit 草稿恢复、390/760px 抽屉通过 |
| `node tests/image-generation.browser.mjs` | 浅/深主题、图片配置/生成/取消/导出入口/持久恢复回归通过 |
| `node tests/video-generation.browser.mjs` | 浅/深主题、600×400、视频设置、首帧、暂停/继续、下载重试、提交未知、播放/拖动/声音、作品持久恢复通过 |
| `npm run test:cdp -- --videos` | 真实 WebView2 → Tauri → Rust → 本地服务 → MP4 落盘 → asset 播放通过，含整个原生进程重启恢复与普通 pi 聊天 |
| `npm run test:cdp -- --images` | 图片桌面链路与随后普通 pi 聊天回归通过 |

CDP 运行时 1420 已有开发服务，因此设置 `SKIFF_CDP_BINARY` 为刚构建的 `src-tauri/target/debug/skiff-desktop.exe`。测试把 exe 复制到临时目录，使用临时 WebView2 profile、`PI_CODING_AGENT_DIR` 和 `SKIFF_GENERATION_DIR`，本地 mock 和虚拟 Key，不触碰真实生成配置或模型凭据。运行前核验 WebView2 命令行的实际 profile，保留 localStorage 快照、finally 恢复及约 8 秒落盘等待。视频恢复场景会终止并重启本次临时进程，不终止用户开发实例。

## 行为证据

- Rust 覆盖本地 UUID 防重、原生单任务限制、5 秒/9:16 能力校验、默认关闭实验性首帧、JPEG 内容校验及输入快照、路径越界拒绝。
- 配置验证 Windows DPAPI 密文、Key 不返回前端、编辑留空保留 Key，以及旧任务不能使用修改后的端点凭据。
- 协议验证只发送 `model/prompt/duration/aspect_ratio/resolution` 和可选 `image`，不发送 `size/seconds/mode/motion/fps/quality`。
- 成功任务恢复只使用 GET；HTTP 401、502 提交歧义、远端失败、GET 429 的长 `Retry-After`、下载 410、超大响应、无效 MP4 和资产目录写入失败都不自动重发 POST。
- `Retry-After` 支持秒数及 HTTP 日期；长于查询预算时暂停，不通过上限截短后提前重试。
- MP4 读取校验 box 边界、视频轨道、尺寸、时长和平均帧率；测试夹具是 5 秒、72×128、24fps 的 H.264，另有截断和 HTML 响应反例。应用运行无需 FFmpeg。
- 桌面场景实际完成配置加密、单图 data URL 与快照、原始 MP4 字节落盘、asset 播放和拖动，并确认配置/参考图目录通过 asset 返回 403。
- 桌面场景在生成过程中重载 WebView、暂停/恢复，再重启整个 Rust 进程，最终完成原任务，POST 数量不增加；重新下载也不增加创建数。
- 提交结果未知阻止新建；人工核对后结束本地跟踪可释放名额。401 服务响应内包含虚拟 Key 的错误正文不会展示出来。
- 两套媒体桌面场景结束后均用真实 pi 连接本地 mock 验证普通聊天仍可发送与收到回复。

## 真实中转站联调

文生成功样本见 [前置评估](../036-generation-workspaces/muse-video-assessment.md)：创建至下载约 87 秒，5.00 秒、720×1280、24fps、H.264 + AAC，返回计费 5 秒、`cost: 0`。这是独立 HTTP 协议验证；应用内的桌面端到端验收使用本地 mock。

本次实施额外创建 **一条**单图任务：

- 任务 ID：`muse_f2b9cf95-c666-4392-a81f-eb1b0c916e20`，模型 `muse-video`。
- 客户端绘制的蓝色纸船参考图，720×1280 JPEG，质量 85，46,746 字节；使用 `image` Base64 data URL，不发送 `mode`。
- 请求 5 秒、9:16、`resolution: 1080p`；HTTP 202 接单。
- 约 23.5 秒观察到 `status: failed`、`progress: 15`、`error.code: video_generation_failed`。
- 服务消息：“视频生成失败：找不到上传控件，已停止生成（本次不扣费）。”未返回 usage，是否扣费仅有服务消息作为证据。
- 没有自动或人工追加创建请求，只 GET 查询失败详情。没有把本次失败当成客户端参数错误或静默回退到文生视频。
- 脱敏请求摘要、参考图、阶段记录和失败详情在 `dist/muse-i2v-20261112-101327/`。

### 用户补充的真实图生成功验收

2026-11-12，用户明确反馈“我生成好了，图生视频可用”，并提供 Skiff 视频预览截图，作为本 feature 的真实图生成功验收证据。

- 模型：界面显示 `Muse 视频 · muse-video`；使用上一条反馈中已上传的紫蓝发动漫角色首帧图。
- 结果：用户确认生成成功；截图展示生成作品的视频播放器、画面、提示词与作品详情。
- 截图中的实际规格：720×1280、5.04 秒、23.8fps；界面时间为 2026/11/12 10:51:11。这里记录界面读数，没有另外读取或解码用户的成片文件。
- 提示词要求缓慢推进、挥手、眨眼等运动；单张截图不用于独立评价运动效果，功能可用性由用户确认。
- 截图副本：`dist/video-generation/user-i2v-success.png`。未获取任务 ID、计费数据或请求耗时，不补写这些未知值。

A4 的真实单图成功验收据此通过，原先的“找不到上传控件”保留为一次历史失败，其具体原因仍未确认。当前请求结构无需因那次失败修改；本次记录更新没有追加生成请求，也没有修改用户已有配置。实验开关与现有默认值保持原样。

## 产物和仍未验证项

- 浅/深主题截图：`dist/video-generation/`；已目视检查画廊和窄窗布局。
- 桌面截图：`dist/video-generation-cdp.png`、`dist/image-generation-cdp.png`。
- 桌面日志：`dist/video-generation-cdp.log`、`dist/cdp-dev.log`；构建/检查日志与测试媒体均不入库。
- 视频测试夹具 `tests/fixtures/video.mp4.b64` 是可重复解码的 5 秒 H.264，用于本地测试，不包含用户视频或凭据。
- 上游分辨率有效取值、为何曾返回 720p、其他时长/比例、结果保留期、幂等键、任务列表、远端取消、正式价格和币种仍未确认。首版不开放相应承诺。
- 原生另存为窗口没有通过自动化实际点击保存；已验证前端入口和原生导出实现，窗口交互复用既有图片方案。
- macOS/Linux 密钥存储与实际 WebView 编解码能力没有验收。其他平台沿用现有拒绝新增密钥的策略。


## 后续修正：窄窗视频缩略图

视频卡片原先沿用 `object-fit: cover`，将 9:16 画面铺满 4:3 卡片时裁掉上下内容。现为视频卡片单独使用 `contain`，完整显示横/竖画面，剩余空间沿用主题底色；缩略图高度限制为 `min(440px, 48vh)`，不影响大图播放器或原视频文件。

本次使用用户提供截图中的竖屏画面制成一秒本地 MP4，仅用于预览，不调用生成接口。浅/深主题分别检查 1140、800、600、390px 窗口，已确认完整画面、卡片高度限制和无横向溢出，并目视检查窄窗卡片。截图位于 `dist/video-thumbnail-fit/`。构建及样式/对比度检查通过。

本次完整视频浏览器回归尝试在已有的重载恢复/结束跟踪交互阶段出现超时，未计作本次通过项；浅色一轮完整通过后，深色轮在确认按钮点击时超时。缩略图专项检查两种主题、四个宽度均通过。本次没有修改这些任务交互。
