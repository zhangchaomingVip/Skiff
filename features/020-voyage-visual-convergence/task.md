# 020 · 航行台与对话页视觉收敛

状态：待实施。创建日期：2026-10-15。承接 `009-ui-system-hardening` 的 token 与原语体系，依赖 `012`~`014` 的航行台实现。
来源：设计 agent 评审，逐条源码复核；其中仪表盘重叠一项在复核中定位到比原报告更准确的根因（见下）。

## 背景与目标

009 已经建立 `src/tokens.css` 的语义 token、全局 `:focus-visible`（`src/index.css:9`）、层化规则和 `scripts/check-styles.mjs` 的 token/对比度审计。本 feature 不重做设计系统，只处理**审计护栏被主动豁免**以及**009 之后新增代码绕过体系**所造成的回退。

### 1. 仪表盘指针旋转中心错误（根因修正）

`src/components/VoyageRail.tsx` 的指针 `<line x1="130" y1="130" x2="130" y2="50" />` 以 `(130,130)` 为轴心绘制，hub 圆心也是 `(130,130)`，但 `src/voyage.css:53` 写的是 `.voyage-gauge-needle { transform-origin: 110px 115px }`。

按 `position=0` 时的 `rotate(-90deg)` 计算，针的两端从 `(130,130)/(130,50)` 变成 `(125,95)/(45,95)`：针变成一条位于 `y=95` 的水平线，**既不经过 hub，又横穿 `y=85` 的「船速 · 输出」标签与 `y=115` 的读数之间，并一直伸到弧线左端之外**。截图中「0.0」被黑色指针穿过、指针与蓝色 hub 脱节，正是这一处坐标不一致的结果，而不是装饰过度。

修复方向：`transform-origin` 对齐到 `(130px,130px)`，并复核 `angle = -90 + position * 180` 与弧线路径 `M40 130 A90 90 0 0 1 220 130` 的起止角是否一致（弧线圆心在 `(130,130)`、半径 90，端点 `(40,130)`/`(220,130)` 对应 -90°/+90°，与当前角度公式吻合，说明只需修 origin）。

### 2. 写在 SVG 元素上的定位规则是死代码

`src/voyage.css:57` 的 `.voyage-scene-boat` 与 `:58` 的 `.voyage-wake` 都声明了 `position: absolute; left; top; width; height`，但这两个 class 挂在 `VoyageRail.tsx` 的 SVG `<g>` 与 `<path>` 上。CSS 定位属性不参与 SVG 内部布局，因此这些规则**全部无效**，只有 `transform`/`animation`/`opacity` 生效。同时 SVG 内还另画了一条小船 `<path d="M95 143 L115 143 …">`，与小船图标形成重复。

后果是船与浪尾的位置只能靠路径坐标硬写，改一处要对齐一串数字，这也是重叠问题反复出现的原因。修复方向：小船与浪尾统一用 SVG 用户坐标（`transform` 平移），删除无效的 CSS 定位声明；确认场景内只保留一条船。

### 3. 字号护栏被豁免

`scripts/check-styles.mjs:31` 对字号外溢的判断是：

```js
if (file !== "src/tokens.css" && !decl.parent.selector?.includes("voyage-gauge")) errors.push(`Font outside scale: ${location}`);
```

即**任何选择器名里含 `voyage-gauge` 的规则都可以使用任意 px 字号**。`src/voyage.css:49,51,52` 的 9px/9px/8px 与 `:188` 的媒体查询覆盖正是靠这条豁免通过的。它把仪表盘变成了字号体系的法外之地，任何新组件只要起名带 `voyage-gauge` 就能绕过审计。

修复方向：给审计加一个显式的最小字号常量（含 SVG 文字），移除按选择器名豁免的机制，改为在 `tokens.css` 里定义 `--font-size-gauge-min` 之类的合法档位并让仪表盘消费它。

### 4. 轨道与刻度在浅色主题下几乎不可见

`src/voyage.css:180` 的 `.voyage-gauge-track { stroke: var(--border); opacity: .3 }` 叠加 `.voyage-gauge-ticks` 的 `opacity=".5"` 与 8px 刻度文字，使 0/150/300+ 三个标尺读数在浅色背景上有效对比远低于可读阈值。仪表盘的刻度因此形同虚设，用户无法判断 0.0 与 300+ 的相对位置。

