# 020 · 航行台与对话页视觉收敛

状态：已实现并通过本项自动验收，等待用户确认进入下一步。创建、修订及完成日期：2026-10-15。承接 `009-ui-system-hardening` 的 token 与原语体系，依赖 `012`~`014` 的航行台实现；三个 feature 中最先实施。
来源：设计评审及完整 CSS 级联复核。原文只检查旧规则而误判指针中心，现按实际生效样式修正；源码行号仅供定位。

## 背景与目标

009 已经建立 `src/tokens.css` 的语义 token、全局 `:focus-visible`（`src/index.css:9`）、层化规则和 `scripts/check-styles.mjs` 的 token/对比度审计。本 feature 不重做设计系统，只处理**审计护栏被主动豁免**以及**009 之后新增代码绕过体系**所造成的回退。

### 1. 指针中心已有覆盖，仍需解决扫过文字的问题

`src/components/VoyageRail.tsx` 的指针 `<line x1="130" y1="130" x2="130" y2="50" />` 与 hub 均以 `(130,130)` 为轴心。`src/voyage.css:53` 虽有旧 `transform-origin: 110px 115px`，同一个 `@layer pages` 后面的 `:189` 已覆盖为 `130px 130px`，所以不能将前面的旧值当作当前脱轴根因。

按实际 origin 和 `angle = -90 + position * 180` 计算，0/中/满量程的针尖分别是 `(50,130)`、`(130,50)`、`(210,130)`，针脚均在 hub。中值时针线经过 x=130、y=50～130，恰好穿过基线在 y=85/115/128 的标签、数字和单位；只调整 origin 无法解决这种布局交叉。

修复方向：移除或统一旧 origin 声明，保留用户坐标中的 `(130,130)` 轴心；将数字、标签、单位移出指针扫掠区域，允许局部调整 SVG viewBox、读数区和船的位置。使用整条针及针尖的实际变换，而非只验证旋转角；指针和 hub 的接触是预期重叠。针尖应位于半径 90 的弧线内侧，不要求针尖落在弧线上。

### 2. SVG 场景遗留定位声明与重复浪尾

旧 `.voyage-scene-boat`、`.voyage-wake` 含 HTML 盒式定位声明，当前元素是 SVG `<g>`/`<path>`；后面的 `.voyage-gauge-svg .voyage-scene-boat` 已覆盖 `position`、`transform` 和动画。需要清理实际匹配的遗留声明与动画继承，不能把旧规则都当成当前布局依据。

当前 gauge 内船体和船舱路径共同组成一条船，另一个 `Boat` 用于上下文进度条，不属于同一场景重复。真正需核对的是 gauge 中两段相同坐标的浪尾路径，确认各自用途后合并无用重复。船与浪尾采用共同 SVG 坐标容器，外层控制静态布局、内层控制起伏动画，避免动画覆盖定位 transform；保留进度条上的独立小船。

### 3. 字号护栏被豁免

`scripts/check-styles.mjs:31` 对字号外溢的判断是：

```js
if (file !== "src/tokens.css" && !decl.parent.selector?.includes("voyage-gauge")) errors.push(`Font outside scale: ${location}`);
```

即**任何选择器名里含 `voyage-gauge` 的规则都可以使用任意 px 字号**。旧规则含 9px/8px，后面的集成 dashboard 普通覆盖含 10px/9px，并非媒体查询覆盖；当前文字仍小于目标最小值。

修复方向：移除按选择器名豁免，组件字号全部引用合法 token。仪表盘文字最小 11 CSS px，定义 `--font-size-gauge-min` 或复用不小于该值的档位；审计须解析 token 别名，拦住通过小号 token 绕过最小值的情况，并覆盖 SVG 的 fontSize 属性/内联样式。该最小值仅约束本次仪表盘文本，不借此全量改写其他页面字阶。

