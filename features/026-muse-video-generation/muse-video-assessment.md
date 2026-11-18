# Muse 视频接入评估

评估日期：2026-11-12。结论：适合在现有视频工作区接入，采用 Rust 直连的异步任务方案，独立于 pi 与聊天供应商协议。当前阶段只完成代码检查和一次真实接口验证，尚未实现产品功能。

## 本次真实验证

服务根地址为 `https://api.aisenyu.com/v1`，模型为 `muse-video`。只创建了一条文生视频任务，没有上传参考图，也没有追加生成或自动重试创建请求。Key 仅用于测试进程内的 Authorization，没有写入仓库、测试产物或应用配置。

```json
{
  "model": "muse-video",
  "prompt": "A single small blue paper boat floating on gentle ocean ripples at sunrise, warm golden reflections moving across the water, a soft breeze, the camera slowly pushes forward. Continuous coherent shot, no cuts, no text, no people.",
  "duration": 5,
  "aspect_ratio": "9:16",
  "resolution": "1080p"
}
```

| 环节 | 本次结果 |
| --- | --- |
| 创建 | `POST /videos`，JSON，Bearer 鉴权，HTTP 202，约 0.5 秒 |
| 任务 ID | `muse_ff12f708-20e6-4d46-afe4-7bb630fcb599` |
| 状态查询 | `GET /videos/{id}`，`queued → in_progress → completed` |
| 进度 | 观察到 0、10、15、40、95、100；只能按服务返回值展示 |
| 生成完成 | 约 85.1 秒时轮询观察到完成；轮询间隔约 5 秒 |
| 下载 | `GET /videos/{id}/content`，直接返回 `video/mp4`，约 86.6 秒时完成落盘 |
| 实际规格 | **720×1280**、24fps、120 帧、5.00 秒、H.264 High / yuv420p + AAC 单声道 |
| 文件大小 | 3,982,778 字节，约 3.98 MB |
| 用量 | `usage.billing_mode: per_second`、`billing_seconds: 5`、`videos: 1`、`cost: 0` |

FFmpeg 完整解码视频和音频通过，退出码 0；OpenCV 读取尺寸、帧率和帧数交叉核验。查看 0、2、4 秒抽帧，蓝色纸船主体持续存在，水面与画面构图有变化；这只能支持本样本的粗略视觉判断，不代表人物一致性或所有动作效果。

产物位于被 Git 忽略的 `dist/muse-evaluation-20261112-094909/`：`request.json`、`task.json`、`events.jsonl`、`muse-video-5s.mp4`、`verification.json`、`decode-verification.txt`、`contact-sheet.jpg`。

**分辨率存在待确认差异**：请求中的 `resolution: "1080p"` 被接受，但本次成片是 720×1280。另行解码用户提供路径中的旧样片 `D:/workspace/emptyForTest/beach_muse_5s.mp4`，确认为 1080×1920、24fps、5.00 秒、H.264 + AAC。尚不能判定是 resolution 的取值、文生/图生路径差异，还是服务端降级。接入时必须分别保存请求规格和实际规格，不能仅凭请求值显示“1080p 成片”。

## 已知协议与证据边界

- 本次独立验证了创建、状态查询、带鉴权内容下载，以及纯提示词、5 秒、9:16 组合。只测了一个成功样本；未验证横屏、其他时长、失败状态、限流、取消或过期行为。
- 用户既有测试记录报告：创建字段白名单为 `model, prompt, duration, aspect_ratio, resolution, image, images, videos, audios, files`；`size`、`seconds` 会报 400。第一版按该白名单构造专用请求，不复用图片或聊天请求体。
- 用户既有记录报告：参考图需要 Base64 data URL，缩图压缩后约 320 KB 的 JPEG 可以通过。本文尚未重新验证图生视频，也没有证据证明 320 KB 是服务的大小上限。
- 用户记录中的多图建议包含 `mode: "i2v"`，但 `mode` 不在其字段白名单中，存在冲突。第一版不发送 `mode`，不把多图一致性改善作为已验证能力。
- 本次 `cost: 0` 只是此任务返回的用量，币种、免费期、正式单价及余额查询尚未确认，界面不能承诺永久免费。
- 当前未验证服务端取消、按客户端请求 ID 查询、幂等键、任务列表或结果保留期限。第一版不能依赖这些能力。

