# 009 设计规格（2026-10-09 冻结）

采用 cascade layers：`reset → pages → components → accessibility`。现有 index.css / voyage.css 进入 pages；基础重置归 reset；组件原语有 `ui-*` 作用域，归 components。页面只负责原语的布局，不能覆盖尺寸、颜色和状态。不存在未分层的应用规则。保留品牌 SVG，不新增运行时依赖。

## 唯一规格

| 角色 | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| app | #fafbfc | #101318 | 应用背景 |
| sidebar | #f0f3f7 | #141922 | 导航 |
| surface | #ffffff | #1b222d | 卡片、字段、弹层 |
| subtle | #edf1f6 | #222c39 | 弱表面 |
| hover | #e1e8f2 | #2b394b | 可交互悬停 |
| selected | #dce8ff | #263e62 | 已选项，同时有文字/标记 |
| foreground | #192333 | #edf2f9 | 正文 |
| secondary | #48566b | #bdc9db | 次级信息 |
| muted | #55647a | #a5b4cb | 12px 辅助信息 |
| boundary | #758399 | #73859f | 可识别控件边界，悬停背景也至少 3:1 |
| divider | #d5dce6 | #354154 | 装饰分隔，不单独识别状态 |
| action | #2458be | #2458be | 唯一主动作，文字白色 |
| action hover / active | #1d4ca8 / #183e8a | 同浅色 | 按下反馈 |
| focus / selected foreground | #2458be | #91baff | 键盘焦点和选择 |
| success | #176a3d | #79dda3 | 文本与 SVG 标记 |
| warning | #805600 | #f4cd76 | 文本与显式提示 |
| danger | #b52b37 | #ff9ca5 | 错误文字与恢复操作 |

间距采用 4px 网格，2/6/10px 仅用于紧凑控件内部。控件：compact 28px，regular 32px，主操作 36px；IconButton 32px（compact 28px），图标 16/20/24px，统一 1.6px stroke。圆角：小细节 2px、控件 6px、卡片 8px、弹层 12px、Chip pill；新阴影只用于弹层和浮层，Voyage状态条及保留的局部滚动/细节阴影作为兼容例外列在verification。Windows 使用 Segoe UI Variable / Microsoft YaHei UI，macOS 使用 PingFang SC，mono 使用 Cascadia Code。

字级采用以下有限集合，值由 tokens.css 唯一定义。caption 12px，control 13px，body 14px，section 16px，editor title 18px，title 20px，metric/Markdown h1 24px，page 28px。11px 仅保留非关键时间、装饰刻度；计费字段、状态、辅助正文至少 12px。正文行高 1.6、控件 1.4；页面标题沿用正文行高，Markdown 标题 1.4。现有代码输出 1.65、长表单代码 1.7、Voyage 注释 1.5、状态 pill 1.35 属于内容排版的保留值，不用于新控件。字重 regular 400、medium 500、title 550、semibold 600、label 650、bold 700；title/label 保留变量字体的现有光学权重，已进入 token。局部代码相对字号与 gauge SVG 坐标字号作为比例图形例外，列在 verification。圆角 4px 仅保留 inline-code/旧细节兼容，不用于新控件。

状态：default 表面+边界；hover 弱表面；active 120ms pressed 反馈；selected 选中表面+aria-pressed/文字；disabled 禁止输入且降低透明度（对比度例外）；loading 禁用且显式“处理中”；error danger+关联错误文字。小号普通文本 >=4.5:1，控件边界对 surface >=3:1；divider 属装饰例外。自动检查记录实际比值。

## 页面布局与行为

标题栏保持 32px，页头 60px，导航宽 240px；主要内容 max 900px，Launcher max 1040px、内边距 24px。>1100px 三列模型卡，761–1100px 两列，<=760px 单列且默认收起侧栏；展开侧栏使用模态抽屉，Escape/背景关闭、焦点约束。Voyage >=1200px 默认展开为 240px 栏，其余默认 40px 收起；<=760px 展开使用原生模态详情面板，背景 inert、Escape/收起关闭，关闭后回到航行台状态条；不挤压 Composer。600×400 所有必需信息通过换行/垂直滚动可达。

模型默认线路、输入/输出单价（币种 + 每百万 token）、扣费账户必须默认可见。未知不等于免费。单线路直接启动；多线路 CTA 文案“选择线路”，确认前显示每条 Offer 自身的账户与价格。仅选中卡片或首个可用卡片使用 primary，其余 secondary。模型 ID 默认换行，详情可聚焦展开。计费/授权/快照契约遵循 task.md、007、008，不改状态机。

Dialog 使用原生 showModal（背景 inert、Tab trap），捕获初始焦点和返回目标；项目初始焦点路径，删除确认取消；没有弹层开启外部点击丢弃草稿。pending 禁止 cancel/关闭，Families Escape 优先返回当前编辑页。Popover Escape 只关闭最上层并返回触发器，外部点击保留点击目标焦点；焦点移动不选择模型。所有非提交 Button 默认 type=button，表单提交显式 type=submit。Composer 键盘/IME/附件/停止逻辑保留。

主题 public/theme-init.js 在 head 阻塞脚本中初始化，三态持久化，失效/不可用存储回退 system，仅 system 监听 OS。color-scheme 与 native setTheme 同步，主题切换短暂禁止 transition。Field 的 plain 变体用于 Composer 与已有搜索容器，取消内层边框和内层 outline，但保留容器焦点反馈。Composer 不使用浮层阴影，焦点只用品牌色边框/ring。微交互 150ms，reduced-motion 禁用位移/缩放。Dialog 关闭后在 React 完成卸载的 microtask 返回焦点；触发器会卸载的侧栏/Voyage 指定稳定返回位置。Tooltip 保留子控件的描述关联，支持键盘聚焦、Escape 隐藏，不承载唯一必需信息。

2026-10-09 收尾校准：边界颜色修正为表中值；浅色语法 comment #646d77、number/attr #916100、builtin #936000，修复在代码实际侧栏背景上的 AA 不足。target/after 截图已同步。其它语法色、diff 色、阴影、间距及兼容别名的完整有限取值以 tokens.css 和 style-audit.json 的清单为准；不额外维护第二份 CSS 调色表。

## 迁移表与目标入口

| 旧规则 | 正式替代 | 边界 |
| --- | --- | --- |
| .btn / .icon-btn | Button / IconButton | 删除视觉规则，调用方 class 仅定位 |
| input/textarea/select 视觉 | Input / TextArea / Select，Field 标签与错误关联 | checkbox / file 保留原生语义 |
| 原生页面 dialog | Dialog | 页面 class 仅宽度、内容布局 |
| Launcher 卡、行、能力 | Card / ListRow / Chip | 保留真实业务数组与回调 |
| scope | SegmentedControl | roving Tab 与左右/Home/End 键 |
| model-popover | Popover | 保留搜索/上下/Enter |
| Voyage Unicode 功能符号 | Icon | Boat 品牌隐喻保留 |
| .msg / .composer-context / .model-picker | 合并同作用域规则 | 删除失效 model-picker，保留断点明确差异 |

正式组件展示入口：`http://localhost:1422/tests/ui.html?theme=light`（dark 同理），包括适用状态、Dialog/Tooltip/Field 行为及正式 Launcher/Chat 预览链接。目标样例使用生产 preview fixture；screenshots/target 为规格校验后冻结的样例，禁止另写生产页面。后续任何规格修正须同步本文与 verification。