11 CSS px 指最终显示尺寸：SVG 会随 viewBox 缩放，单写 `font-size: 11px` 可能显示不足 11px。最小 rail 宽度下结合 CTM 缩放检查实际字阶，必要时提高 token 或调整读数区域，不能只看 CSS 声明值通过验收。

### 4. 轨道与刻度在浅色主题下几乎不可见

轨道的 CSS opacity=.3、刻度线 `<g>` 的 opacity=.5、标签 CSS opacity=.8 分别压低各自可见度；刻度数字本身不在该 `<g>` 内，不能把三者当成同一条透明度叠加链。读数、刻度线与轨道需要分别检查实际前景色及祖先透明度。

修复方向：轨道、刻度线及标签改用实色语义 token，关键文字及其祖先不加降低可读性的 opacity。两主题下普通文字对背景 ≥4.5:1，用于读数的轨道/刻度线对背景 ≥3:1。装饰浪花可保留透明度，不将装饰图形套用文字阈值；静态审计和浏览器 computed style 检查共同覆盖。

### 5. 用户气泡与画布几乎无区分

`src/index.css:183` 的 `.msg.user .msg-body { background: var(--panel) }`，而 `src/tokens.css:94` 把 `--panel` 定义为 `--color-bg-tertiary`。浅色主题下它与页面底色 `--bg` 接近，气泡无边框、无投影，角色标签之外主要靠右对齐辅助辨识，连续长对话的归属层次偏弱。

修复方向：引入气泡专用背景/边界 token，可加方向圆角，避免为了气泡改变所有 `--panel` 消费者。矩阵分别检查正文对气泡背景 ≥4.5:1、可见边界对相邻画布和气泡背景 ≥3:1；气泡底与画布的色差作为诊断行输出，不把两种浅色表面强行按文字 4.5:1 判失败。双方角色文字标签继续保留。

### 6. 浅色主题缺阴影覆盖

`src/tokens.css:71-73` 的 `--shadow-elevation-1/2/3` 硬编码 `rgba(0, 0, 0, .2/.3/.35)`，而 `[data-theme="light"]`（`src/tokens.css:126`）没有重定义这三档。`ui.css:39,43,48` 的 dialog、popover、tooltip 与 `index.css:95` 的 launcher chip 都消费 `--shadow-elevation-*`，因此浅色主题下投影发黑发脏。009 建立的「双主题成对维护」原则在这里被漏掉。

修复方向：在浅色块补齐 `--shadow-color` 与三档 elevation（浅色 alpha ≤ .12），并让 `check-styles.mjs` 断言每个 `--shadow-elevation-*` 在两个主题下都有定义。

### 7. 折叠条两套语言

`src/index.css:200` 的 `.turn-header` 带 `border-bottom: 1px solid var(--border)`（贯穿 900px 内容列的全宽横线），而思考过程用的是另一套 `<details>`/`.thinking-toggle`（`:201-204`，chevron 旋转 + hover 底色）。同为「可展开的过程信息」，一个有全宽分隔线、一个没有，导致 8 个字的「耗时 3s 1步」获得了与正文同级的视觉重量。

修复方向：抽出共用折叠触发器规格（chevron、字阶、`tabular-nums`、hover 和旋转角度），移除全宽分隔线。轮次折叠保留受控状态，思考过程保留原生 details 或等价键盘语义；统一外观不强迫改变内容结构。提供 status/action 插槽供 018 使用，019 的搜索定位能受控展开目标轮次。

### 8. 主操作不唯一

`src/components/ui.css:15` 把 `[aria-pressed=true]`、`[aria-checked=true]`、`.active` 统一渲染为 `background: var(--selected)` + `color/border: var(--accent)`。联网开关与思考档位 chip 因此和发送按钮（`Composer.tsx:168` 的 primary）在同一行里形成三个蓝色块，违反 009 的「一个视图一个主操作」。

