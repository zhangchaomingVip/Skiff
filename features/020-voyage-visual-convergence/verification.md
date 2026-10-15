# 020 验收记录

完成日期：2026-10-15。本步仅实现 020；019、018 及后续联合回归等待用户逐步确认。

## 实现结果

- 仪表读数移到 SVG 下方，指针统一以 `(130,130)` 旋转。船的外层负责静态平移、内层负责 0～-3px 起伏；合并重复浪尾，保留航程条的小船。
- 刻度/轨道采用实色 token；SVG 刻度字号为 14 个用户坐标单位，最小 240px rail 下实际显示 **11.145 CSS px**，其余读数采用 HTML 字阶。
- 用户气泡增加专用背景/边界 token 与方向圆角；浅色主题补齐 shadow-color 和三档 elevation；禁用控件采用实色文字及边界、容器 opacity=1。隐藏 switch 输入改用裁剪，并把键盘焦点轮廓显示到 slider。
- 头部、消息、输入区共享 gutter。消息滚动条固定占位并补偿右侧间距；ResizeObserver 跟随实际内容列更新标题起点，覆盖大屏居中、侧栏/航行台宽度变化。窄屏标题与工具栏分行，composer 控件允许换行。
- 轮次与原生 details 复用 DisclosureLabel；受控按钮提供 status/actions 插槽，MessageList 提供带 requestKey 的 revealTurn 接口，便于后续搜索重复展开目标轮次。未接入搜索逻辑。
- 联网和推理档位采用局部 setting variant；共享 segmented 选中样式保留。用量行仅常显 Token 摘要和费用，线路/模型复制、命中率和完成时间收进原有弹层；保留费用精确复制与未知价格语义。

## 自动检查

| 检查 | 结果 |
| --- | --- |
| `npm test` | 157/157 通过 |
| `npm run build` | 通过；仍有既有主 JS chunk >500kB 提示 |
| `npm run check:ui` | 通过 |
| `npm run test:styles` | 131 token、126 组矩阵、0 样式错误、0 对比度失败 |
| `node tests/visual-convergence.browser.mjs http://127.0.0.1:1424` | 通过 |
| `node tests/turn-usage.browser.mjs http://127.0.0.1:1424` | 通过 |
| `node tests/voyage-needle.browser.mjs http://127.0.0.1:1424` | 通过 |
| `git diff --check` | 通过 |

浏览器：Windows 上 headless Edge **151.0.4129.101**，device scale factor 1。预览仅使用模拟 pi，无真实模型调用。使用已有运行时中的 Playwright，通过 `SKIFF_PLAYWRIGHT_DIR` 指定模块目录；未新增依赖。原有指针回归通过 `SKIFF_SCREENSHOT_DIR` 把截图写入本 feature，未覆盖 014 的历史证据。

浏览器检查详情：

- 两主题 × 240/260/480px rail × 21 个量程位置 × 两个起伏边界，共 **252 组**。等待字体就绪，使用实际 getScreenCTM、getBBox、带半笔宽余量的线段/矩形相交及针尖三角形相交；同时用人为穿过针线中点的矩形验证碰撞检测能命中。
- 0/0.5/1 针尖对应 `(50,130)`、`(130,50)`、`(210,130)`，整条针线/针尖不穿文字与船，针脚接 hub，半径 80 位于半径 90 弧线内。正常动画在 900ms 时的 -3px 边界和 reduced-motion 禁用动画分别通过。
- 检查最终文字字号、文字祖先 opacity、轨道/刻度祖先 opacity，以及 computed fill/stroke/color 的实际对比度。
- 两主题 × 360/1200/2200px 验证实际内容左起点一致、页面/composer 无横向溢出、窄屏标题不叠工具栏、发送按钮可达；2200px 下收起航行台后重新检查对齐。360px 下航行台 dialog 无横向溢出。
- Enter/Space 操作受控轮次和原生思考折叠；重复 revealTurn 请求能够重新展开同一轮次。元信息回归覆盖精确费用/模型复制、未知价格、新输入边界、历史/活动轮次、Escape 恢复焦点，以及最低 360×240 的弹层滚动和点击命中。
- 两主题下分别检查联网/推理激活态无实心填充，segmented 的实色选中态和方向键/Home 操作正常。三种按钮 variant、输入框和 switch 的禁用容器不叠透明度，文字对背景 ≥3:1，原生 disabled 阻止点击。

数值证据见 [browser-verification.json](browser-verification.json)。

## 审计护栏变化

统一结果继续写入 [009 的 style-audit.json](../009-ui-system-hardening/style-audit.json)。

| 项目 | 修改前 | 修改后 |
| --- | --- | --- |
| token 数 | 127 | 131（新增语义 token，同时移除两项遗留动画变量） |
| 组件内裸 px 字号 | 7 条，被 gauge 选择器豁免 | 0 条，已移除名称豁免 |
| 对比度矩阵行数 | 112 | 126（124 条有阈值，2 条为气泡/画布表面差异诊断） |
| 样式错误 / 对比度失败 | 0 / 0 | 0 / 0 |

新增 9 个故意失败的反例：gauge 名称下写 9px、通过别名引用 9px token、SVG fontSize 属性、SVG inline fontSize、CSS 文字祖先 opacity、SVG 祖先 opacity 属性、inline opacity、浅色缺一档 shadow、浅色 shadow alpha 超过 .12。反例通过内存源码覆盖运行，不改动工作区文件；已纳入 `npm test`。

| 关键对比度 | 深色 | 浅色 | 下限 |
| --- | --- | --- | --- |
| 气泡边界 / 画布 | 4.95 | 3.71 | 3 |
| 气泡边界 / 气泡底 | 3.75 | 3.39 | 3 |
| 仪表轨道与刻度 / 画布 | 4.95 | 3.71 | 3 |
| 禁用文字 / 控件底 | 7.61 | 6.02 | 3（本项目目标） |

## 截图

| 视口 | 深色 | 浅色 |
| --- | --- | --- |
| 1200×900 | [dark-1200.png](screenshots/dark-1200.png) | [light-1200.png](screenshots/light-1200.png) |
| 360×900 | [dark-360.png](screenshots/dark-360.png) | [light-360.png](screenshots/light-360.png) |
| 窄屏仪表弹窗 | [dark-360-gauge.png](screenshots/dark-360-gauge.png) | [light-360-gauge.png](screenshots/light-360-gauge.png) |

另附 [真实 reducer 指针回归截图](screenshots/needle/) 的输出、加速、停止三态。所有截图关闭动画，使用匿名测试数据。

## 验证边界

本次未运行 Tauri 原生 WebView2 窗口，也未覆盖高分屏、Windows 125%/150% 缩放和不同 WebView2 版本；这些仍需桌面人工验收。Rust 与 RPC 行为未改动。本 feature 不替代 019/018 完成后的搜索定位、草稿、队列与停止交互联合回归。
