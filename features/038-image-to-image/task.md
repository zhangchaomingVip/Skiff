# 038 · 单张参考图生图

状态：实现和隔离验收完成。创建/完成日期：2026-11-12。用户当前中转站的真实图片编辑接口尚未实测，具体账户和模型兼容性以服务商为准。

## 使用与范围

在「生图」页上传或拖入一张参考图，填写想保留与修改的内容，点击「生成图片」。没有参考图时仍然使用原来的文生图。尺寸、质量与模型复用现有图片服务配置，不另配 Key。

画廊生成作品的更多菜单，以及所有图片的大图预览底部，提供「以此图生成图片」。选择后带入参考图并打开参数栏，保留已有修改描述；点击移除参考图恢复文生图。图生图参考图与视频首帧独立，切换工具不清空。

首期支持一张参考图与整图自然语言编辑，不含多图、涂抹蒙版、局部选区、相似度/重绘强度滑块、批量编辑和自动服务切换。不保证模型逐像素保留主体或人物面貌。

## 接口与实现

依据实际获取的 [OpenAI 官方 Create image edit 文档](https://developers.openai.com/api/reference/resources/images/methods/edit)。官方接口还支持其他请求形式；本期为兼容现有图片中转服务，固定使用文件上传的 multipart 路径，不自动重试其他协议。

- 文生图：原有 `POST /images/generations` JSON 请求不变。
- 图生图：`POST /images/edits`，Bearer 鉴权，multipart/form-data。发送 `model`、`prompt`、`size`、`quality`、`n=1`、`output_format=png` 与单个 `image` 文件部件。文件 MIME 来自经过验证的内容，不发送本机/asset/blob URL。
- 保留用户实际模型 ID，包括已有的 `gpt-image-2.5-flare`，不替换模型或改写服务配置。不发送未开放的 `input_fidelity`、mask 等参数。
- 复用原来图片结果的 PNG 落盘、用量、实际尺寸、预览、导出与 reveal 流程。
- 不支持编辑或请求失败时明确报「图生图失败」，保留参考图和草稿；不自动改成文生图、不自动重试付费 POST。

PNG/JPEG/WebP 在 20 MB、单边 8192 像素和约 1600 万像素的客户端预算内保留原始字节，不缩图或丢弃透明通道。GIF 或浏览器识别的其他格式取静态首帧并转换 PNG，转换后仍检查大小。服务商可能有更严格限制。

前端读取受控的本机媒体，在提交期间固定本次参考图内容；Rust 再核验 MIME、图像格式、尺寸和完整解码。解码与落盘在 blocking worker 执行，不阻塞 UI。参考图存为 `SKIFF_GENERATION_DIR/image-inputs/<uuid>.<png|jpg|webp>`，不授权 asset 预览；任务记录只新增可选 reference 元数据，旧记录可继续读取。配置和原始资产不迁移、不覆盖。

相同本地 UUID 重放只返回原任务，连同原参考图快照；修改/移除 UI 参考图不影响已提交任务。图片与视频参考图分别管理 blob URL，移除共享画廊引用不释放原作品。

## 完成任务

- [x] 查阅官方接口并确定单图 multipart 契约，保留现有文生调用和模型 ID。
- [x] 增加前端参考图上传/拖放、替换/移除、静态转换及校验，保留支持格式原始字节。
- [x] 生图与视频维护独立参考图，切页保留，正确释放独立 blob 并保留共享作品。
- [x] 接通生成作品菜单与全部图片预览的「以此图生成图片」，保留修改提示词并展开参数栏。
- [x] 扩展已有 IPC，Rust 验证/持久化快照，以 multipart 文件请求图片编辑接口。
- [x] 复用任务、取消、结果保存、用量、实际尺寸和导出；历史记录兼容可选 reference 字段。
- [x] 错误脱敏，不重试、不自动切换协议或回退文生图；参考图快照不向前端 asset 开放。
- [x] Rust 回归验证源字节/透明度、MIME/格式错误、旧记录、multipart、失败/超时不重试。
- [x] 浅/深主题、窄窗、上传错误、独立引用、移除与共享 URL、画廊复用、失败与文生回退交互通过。
- [x] 真实 WebView2 → Tauri → Rust → 本地 mock 完成文生与图生，验证原始文件、快照隐私、幂等、重载恢复与随后 pi 聊天。
- [x] 完成相关构建、类型、样式、前端和 Rust 检查，更新文档。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm run build -- --emptyOutDir=false` | 通过 |
| `npm run check:ui` | 通过 |
| `npm run test:styles` | 0 样式错误，126 组对比度无失败 |
| `npm test` | 406 项通过 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 通过 |
| `cargo build --manifest-path src-tauri/Cargo.toml` | 通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 91 项通过，4 项既有真实 agent-browser 测试按原配置忽略 |
| `node tests/image-edit.browser.mjs` | 浅/深主题图生图、错误/取消、URL 生命周期、视频引用隔离、作品复用及 600px 通过 |
| `node tests/image-generation.browser.mjs` | 原文生图浅/深主题回归通过 |
| `node tests/generation-workspace.browser.mjs` | 原导航/导入/预览/视频/引用及 390/760px 抽屉回归通过 |
| `npm run test:cdp -- --images` | 文生 JSON 与图生 multipart、原始 PNG 字节、原生文件快照、asset 403、幂等、重载、取消、404 不回退和随后真实 pi 聊天通过 |

CDP 使用刚构建并复制到临时目录的 debug exe（`SKIFF_CDP_BINARY`），临时 WebView2 profile、生成和 pi 目录，以及本地 mock / 虚拟 Key；保留 localStorage 快照与 finally 恢复。没有读取用户真实 Key、改写现有服务或发起真实模型生成。

修复了 preview 中旧的 1×1 PNG 夹具 IDAT 校验和损坏问题，使模拟生成结果也能再次作为参考图完整解码。桌面测试以画廊已完成卡片为等待条件，避免在原生生成尚未落盘时提前读取任务。

截图：`dist/image-edit/light-reference.png`、`dark-reference.png`、浅/深窄窗截图，以及 `dist/image-edit-cdp.png`。日志：`dist/image-edit-frontend-tests.txt`、`dist/image-edit-rust-tests.txt`、`dist/cdp-dev.log`。这些生成产物不入库。

仍未验证：用户 `qmg2s` 中转站的 `/images/edits` 实现、该账户模型的图生权限与实际计费、真实模型编辑效果。只有文生图接口不代表支持编辑；本期不根据模型名称猜测或自动放行其他接口。原生另存为窗口沿用原实现，没有新增窗口点击自动化。