修复方向：联网/档位 chip 使用局部 variant，激活态采用 accent 文字、描边和可区分标记，输入区主色实心填充只留主操作。不要全局改写所有 aria-pressed/active 控件；设置页分段控件保留其独立选中语义并回归。选中态不等于主操作，不能用「全应用只有一个蓝块」作为验收。

### 9. 对齐线与禁用态回退

- 左右内边距不一致：`.chat-header` 用 `0 var(--space-8)`（`index.css:76`），`.messages` 用 `var(--space-8) var(--space-10)`（`:165`），`.composer-wrap` 用 `var(--space-3) var(--space-10)`（`:232`），标题与消息列左边缘相差 8px，三段内容没有共同对齐线。
- 禁用态两套标准：`index.css:7` 的 `button:disabled { opacity: .4 }` 与 `ui.css:16` 的 `.ui-button:disabled { opacity: .5 }`。009 已确立「状态不能只依赖颜色」，透明度双标会让同一界面的禁用项深浅不一。

修复方向：头部、消息列和输入区共用水平 gutter token 与内容宽度约束，窄屏只覆盖该 token；验收比较实际内容起点而非只比较 padding 数值。禁用态使用单一规则：文字和边界采用专用实色 token，容器 opacity=1；如装饰图标需要变淡，限定在图标内部，避免父子透明度叠乘。禁用文字 ≥3:1 为本项目可读性目标，不宣称它是 WCAG 对所有禁用控件的强制门槛；原生 disabled/aria-disabled 及禁用交互仍须保留。

### 10. 元信息行密度

`src/index.css:459-465` 的 `.message-actions` 常显，其中 `.turn-usage button` 使用 `--font-size-md`（14px，等于正文字号），使 token/百分比/时间戳与正文抢层级。密度与文案语义的收敛属于本 feature；「历史助手消息没有复制」属于 018 第 4 节，不在此重复实现。

修复方向：元信息降到 `--font-size-sm`/12px 与 `--muted`，默认保留「Token 用量摘要」和「费用」两个入口；完整线路、缓存命中率、完成时间和明细移入同一个现有 popover。保留模型名/费用复制能力及可访问名称，未知价格仍显示未知，不能视作免费。正文复制按钮和角色标签不计入这两个元信息项，018 新增的结果标记与继续动作也不受两项限制。

## 执行任务

### 1. 仪表盘正确性

- [x] 统一旧/新 origin 声明，验证实际 computed transform-origin；调整读数布局，避开整段指针扫掠。
- [x] 清理 SVG 上遗留盒式定位，分离静态定位与动画 transform，核对重复浪尾；保留两个不同场景各自的小船。
- [x] 轨道与刻度去掉 `opacity`，改用实色 token。

验收：0/0.5/1 三点及每 0.05 的静态采样下，变换后的针线和针尖不穿数字、标签、单位和船；针脚与 hub 保持预期接触，针尖在弧线内侧。两主题及最小/默认/最大 rail 宽度验证，截图关闭动画，另行检查动画最大位移边界。

### 2. 字号与审计护栏

- [x] 移除 `scripts/check-styles.mjs:31` 按选择器名豁免字号的机制，改为合法档位常量。
- [x] 仪表盘 SVG 文字全部 ≥ 审计最小值，并在 `tokens.css` 定义对应 token。
- [x] 新增审计项：shadow-color 与 elevation 双主题成对；气泡文字/边界及仪表盘文字/刻度对比度；表面色差仅诊断。
- [x] 对小字号 token、SVG fontSize、文本祖先 opacity 和主题缺项加入能触发失败的反例，避免审计只接受当前实现。

验收：`npm run test:styles` 在移除豁免后仍为 0 error；故意写一个 9px 的 `voyage-gauge-*` 字号必须报错。

### 3. 主题与状态一致性

- [x] 浅色主题补齐 `--shadow-color` 与三档 elevation。
- [x] 禁用态统一为实色 token 与容器 opacity=1，覆盖图标和父子状态组合。
- [x] 三栏水平内边距统一为单一 token。

