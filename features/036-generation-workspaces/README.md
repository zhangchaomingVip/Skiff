# 生图与视频创作空间

Activity Bar 在「文件」之后提供「生图」「生成视频」，复用既有按钮尺寸、选中与悬停态及 1.6px 线性图标。原有文件 / Commit / Git Tree Tab 的选择记忆不受影响，创作空间选择沿用 `skiff.workbench.v1`。

两个空间共用 `GenerationControls` 与 `GenerationGallery`，采用左侧参数、右侧作品画廊的布局。桌面参数栏最小 280px，可拖动或收起；760px 以下复用工作区导航抽屉，通过「创作参数」重新打开。图片与视频提示词、比例等参数独立保存于 App 运行期间，切换工具不会清空。聊天组件与文件预览保持原有状态。

图片参数包含提示词、模型选择器和 1:1 / 16:9 / 9:16 / 4:3 比例。视频增加运动幅度、2–15 秒时长、12–60 fps 帧率，以及可拖放或替换的首帧参考图。比例与所有表单控件均支持键盘操作。

本次交付为界面骨架，尚未接入图片或视频生成服务。模型选择器与生成按钮明确禁用，不调用 pi 或产生模拟生成结果。画廊可导入本地作品以使用预览与图转视频流程：图片打开大图弹窗，视频打开可控制的静音循环播放器；图片卡片悬停、键盘聚焦或触屏下显示「以此图生成视频」，点击跳转并带入当前图片作为首帧，保留已填写的视频运动描述。

本地文件只在当前应用运行期间保留，不上传、不将 blob URL 写入持久存储。图片接受 PNG / JPEG / WebP / GIF，最大 20 MB；视频接受 MP4 / WebM / Ogg / MOV，最大 100 MB，实际播放能力取决于 WebView 的编解码器。空文件、格式与大小错误有提示，不覆盖有效参考图。替换或移除单独上传的参考图时释放 URL，共享画廊图片时保留 URL，App 卸载统一释放剩余资源。无法解码的媒体显示预览失败状态。

样式使用现有主题、字号、间距、描边及圆角变量；轻量空状态插画由代码与现有图标绘制。新增样式纳入 `scripts/check-styles.mjs` 审计。

验证命令：

- `npm run build -- --emptyOutDir=false`
- `npm run check:ui`
- `npm test`
- `node tests/generation-workspace.browser.mjs`（预览服务端口 1421）：浅深色导航样式一致性、独立草稿、比例 / 滑块、本地导入校验、大图弹窗与焦点恢复、真实本地 WebM 播放、图转视频、引用 URL 生命周期、聊天 / Commit 恢复、390 / 760px 抽屉及入口记忆。
- `node tests/workbench-tabs.browser.mjs`、`node tests/git-tree.browser.mjs`、`node tests/file-workspace.browser.mjs`：原导航与文件工作区回归。

截图位于 `dist/generation-workspace/`，生成文件不入库。本次未改动 RPC、Tauri 命令与 pi 发送链路，未运行真实桌面 CDP。
