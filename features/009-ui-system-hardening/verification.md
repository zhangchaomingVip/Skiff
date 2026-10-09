# 009 实现与验收记录

2026-10-09，基线版本 `058367d88242cb95810c689c58f9b973c7609186`。本次完成视觉系统、组件与页面迁移，以及浏览器模拟 bridge 下的行为回归。**Tauri 专属交互验收尚未完成**：本地 debug 应用启动成功，能读取 WebView2 页面；两次窗口恢复/激活均失败，不能操作窗口。未把浏览器通过项替代为原生通过项。用户提供的 task.md 保留原文，不勾选未执行的检查。

## 命令结果

| 检查 | 结果 |
| --- | --- |
| `npm run build` | 严格 TypeScript 与 Vite 构建成功 |
| `npm run check:ui` | 正式组件展示页与 Composer harness 类型检查成功 |
| `npm test` | 107/107，通过协议、历史、计费、授权、配置保存和新增主题/样式检查 |
| `npm run test:styles` | 123 个定义（含兼容/运行时变量），0 样式错误，112 组对比度，0 不达标 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 19/19 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 成功 |
| `git diff --check` | 通过 |

Vite 仍有既有 >500KB chunk 提示；最新 JS 640.95KB，gzip 205.84KB，CSS 约86.39KB。Rust 测试仍有既有 unused `Write` 警告。新增 PostCSS 是 devDependency（Vite 本已间接使用），仅用于结构化 CSS 审计；没有新增运行时依赖。未生成提交或 PR，dist/target 为忽略的构建产物。

## 迁移结果

| 范围 | 实现 |
| --- | --- |
| Token / CSS | reset → pages → components → accessibility；语义颜色、123 个有限定义；缺失 space-15/radius-xs 补齐；同作用域重复规则收敛；普通文字最低4.51:1、被测边界最低3.12:1 |
| 组件 | Button / IconButton / Card / ListRow / Field / Input / TextArea / Select / Chip / Dialog / Popover / Tooltip / SegmentedControl，采用 ui-* 作用域；28/32/36px 控件与16/20/24px通用 SVG |
| 主题 | React 前的共享初始化脚本；system/light/dark 持久化；存储失效回 system；仅 system 监听系统；color-scheme 与 Tauri setTheme 同步代码、主题切换抑制 transition |
| Launcher | 一个蓝色主 CTA；模型 ID 换行；默认线路、线路数、输入/输出价格、币种、每百万 token、账户默认可读；多线路独立选择，未标注账户明确展示 |
| 聊天 / Composer | 原语化输入、附件、模型/推理选择、停止等操作；统一正文/工具/错误表面；代码字体使用 Cascadia Code 栈；缩略模型标签只截断自身，不裁掉品牌和箭头 |
| 设置 | Project / Confirm / Families / OfferPicker / Prompt / Search / ImagePreview 使用共享 Dialog；保留字段受控值、表单提交和 pending 保护；长表单垂直滚动到保存操作 |
| Voyage / 导航 | 功能 Unicode 改 SVG；保留 Boat 品牌；<=760px 侧栏模态抽屉、航行台模态详情；不挤压 Composer；关闭后回稳定触发位置 |

页头模型展示改为家族 / 模型 ID / 线路，避免原 alias 已含线路时再次拼接。普通 Tooltip 不保存唯一计费或授权信息。

## 实际 UI 行为

以下在独立 `localhost:1422/tests/preview.html` 或 `tests/ui.html` 中执行。行为测试去掉 static=1；模拟 bridge 不调用真实提供商。

| 操作 / 期望 | 实际结果 |
| --- | --- |
| 非提交按钮不触发 form；Field Enter 仅提交一次；loading 禁用重复操作 | 展示页计数符合预期；pending 时按钮 disabled |
| 添加项目初始聚焦路径；pending 禁止 Escape/关闭/取消 | 初始 project-path；填写路径并提交，pending 期间弹层保留，操作禁用 |
| 删除确认初始聚焦取消；Escape 返回触发器 | 默认“取消删除”；关闭返回“删除确认” |
| Tab/Shift+Tab 留在模态内 | 首尾循环通过；对原生 dialog 增加显式循环，复测未离开模态 |
| 普通表单不因外部点击丢弃草稿 | 共享 Dialog 默认保留；ImagePreview 保留背景关闭；侧栏 drawer 显式允许背景关闭 |
| 设置长表单 / Escape | 600px 可滚到保存按钮；编辑页 Escape 返回列表，再 Escape 关闭；Composer 的“保留草稿”仍在，焦点回配置提供商 |
| 窄屏侧栏 / Voyage | 600×400 使用真正 showModal；背景 inert；关闭侧栏焦点回“展开侧栏”，关闭航行台回 voyage-summary |
| 模型 Popover / 线路选择 | 搜索、上下、Enter、Escape 可用；ArrowDown 不提交；Enter 确认具体 Offer；Escape 返回模型按钮，聊天草稿保留 |
| 浮层边界 | 600px 模型浮层实测 left77/right437/top12/bottom259，落在视口内；标准矩阵页面 scrollWidth 等于视口宽 |
| 键盘 Tooltip | 聚焦“查看说明”后 opacity=1、aria-describedby 有关联；Escape 隐藏，焦点仍在按钮 |
| Composer Enter / Shift+Enter / 停止 / 附件 | 真实 UI Enter 发送；Shift+Enter 保留换行；停止终止 mock 流；通过 filechooser 添加 polish.txt，发送后草稿与附件清理，历史保留附件 |
| Composer IME / 建议优先级 / 重复发送 | 正式 Composer harness：isComposing 与 keyCode229不发送、Shift+Enter不prevent、命令菜单Enter优先、重复Enter仅一次、accepted清空草稿，输出PASS；属于合成 DOM 事件，未替代实体中文输入法验收 |
| 单线路 | deepseek-flash 卡直接进入聊天，无线路确认；实际页头与 pi mock 模型一致 |
| 多线路 | deepseek-chat 确认第二条 Offer 后，实际页头为硅基低价 · deepseek-chat |
| 未标注账户 | Kimi 默认展示“未标注”、CNY输入/输出单价；直接启动 Kimi 实际模型成功 |
| 当前会话切换 | 经模型选择器切换实际会话模型成功 |
| 跨账户授权 | authorization fixture 发送“触发跨账户”，503后点恢复；提示wallet-a→wallet-b。“保持失败”仍为官方直连；再次恢复并“同意”才变硅基低价。未授权时未自动切换 |
| 历史及旧价格 | 单线路发送文本附件，费用¥0.84；设置将输入单价1改为100，再创建草稿并以键盘恢复旧会话，旧回复仍显示¥0.84，附件仍在 |
| 三态主题 | UI light→dark→system；data-themePreference / data-theme / color-scheme 一致；初始化、失效存储及系统事件由 VM 测试额外覆盖 |