## 仓库现状与接入位置

| 现有实现 | 接入判断 |
| --- | --- |
| `src/components/GenerationWorkspace.tsx` | 视频表单、导入、画廊、播放器已有；视频配置和提交禁用，任务列表只处理图片 |
| `src/workbench/useGenerationStudio.ts` | 已有独立视频草稿及“以此图生成视频”；参考图主要以临时 blob URL 表示，尚不能直接作为服务端输入 |
| `src/workbench/imageGeneration.ts`、`useImageGeneration.ts` | 可参考 IPC、共享状态、读取任务及提交防重模式；需要独立的视频类型与 hook |
| `src-tauri/src/generation.rs` | 可复用密钥加密、原子写入、应用数据根目录、asset 授权、导出交互经验；图片同步请求与重启中断语义不适合直接套给远端视频任务 |
| `ImageGenerationSettings.tsx`、`SettingsDialog.tsx`、`settingsNavigation.ts`、`App.tsx` | 增加“视频生成”配置入口，并让视频页跳转到对应设置 |

建议新增 `src-tauri/src/video_generation.rs`、`src/workbench/videoGeneration.ts`、`useVideoGeneration.ts` 和 `VideoGenerationSettings.tsx`。复用现有 UI 与基础工具，不为首个模型重构整个聊天供应商或媒体框架。视频配置使用独立文件，已有图片配置和作品格式无需迁移。服务根地址统一保存为包含 `/v1` 的形式，端点只追加 `/videos`，避免重复拼接 `/v1`。

## 推荐的任务与存储设计

```text
视频参数页 → Tauri IPC → Rust 视频任务管理器
                             ├─ POST /videos → 立即持久化远端 task ID
                             ├─ GET /videos/{id} → 更新状态与服务端进度
                             └─ GET /videos/{id}/content → 流式落盘 → 本机播放器
```

1. 提交先持久化本地 UUID、服务/模型、提示词、请求规格和参考图快照，再发出创建请求。同一 UUID 的 IPC 重放只返回原任务；这个机制仅防止本地重复提交，不能保证上游 POST 幂等。
2. 创建成功立即保存远端任务 ID 与服务根地址。任务至少区分 `submitting / queued / in_progress / downloading / completed / failed`；另需表示“提交结果未知”“查询暂停”“下载失败”。本地下载失败与上游生成失败必须分开。
3. POST 超时或响应丢失时禁止自动重发；服务端可能已接单。没有远端 ID 时明确显示提交结果未知。若服务以后提供幂等键或任务检索，再增加可靠对账。
4. 已持有远端 ID 的任务可在重启后恢复 GET 查询；不能像现有图片记录一样一律标记生成中断。保存服务引用和端点快照；若服务被删除或凭据失效，则等待重新配置，不重新创建任务。
5. GET 查询可从约 5 秒开始，网络错误/429 时退避并尊重 `Retry-After`。查询超出等待预算只暂停查询，保留任务和“继续查询”入口；没有远端终态证据时不宣告生成失败。
6. 未验证远端取消接口前，按钮使用“暂停查询/停止等待”，不能承诺停止生成或停止计费。默认限制一个未完成的视频生成任务，暂停不释放此限制，避免连续提交产生额外费用。
7. 视频用分块下载写入 `.part` 临时文件，设大小与时间上限，完成校验后原子改名；下载失败可按同一远端任务重新下载，绝不重新生成。开发验证可用 FFmpeg；是否引入运行时媒体探测依赖另行决定，不能假定用户机器安装了 FFmpeg。
8. 保存原始用量、请求规格、实际宽高/时长/帧率、完成时间。实际规格可由媒体解析器或 WebView 元数据读取后回传并校验；无法探测的字段显示未知。

