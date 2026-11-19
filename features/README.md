# Skiff 特性索引

每个编号文件夹对应一次迭代，内含设计（DESIGN.md）、任务（task.md）与验证（verification.md）记录；截图等证据在各文件夹 `screenshots/` 下。编号为连续流水号，2026-11-18 整理后重排，整理前的旧编号映射见文末。

## 骨架与主页

| 编号 | 特性 | 状态 |
| --- | --- | --- |
| 001 | [聊天工作区布局](001-chat-workspace-layout/DESIGN.md)：项目导航 + 聊天双栏 | 已完成 |
| 002 | [聊天能力](002-chat-capabilities/DESIGN.md)：推理等级、Token 明细、图片附件 | 已完成 |
| 003 | [聊天界面打磨](003-chat-buttify/DESIGN.md)：Markdown、代码复制、消息操作 | 已完成 |

## 模型配置与选择

| 编号 | 特性 | 状态 |
| --- | --- | --- |
| 004 | [模型家族与渠道](004-model-families/DESIGN.md)：配置 v2、DPAPI 加密 | 已完成（概念模型被 005 取代） |
| 005 | [中转×家族=线路](005-relay-routes/DESIGN.md)：配置 v3 | 已完成 |
| 006 | [线路选择信任与计费](006-route-selection-trust/DESIGN.md)：钉住、别名、授权切换，配置 v4 | 已完成 |
| 017 | [最新模型发现](017-latest-model-discovery/DESIGN.md)：官方文档页 + models.dev 双源 | 已完成 |
| 024 | [模型选择器](024-model-picker/task.md)：Kimi Code 风格合并入口与收藏 | 已完成 |

## UI 体系与对话页打磨

| 编号 | 特性 | 状态 |
| --- | --- | --- |
| 007 | [UI 系统硬化](007-ui-system-hardening/design.md)：设计 token、cascade layers、组件原语 | 已完成（Tauri 交互验收遗留） |
| 015 | [航行台与对话页视觉收敛](015-voyage-visual-convergence/task.md) | 已完成 |
| 021 | [聊天阅读体验](021-chat-reading-experience/DESIGN.md)：过程摘要、思考折叠；含对话页视觉与交互修改（原 031） | 已完成 |

## Voyage 航行台

| 编号 | 特性 | 状态 |
| --- | --- | --- |
| 009 | [工具航迹带](009-voyage-tool-waterfall/task.md)：工具瀑布、阶段计时 | 已完成 |
| 011 | [上下文统计口径修复](011-context-usage-correction/task.md)；含航行台统计与工具日志展示（原 014，其上下文口径由本特性取代） | 已完成 |
| 032 | [航行台重构](032-voyage-redesign/DESIGN.md)：数据看板四卡、领航员、工具航迹；取代 010/015 的仪表盘与钓鱼态设计（补录） | 已完成 |

## 会话运行与侧栏

| 编号 | 特性 | 状态 |
| --- | --- | --- |
| 008 | [会话切换性能](008-session-switch-performance/task.md) | 已完成 |
| 010 | [侧栏归档与宽度调节](010-sidebar-archive-polish/task.md) | 已完成 |
| 012 | [多会话并行](012-parallel-sessions/task.md)：按会话运行池 | 已完成 |
| 013 | [对话交互完整性](013-chat-interaction-integrity/task.md)：插话、停止、截断 | 已完成 |
| 014 | [会话可检索性](014-session-retrievability/task.md)：正文搜索、标题派生、后台角标 | 已完成 |

## 设置

| 编号 | 特性 | 状态 |
| --- | --- | --- |
| 016 | [统一设置入口](016-unified-settings-entry/task.md) | 已完成 |
| 018 | [供应商独立入口](018-provider-settings-split/task.md) | 已完成 |
| 019 | [设置信息整理（一期）](019-settings-information-redesign/task.md)；含模型家族设置截图（原 027） | 已完成 |
| 020 | [设置批量管理（二期）](020-settings-management-tools/task.md) | 已完成 |
| 033 | [会话统计](033-session-statistics/README.md)：项目、提供商、模型与生成记录 | 已完成 |

## 项目工作台

| 编号 | 特性 | 状态 |
| --- | --- | --- |
| 022 | [项目工作台](022-project-workbench/task.md)：双层侧栏、文件树、Commit/Diff | 已完成 |
| 023 | [Git 历史树](023-git-tree/DESIGN.md) | 已完成 |

## Agent 能力

| 编号 | 特性 | 状态 |
| --- | --- | --- |
| 025 | [Agent 浏览器](025-agent-browser/DESIGN.md)：A–G 分阶段落地 | 已完成 |

## 生成与 Design 工作区

| 编号 | 特性 | 状态 |
| --- | --- | --- |
| 026 | [Muse 图生视频](026-muse-video-generation/task.md)：含接入评估 | 已完成（真实生成确认可用） |
| 027 | [单张参考图生图](027-image-to-image/task.md) | 已完成 |
| 028 | [画廊管理](028-image-gallery-management/task.md)：作品/失败/已移除 | 已完成 |
| 029 | [图片分辨率配置](029-image-resolution-configuration/task.md) | 已完成 |
| 030 | [图片并发](030-image-concurrency/task.md) | 已完成 |
| 031 | [Code / Design 双工作区](031-code-design-workspaces/task.md)：顶层导航，整合 026–030；含创作空间使用说明（原 036）与 OpenAI 文生图接入文档 | 已完成 |

## 已删除的条目（2026-11-18 整理）

- 原 007 模型优先主页：该 Launcher 入口已废弃并从代码移除（空会话直接进聊天视图，模型选择走输入区选择器）。
- 原 010 航行台体验（速度统计、钓鱼等待态）：钓鱼态与旧仪表盘已在 032 重构中移除，设计文档删除。
- 原 001 Tauri hello-world：可丢弃原型，使命已由 001 聊天工作区接替。
- 原 010 chat-new：仅一个首页 HTML mock，属于后来同样被废弃的主页探索。
- 原 022 computer-use：调研后否决（GUI 子执行器接入维护成本太高、收益低频）；浏览器方向的自动化由 025 承担。

## 整理编号映射（旧 → 新）

2026-11-18 经三轮整理后重排为连续编号 001–032：

- 删除：Tauri hello-world 原型、chat-new 首页 mock、computer-use（调研否决）、模型优先主页（废弃并移除代码）、航行台体验设计（功能由 032 取代）。
- 合并：voyage-panel-polish → context-usage-correction、model-family-settings 截图 → settings-information-redesign、对话页视觉修改 → chat-reading-experience、generation-workspaces → code-design-workspaces。
- 重排：002→001、003→002、004→003、005→004、006→005、008→007、009→008、011→009、012→010、013→011、014→012、015→013、016→014、017→015、018→016、019→017、020→018、021→019、022→020、023→021、024→022、025→023、026→024、027→025、028→026、029→027、030→028、031→029、032→030、033→031、034→032。