修复了两项显式行为问题：Launcher 复用当前空草稿时，原流程只更新保存的选择，未应用到存活的 pi 进程；现在先等待 setModel 成功再进入聊天。抽屉开启会卸载原触发器，原同步焦点恢复会落到 body；现在在 React 卸载完成后恢复，并给侧栏/Voyage 提供稳定 fallback。授权、快照与费用 reducer 没有改写。

## 视觉证据及偏差

见 [截图索引](screenshots/README.md)、[完整清单与哈希](screenshots/manifest.json)、[环境](screenshots/environment.json)、[标准布局测量](screenshots/layout-checks.json)、[边界布局测量](screenshots/boundary-checks.json)。before 30张原始基线、target 36张样例、after 74张结果；均交付PNG，before额外保留原始JPEG。

预期变化：浅色辅助信息和代码高亮加深；深色改为分层蓝灰表面；蓝色突出主操作；Launcher 增加原本遗漏的扣费账户及完整计费单位；多线路明确“选择线路”；窄 Voyage 从挤压主内容改为模态详情；Composer 去掉常驻浮层阴影、保留清楚的边界和焦点；设置/模型列表换行而非隐藏必需信息。

对照 target 共36组，33组解码后像素相同。3组600px图有局限于Voyage船标的8×8或18×18差异，坐标见 target-comparison.json；布局、文案、用量和操作位置一致。差异原因未由工具完全确定，保留原图与坐标，不能声称全矩阵逐像素一致。工具接口先编码JPEG再转PNG，也不等价于无损原生PNG采集。辅助 contact-sheet 仅用于浏览，不作像素判定。

流程偏差：design.md 与原语规格先建立，但 target 位图在页面迁移及原语行为验证之后，按已冻结规格使用正式 fixture 采集。它们是最终规格样例，不能作为“页面迁移前已采集目标位图”的证据。收尾的边界、语法对比度、焦点和标签布局修正已同步设计与目标样例。没有覆盖 before 掩盖变化。

## 样式保留与限制

自动审计采用 PostCSS AST，识别 var fallback、TS CSSProperties 运行时变量、layers、同作用域重复选择器、颜色/数值圆角/字号和控件高度。完整配色及比值在 [style-audit.json](style-audit.json)；基线原始清单在 [baseline-style-inventory.json](baseline-style-inventory.json)。不同断点有明确的布局差异，不当作同作用域重复定义。

- 品牌 SVG/Boat 保留；语法色和 diff 色在 token 层集中维护，语法文字在实际代码背景单独计算 AA。通用状态同时有文字/图标，不仅依赖色彩。
- gauge 的8/9/24为 SVG viewBox 坐标字号，整体缩放且有可读 aria-label；inline-code的.9em和内容专用行高保留，不用于新原语。
- 页面布局的宽度、滚动高度、仪表比例、导航行高、细节内距保留局部数值；新通用控件尺寸仅消费28/32/36 token。
- 局部 inset 滚动阴影、focus ring、usage/附件/诊断浮层阴影、switch小阴影共22处，审计清单明确位置；不作为新增组件任意阴影来源。
- 原生checkbox、file、标题栏窗口按钮、Sidebar导航按钮、工具details/summary、usage details保留语义专用规则；调用方分别为 FamiliesSettings/PriceImport/Composer/TitleBar/Sidebar/ToolCallBlock/TurnUsage。model-search由ModelPicker和侧栏搜索复用，level-options由ReasoningChip使用。
- 已删除无调用方的 .model-picker/.model-list/.model-option、model-number、model-badge、旧context-*进度条、clone-menu及 .btn/.icon-btn/.send-btn 视觉；页面 class 对迁移原语仅负责布局，原语层控制状态。

尚未通过：Tauri冷启动连续帧主题、原生最小600×400窗口的实际内区/DPR、原生弹层/键盘操作、真实系统主题变化/reduced-motion、实体中文输入法。浏览器静态冻结模式不能验证这些动态行为。系统缩放、应用实际加载的WebView2版本、逐字形回退也保留未知。原生验证失败原因是窗口激活工具限制，不是构建失败；没有继续重复激活，也没有把用户日常会话截图提交到仓库。