存储建议在现有 `SKIFF_GENERATION_DIR` 根目录下新增 `video-config.json`、`video-jobs/<uuid>.json`、`video-inputs/<uuid>.jpg` 和 `assets/<uuid>.mp4`。复用本机密钥加密，前端读取只得到 configured/keyHint，生成只传服务 ID。只授权资产目录文件用于预览，不授权配置和参考图快照目录。

内容接口在本次测试中直接返回 MP4，可以向同源接口发送鉴权。若未来跳转 CDN，单独处理并去掉跨域 Authorization；不得把 Key 拼进视频 URL 或让前端直接加载受保护的远端地址。

## 第一版界面与范围

建议交付“一个 Muse 服务、单任务、文生视频 + 单张首帧图生视频、作品自动保存、播放、另存、打开文件夹、复用提示词、重启恢复查询”。其中图生视频需要在正式验收前补一次真实接口验证。

| 当前控件 | 建议 |
| --- | --- |
| 模型 | 配置视频服务后启用，默认 ID 为 `muse-video` |
| 提示词 | 保留；运动方式通过用户的文字描述表达 |
| 运动幅度滑块 | 隐藏，当前没有已验证的 API 参数；不悄悄改写提示词来模拟 |
| 帧率滑块 | 隐藏，24fps 当前是观测到的输出值，不是已验证的可控参数 |
| 2–15 秒连续滑块 | 改为能力列表；首批验证配置只开放 5 秒，其他时长确认后再开放 |
| 四种比例 | 首批验证配置只开放 9:16；16:9、1:1、4:3 均待验证，不因控件已存在就认为支持 |
| 分辨率 | 预留能力配置，待确认有效取值与实际输出后再开放选择；暂不承诺 1080p |
| 首帧参考图 | 保留，新增压缩、格式与像素校验、上传前预览；blob/asset URL 先解析为图片字节，不能直接发送给中转站 |
| 生成按钮与作品区 | 显示排队/生成/下载、真实进度及错误；完成卡片显示实际规格与服务返回用量 |

首帧预处理可由前端 Canvas 缩图并编码 JPEG，再交给 Rust 校验类型、体积和像素、存为任务快照，并构造 data URL。具体最长边和大小预算应通过图生验证确定；GIF/WebP 动画不能在未说明的情况下当成多帧输入。保存的生成图片也必须走字节读取和预处理，不能把本机 `asset://` 地址发给服务。

多图、多视频/音频参考、批量并发、服务端取消、模型发现、精确价格估算放到后续。人物贴脸程度需要单独评估，不能从纸船文生测试推断。

## 实施顺序与验收

1. 协议收口：确认分辨率有效取值、图生输入与压缩预算、任务保留期和计费规则；增加一条可选的单图真实验证，不默认追加消耗额度。
2. Rust 服务与持久任务：加密配置、提交防重、远端 ID、可恢复查询、限流退避、流式下载和导出。
3. 前端设置与工作区：视频配置、能力约束表单、参考图处理、进度卡片、错误恢复、作品详情。
4. 本地 mock 回归：202 排队、完成、401/429、未知状态、创建响应丢失、重复 IPC、重启恢复、下载中断、超过大小上限与密钥脱敏。
5. 按仓库要求做浅/深色交互及真实桌面 CDP 验证：临时生成目录与虚拟 Key，覆盖 Rust IPC、MP4 asset 播放/拖动、参考图转视频，并保留现有工作区与 localStorage 的隔离和恢复措施。

粗估约 3–5 个开发工作日，假设服务协议稳定且以现有工作区为基础；分辨率差异及未公开的任务能力可能增加联调时间。本次没有修改应用源码，因此未运行应用构建、UI/CDP 回归；上面的验收项目属于后续实施计划。