验收：浅色主题下 dialog、popover、tooltip、launcher chip 投影与深色主题视觉权重一致；三栏左边缘在同一条竖线上。

### 4. 组件语言收敛

- [x] 抽出共用折叠规格并保留受控/原生展开语义，去掉全宽分隔线，预留 status/action 与搜索展开接口。
- [x] 开关与档位 chip 使用局部 variant 去填充化，回归全局按钮与设置分段控件。
- [x] 元信息只常显 Token/费用入口，完整线路和时间进入明细，保留原有复制与未知值语义。

验收：过程折叠触发器外观一致且键盘行为正确；输入区只有一个实心主色操作；设置选中态可辨；元信息不与正文争层级，原有明细/复制功能可达。

### 5. 回归

- [x] 窄屏（<560px）确认 composer 控件行换行策略与发送按钮可达。
- [x] 浅色/深色 × 宽屏/窄屏 四组截图归档到本目录 `screenshots/`。
- [x] 运行 `npm run check:ui` 与既有 DOM 断言，更新因规格变化而失效的断言。

## 验收矩阵

| 场景 | 必须验证 |
| --- | --- |
| 指针几何 | 三点与全量程采样下针脚接 hub，扫掠不穿文字/船，针尖在弧线内侧 |
| 刻度可读 | 两主题文字 ≥4.5:1，轨道/刻度线 ≥3:1，检查祖先透明度 |
| 字号审计 | 移除 `voyage-gauge` 豁免后 0 error，且能拦住新的小号字 |
| 主题成对 | 三档 elevation 与 shadow-color 在两主题下均有定义 |
| 气泡辨识 | 专用 token；文字 ≥4.5:1、边界 ≥3:1；底色差单列诊断，角色标签保留 |
| 折叠条 | 两套实现合并为一套后，展开态、键盘与 reduced-motion 行为一致 |
| 主操作唯一 | 输入区主操作突出；设置分段选中语义不退化，无全局 active 误伤 |
| 对齐 | 三栏左边缘一致，窄屏不溢出 |
| 禁用态 | 容器无透明度叠乘，实色文字达项目 3:1 目标，禁用语义/交互保留 |
| 元信息 | 仅 Token/费用常显，明细、模型名/费用复制与未知值语义可达 |

## 非目标

- 不改 RPC、会话、模型选择与线路授权的任何行为语义。
- 不实现 018 的插话、停止、截断与扩展对话框功能。
- 不做侧栏结构与搜索（019）。
- 不追求 Voyage 隐喻的整体重设计：船、浪、航线语言保留，只解决它当前的几何与可读性问题。
- 不引入新依赖，不做一次性 `index.css` 全量重写（沿用 009 的渐进原则）。

## 验证要求

- 运行 `npm test`、`npm run build`、`npm run check:ui`、`npm run test:styles`。
- 几何问题用数值断言（指针端点坐标、重叠包围盒），不能只靠截图目测；截图仅作为归档证据。
- 几何断言使用实际 SVG CTM、文字 getBBox 及针线/针尖的线段或多边形相交，不能将斜针轴对齐包围盒的相交直接当成穿字。等待字体加载完成，必要时计入 stroke 宽度；截图覆盖 1200px/360px × 两主题，reduced-motion 与正常动画分别回归。
- 对比度用 `check-styles.mjs` 的 `contrast()` 计算并纳入输出矩阵，与 009 的 `style-audit.json` 保持同一份口径。
- 完成后新增 `verification.md`（现已归档），记录豁免移除前后审计条目数变化、四组主题/宽度截图与仍未覆盖的高分屏与 WebView2 行为。

## 后续联合回归

019 完成后复查搜索定位展开与输入区草稿提示，018 完成后复查队列条、两种发送入口、停止快捷键、结果标记和扩展对话框。020 自身验收通过不代替三个 feature 完成后的联合回归。
