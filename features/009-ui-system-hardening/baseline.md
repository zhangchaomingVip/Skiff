# 009 基线

版本：058367d88242cb95810c689c58f9b973c7609186。009/task.md 是用户提供的未跟踪方案，保留不修改原文。2026-10-09 Windows / Asia Shanghai。

基线命令：npm run build 成功；npm test 103/103；cargo test --manifest-path src-tauri/Cargo.toml --lib 19/19；cargo check 成功。Rust 既有 unused Write 警告不属于本次视觉修改。

复现：`npm run dev -- --port 1422`，打开 `/tests/preview.html?fixture=launcher&theme=light&static=1`。该端口与日常 1420 的 localStorage 隔离。preview 每次加载只清理本测试 origin 的 skiff.* 数据；没有真实 pi/网络请求。theme 在挂载前写入 DOM，不复制颜色表。static=1 固定 Date.now 为 2026-10-09 12:00 CST、消息 entryId、排序、价格、用量、动画；真实交互测试去掉 static。

fixture：launcher/single/multi/unknown 包含官方直连 wallet-a、第二线路 wallet-b、Kimi 未标注账户；empty/loading/error；chat 为固定 Markdown/工具错误/diff；long 为300条消息；settings/picker/voyage 使用同一正式页面，点击相应入口。

截图步骤：视口600×400、900×700、1200×800；theme light/dark；launcher 默认滚动；chat 固定恢复结束位置并收起 rail；settings 点击配置提供商；picker 点击选择模型；voyage 小视口显式展开 rail。共30张 before。未施加浏览器缩放修改，visualViewportScale=1、DPR=1，相同浏览器视口设置前后复用。原始截图为 browser API 返回JPEG，保留原始 .jpg；交付的30张PNG由原始JPEG解码后保存，不缩放、不重画。before 原始内容不覆盖。

基线代码盘点见 baseline-style-inventory.json：98 个 CSS 定义，108 处颜色字面量、18 处数值圆角、14 个同作用域重复选择器。9 处 CSS 外未解析引用中，7 处为真正缺失的 space-15/radius-xs，2 处 wake-duration/wave-duration 是合法 TS 运行时变量；最终审计会结合 CSSProperties 定义识别它们，不把运行时变量算作缺陷。

原始问题：浅色辅助文字不足4.5；缺失space-15/radius-xs；msg/composer/model-picker重复；按钮主次接近等权；卡片账户遗漏且必要价格截断；600px下侧栏与rail挤压聊天；模态无统一返回焦点保障；主题仅effect后初始化。以上是缺陷，不作为保留要求。

环境细节由 screenshots/environment.json 记录 Chromium 155 UA、DPR、字体栈、视口及系统环境。注册表确认安装 Segoe UI Variable / Microsoft YaHei UI / Cascadia Code；工具不提供逐字形实际字体回退。系统缩放未验证；已安装 WebView2 目录149/151不代表当前应用加载的版本。此项原生验收另记，没有将浏览器截图视作Tauri测试。