修复方向：轨道用实色 token（不加 `opacity`），刻度文字提到 ≥11px 并去掉透明度；把「刻度文字最小字号」和「不得用 opacity 压低已审计文本」写进 `check-styles.mjs` 的审计项。

### 5. 用户气泡与画布几乎无区分

`src/index.css:183` 的 `.msg.user .msg-body { background: var(--panel) }`，而 `src/tokens.css:94` 把 `--panel` 定义为 `--color-bg-tertiary`。浅色主题下它与页面底色 `--bg` 的差值极小，气泡无边框、无投影，长对话中「谁在说话」只能靠右对齐推断。

修复方向：气泡改用有明确对比的 token（`--selected` 或 `--panel-2` + 1px `--border`），并在朝向侧收小圆角以形成方向感；把 `--panel` on `--bg` 作为一行新增对比度断言加入 `check-styles.mjs` 的矩阵（当前矩阵覆盖 `--color-text-*`、`--boundary`、`--danger` 等，未覆盖气泡底与画布）。

### 6. 浅色主题缺阴影覆盖

`src/tokens.css:71-73` 的 `--shadow-elevation-1/2/3` 硬编码 `rgba(0, 0, 0, .2/.3/.35)`，而 `[data-theme="light"]`（`src/tokens.css:126`）没有重定义这三档。`ui.css:39,43,48` 的 dialog、popover、tooltip 与 `index.css:95` 的 launcher chip 都消费 `--shadow-elevation-*`，因此浅色主题下投影发黑发脏。009 建立的「双主题成对维护」原则在这里被漏掉。

修复方向：在浅色块补齐 `--shadow-color` 与三档 elevation（浅色 alpha ≤ .12），并让 `check-styles.mjs` 断言每个 `--shadow-elevation-*` 在两个主题下都有定义。

### 7. 折叠条两套语言

`src/index.css:200` 的 `.turn-header` 带 `border-bottom: 1px solid var(--border)`（贯穿 900px 内容列的全宽横线），而思考过程用的是另一套 `<details>`/`.thinking-toggle`（`:201-204`，chevron 旋转 + hover 底色）。同为「可展开的过程信息」，一个有全宽分隔线、一个没有，导致 8 个字的「耗时 3s 1步」获得了与正文同级的视觉重量。

修复方向：统一为一个折叠组件规格（chevron 尺寸、文字字号、`tabular-nums` 数字、hover 底色、展开旋转角度一致），移除 `.turn-header` 的全宽 `border-bottom`，用间距替代分隔线。

### 8. 主操作不唯一

`src/components/ui.css:15` 把 `[aria-pressed=true]`、`[aria-checked=true]`、`.active` 统一渲染为 `background: var(--selected)` + `color/border: var(--accent)`。联网开关与思考档位 chip 因此和发送按钮（`Composer.tsx:168` 的 primary）在同一行里形成三个蓝色块，违反 009 的「一个视图一个主操作」。

修复方向：开关/档位的激活态改为「accent 文字 + 左侧短竖条或描边」，蓝色填充只保留给主操作。需要同时确认设置页里的分段控件（`ui.css:46` 的 `.ui-segmented`）不被误伤——它已有独立的激活样式。

### 9. 对齐线与禁用态回退

- 左右内边距不一致：`.chat-header` 用 `0 var(--space-8)`（`index.css:76`），`.messages` 用 `var(--space-8) var(--space-10)`（`:165`），`.composer-wrap` 用 `var(--space-3) var(--space-10)`（`:232`），标题与消息列左边缘相差 8px，三段内容没有共同对齐线。
- 禁用态两套标准：`index.css:7` 的 `button:disabled { opacity: .4 }` 与 `ui.css:16` 的 `.ui-button:disabled { opacity: .5 }`。009 已确立「状态不能只依赖颜色」，透明度双标会让同一界面的禁用项深浅不一。

修复方向：三栏统一一条水平内边距 token；禁用态收敛为单一 `--disabled-opacity`，并对禁用文本改用 `--muted` 实色而非透明度叠加。

### 10. 元信息行密度

`src/index.css:459-465` 的 `.message-actions` 常显，其中 `.turn-usage button` 使用 `--font-size-md`（14px，等于正文字号），使 token/百分比/时间戳与正文抢层级。密度与文案语义的收敛属于本 feature；「历史助手消息没有复制」属于 018 第 4 节，不在此重复实现。

修复方向：元信息降到 `--font-size-sm`/12px 与 `--muted`，默认只保留可决策的两项，其余进 popover。

