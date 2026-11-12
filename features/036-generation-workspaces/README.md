# 生图与视频创作空间

Activity Bar 在「文件」之后提供「生图」「生成视频」，复用既有按钮尺寸、选中与悬停态及 1.6px 线性图标。原有文件 / Commit / Git Tree Tab 的选择记忆不受影响，创作空间选择沿用 `skiff.workbench.v1`。

两个空间共用 `GenerationControls` 与 `GenerationGallery`，采用左侧参数、右侧作品画廊的布局。桌面参数栏最小 280px，可拖动或收起；760px 以下复用工作区导航抽屉，通过「创作参数」重新打开。图片与视频提示词、比例等参数独立保存于 App 运行期间，切换工具不会清空。聊天组件与文件预览保持原有状态。

图片参数包含提示词、模型选择器和模型支持的比例/尺寸。视频已由 [037 · Muse 视频生成](../037-muse-video-generation/README.md) 接入，首版开放 5 秒、9:16 和可拖放/替换的实验性首帧参考图，移除了没有对应接口能力的运动幅度和帧率滑块。所有表单控件均支持键盘操作。

生图页也支持 [038 · 单张参考图生图](../038-image-to-image/task.md)：上传/拖入参考图，或从画廊作品/图片预览进入「以此图生成图片」，通过提示词修改原图。与视频首帧引用独立，生成时发送给支持图片编辑接口的服务，原图保留。

图片画廊由 [039 · 画廊管理](../039-image-gallery-management/task.md) 分为「作品 / 失败记录 / 已移除」：失败、中断和停止等待的记录不再堆积在作品前面；图片菜单与预览支持从画廊移除及恢复，保留本机原文件。生成作品的移除状态持久保存，本地导入仍只在本次运行保留。

图片空间已接入 OpenAI Images 文生图，使用方式见 [OpenAI 文生图接入](openai-images.md)。视频服务在设置 → 视频生成中配置，支持排队/进度、暂停/恢复查询、作品保存和重启恢复；两类请求均由 Rust 直接发出，不依赖 pi。单图生成已由用户实测确认可用，当前仍需在服务设置中启用实验开关。画廊也可导入本地作品：图片打开大图弹窗，视频打开可控制的静音循环播放器；「以此图生成视频」会带入首帧参考图，启用条件与接口限制见 037。

本地导入文件只在当前应用运行期间保留，不将 blob URL 写入持久存储，作为首帧生成时才发送给服务；生成的 PNG/MP4 与作品信息持久保存，重启后自动恢复。导入图片接受 PNG / JPEG / WebP / GIF，最大 20 MB；视频接受 MP4 / WebM / Ogg / MOV，最大 100 MB，实际播放能力取决于 WebView 的编解码器。空文件、格式与大小错误有提示，不覆盖有效参考图。替换或移除单独上传的参考图时释放 URL，共享画廊图片时保留 URL，App 卸载统一释放剩余资源。无法解码的媒体显示预览失败状态。

样式使用现有主题、字号、间距、描边及圆角变量；轻量空状态插画由代码与现有图标绘制。新增样式纳入 `scripts/check-styles.mjs` 审计。

验证命令：

- `npm run build -- --emptyOutDir=false`
- `npm run check:ui`
- `npm test`
- `node tests/generation-workspace.browser.mjs`（预览服务端口 1421）：浅深色导航样式一致性、独立草稿、比例 / 时长、本地导入校验、大图弹窗与焦点恢复、真实本地 WebM 播放、图转视频、引用 URL 生命周期、聊天 / Commit 恢复、390 / 760px 抽屉及入口记忆。
- `node tests/workbench-tabs.browser.mjs`、`node tests/git-tree.browser.mjs`、`node tests/file-workspace.browser.mjs`：原导航与文件工作区回归。

截图位于 `dist/generation-workspace/`，生成文件不入库。OpenAI 接入另有 Rust 单测、浅深色浏览器交互和真实桌面 CDP 验证，详见接入文档。

视频接入验证见 [037 验证记录](../037-muse-video-generation/verification.md)。
