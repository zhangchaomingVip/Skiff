# 034 验证记录

日期：2026-11-24。状态：已完成。实现和自动化检查都已完成，浏览器模拟测试没有运行，情况如下。

## 实现与边界

- 没有新增原生命令、Tauri 权限或配置迁移，也没有改 Rust 代码。关于页只用到现有的 `core:app:default`、`core:path:default` 和 `get_pi_auth_status`。
- 修改前做过的静态核对：
  - 逐字比对过两份 `SettingsWorkspace` 调用的参数，内容完全相同；
  - 同层被覆盖的样式先算出最终生效值再合并，并确认 `check-styles.mjs` 只检查同一个 `@layer` 块里的重复选择器；
  - 每次批量替换都先在内存里匹配全部原文，全部通过才写入，否则一处都不写；
  - 每次改完都核对 `index.css`、`tokens.css`、`ui.css`、`workspace-modes.css` 的大括号是否成对；
  - 在 `src` 里搜索过已删除的 `fonts`、`shortcuts` 分类和相关样式，没有残留引用。
- 用词统一时，全量扫描了 `src` 下非注释代码里的「聊天」「会话」。本地检查时补查了之前因访问权限没能读取的 10 个源文件，发现三处遗漏并一并改掉：`ProjectDialog.tsx`（移出项目的说明和「个聊天」计数）、`chat/workspace.ts`（默认草稿标题和工作区保存失败的报错）、`chat/sailing.ts`（上下文提醒的「新开会话」）。现在剩下的只有有意保留的「pi 会话文件 / 目录」和 `TITLE_PROMPT_MARKER`。

## 自动化检查

| 检查 | 结果 |
| --- | --- |
| `npm run build` | 通过 |
| `npm test` | 通过，426 个用例全部通过 |
| `npm run check:ui` | 通过 |
| `npm run test:styles` | 通过：244 个 token，0 个样式错误，126 组对比度全部通过 |
| `npm run test:cdp` | 未运行 |

已同步的单元测试断言：

- `tests/routeAuthorization.test.ts`：路由切换的第二个选项由「本次会话都同意」改为「本次对话都同意」。
- `tests/retrievability.test.ts`：只有图片时派生的标题由「图片聊天」改为「图片对话」。
- `tests/sailing.test.ts`：上下文提醒的「建议新开会话」改为「建议新开对话」。

## 浏览器模拟测试

`tests/*.browser.mjs` 里的旧文案已按新界面同步：设置从对话框变成工作区（`.settings-workspace`，导航在独立容器里），「关闭设置」改为「返回工作区」，并去掉了已删除的「快捷键」「路线」「默认主题色」等断言。

在本地 Vite 预览（Edge 无头，模拟 Tauri 桥）上运行并通过：

- 设置：`settings`、`prompt-settings`、`web-search-settings`、`browser-settings`、`theme-colors`、`star-themes`。
- 侧栏与检索：`sidebar-bulk`、`sidebar-recent`、`result-cards`、`file-workspace`、`diff-cache`、`resize-separator`、`preview-tabs`、`workbench-tabs`、`project-picker`、`title-generation`、`draft-recovery`、`retry`、`session-statistics`。
- 其他：`browser-panel`、`provider-toolbar`、`provider-model-config`、`provider-discovery-pricing`、`model-picker`、`image-edit`、`image-resolution`、`image-concurrency`、`video-generation`、`voyage-bento`。

没有通过、且用上一提交（5bde9ed）的临时工作树复跑确认同样失败的用例（与本次改动无关）：`settings-information`、`settings-management`、`sidebar-archive`、`browser-lifecycle`、`interactions`、`session-switch`、`providers-settings`、`provider-toggle`、`provider-reply`、`protocol-selector`、`retrievability`、`voyage`、`image-generation`。主要原因是更早的「家族 → 供应商模型」重构留下的断言（路线、来源筛选、保存载荷）还没跟上。`browser-control` 偶发超时，重跑通过。

## 本次补丁带来的界面修正

同步测试时发现三处只有移出对话框才暴露的问题，已一并修复：

- 设置不再是对话框后，Escape 关闭、Tab 焦点循环和关闭后的焦点恢复都失效了。现在由 `SettingsWorkspace` 在窗口级处理，嵌套对话框打开时让位给对话框。
- 窄屏（≤760px）下设置侧栏被移除，导航落在一个已经脱离文档的 portal 里，整块消失。现在切换断点时重新寻找挂载点，窄屏把导航放回工作区，并让「返回工作区」在导航滚动时保持可见。


## 人工验收

在 Tauri 桌面端（Windows，1100×750 逻辑尺寸左右）截图检查。颜色是按截图取像素比对的：

| 场景 | 结论 |
| --- | --- |
| 浅色渐变接缝 | 修复前，同一高度下活动栏为 `rgb(225,239,253)`，导航区为 `rgb(210,231,252)`，颜色断开；修复后两者为 `rgb(211,232,253)` 和 `rgb(213,233,253)`，从上到下渐变连续 |
| 选中样式统一 | 浅色下，导航选中项为 `rgb(186,212,238)`，齿轮选中块为 `rgb(191,214,238)`；深色下分别为 `rgb(40,46,62)` 和 `rgb(41,47,62)` |
| 下拉框边框 | 与卡片边框同色，都是 `rgb(214,220,229)` |
| 星空主题开关 | 由全局饱和蓝改为 `rgb(71,95,150)` |
| 外观页结构 | 卡片顺序、色块描边加 ✓、分段控件、字体两行都符合约定 |
| 活动栏 | 选中为浅色块，没有竖条；设置打开时只有齿轮高亮 |
| 关于页 | 版本 0.0.1、Tauri 2.12.1，两个路径显示正确 |
| 浅色下「深色背景」卡片 | 第一版做成了平时变淡、悬停恢复，实际表现为悬停时闪烁（[截图](screenshots/issue-dark-card-hover-fade.png)）。现在已改为不变淡，修改后的状态还需要再截一张图确认 |

## 截图

截图只保存在本地，没有纳入版本库。

- [改前：浅色外观页](screenshots/before-appearance-light.png)
- [参考：圆角内容卡片](screenshots/reference-card-layout.png)、[参考：活动栏](screenshots/reference-activity-rail.png)
- [改后：浅色外观页](screenshots/after-appearance-light.png)：这张截于移除变淡效果之前，当时鼠标正停在卡片上，所以呈现的样子和最终状态一致
- [改后：深色星空黑外观页](screenshots/after-appearance-dark.png)
- [改后：浅色 Code 工作区](screenshots/after-code-workspace-light.png)：截于渐变接缝修复之前
- [改后：关于页（第一版）](screenshots/after-about-light-r1.png)：复制按钮统一为纯图标之前的版本

## 未覆盖项

- 没有运行浏览器模拟测试和 `npm run test:cdp`，其中浏览器脚本的断言还没同步新文案。
- 没有验证窄屏 ≤760px 的布局（本期不处理）。
- 没有截以下几张：关于页最终版、修复接缝后的 Code 工作区、星空蓝主题、Design 工作区的设置页。
- 没有验证 macOS 上 Cmd 的显示。