## 执行任务

### 1. 仪表盘正确性

- [ ] 修正 `.voyage-gauge-needle` 的 `transform-origin`，用 0/中值/满量程三个角度截图确认针脚始终经过 hub 且不越过弧线。
- [ ] 删除 SVG 元素上无效的 `position/left/top/width/height`，小船与浪尾改用 SVG 坐标定位；确认场景内只有一条船。
- [ ] 轨道与刻度去掉 `opacity`，改用实色 token。

验收：`position=0` 与 `position=1` 两个极端下，指针、数字、标签、船四者无像素级重叠；hub 与针脚连接处连续。

### 2. 字号与审计护栏

- [ ] 移除 `scripts/check-styles.mjs:31` 按选择器名豁免字号的机制，改为合法档位常量。
- [ ] 仪表盘 SVG 文字全部 ≥ 审计最小值，并在 `tokens.css` 定义对应 token。
- [ ] 新增审计项：`--shadow-elevation-*` 双主题必须成对定义；气泡底色与画布对比度纳入矩阵。

验收：`npm run test:styles` 在移除豁免后仍为 0 error；故意写一个 9px 的 `voyage-gauge-*` 字号必须报错。

### 3. 主题与状态一致性

- [ ] 浅色主题补齐 `--shadow-color` 与三档 elevation。
- [ ] 统一禁用态透明度与文本色。
- [ ] 三栏水平内边距统一为单一 token。

验收：浅色主题下 dialog、popover、tooltip、launcher chip 投影与深色主题视觉权重一致；三栏左边缘在同一条竖线上。

### 4. 组件语言收敛

- [ ] 抽出统一折叠组件，替换 `.turn-header` 与 `.thinking-toggle` 两套实现，去掉全宽分隔线。
- [ ] 开关与档位 chip 的激活态去填充化，蓝色填充只留主操作。
- [ ] 元信息行降字号、降色阶、默认裁剪为两项。

验收：同一屏内可展开条目视觉规格完全一致；输入区一行只有一个填充主色块；元信息不再与正文同字号。

### 5. 回归

- [ ] 窄屏（<560px）确认 composer 控件行换行策略与发送按钮可达。
- [ ] 浅色/深色 × 宽屏/窄屏 四组截图归档到本目录 `screenshots/`。
- [ ] 运行 `npm run check:ui` 与既有 DOM 断言，更新因规格变化而失效的断言。

## 验收矩阵

| 场景 | 必须验证 |
| --- | --- |
| 指针几何 | 0/中/满三个 position 下针脚经过 hub、不穿数字与标签、不出弧线 |
| 刻度可读 | 0/150/300+ 与「船速 · 输出」在浅色主题下 ≥ 审计阈值 |
| 字号审计 | 移除 `voyage-gauge` 豁免后 0 error，且能拦住新的小号字 |
| 主题成对 | 三档 elevation 与 shadow-color 在两主题下均有定义 |
| 气泡辨识 | 用户/助手消息在无右对齐线索时仍可区分归属 |
| 折叠条 | 两套实现合并为一套后，展开态、键盘与 reduced-motion 行为一致 |
| 主操作唯一 | 输入区、设置页分段控件均不出现多块填充主色 |
| 对齐 | 三栏左边缘一致，窄屏不溢出 |
| 禁用态 | 单一透明度标准，禁用文本仍达最低对比度 |

## 非目标

- 不改 RPC、会话、模型选择与线路授权的任何行为语义。
- 不实现 018 的插话、停止、截断与扩展对话框功能。
- 不做侧栏结构与搜索（019）。
- 不追求 Voyage 隐喻的整体重设计：船、浪、航线语言保留，只解决它当前的几何与可读性问题。
- 不引入新依赖，不做一次性 `index.css` 全量重写（沿用 009 的渐进原则）。

## 验证要求

- 运行 `npm test`、`npm run build`、`npm run check:ui`、`npm run test:styles`。
- 几何问题用数值断言（指针端点坐标、重叠包围盒），不能只靠截图目测；截图仅作为归档证据。
- 对比度用 `check-styles.mjs` 的 `contrast()` 计算并纳入输出矩阵，与 009 的 `style-audit.json` 保持同一份口径。
- 完成后新增 `verification.md`，记录豁免移除前后审计条目数变化、四组主题/宽度截图与仍未覆盖的高分屏与 WebView2 行为。
