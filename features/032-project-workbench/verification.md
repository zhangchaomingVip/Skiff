# 032 · 验证记录

日期：2026-10-28（Asia/Shanghai）

## 2026-10-29 · Diff 缓存

后续优化：缓存扩至 128 项 / 24 MiB；启动及状态变化后，每项目后台预读前 24 个变更文件，同时最多 2 项。原生单文件 Diff 不再调用整仓库写操作校验，使用目标文件状态和差异；缓存仍为运行期内存缓存。

- `npm test`：353 项通过；新增预加载并发、去重、版本失效、移除项目和失败重试覆盖。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib project_workbench`：13 项通过，包含子目录、特殊文件名、修改/删除/未跟踪文件、二进制和大文件截断。
- `node tests/diff-preload.browser.mjs`、`node tests/diff-cache.browser.mjs`：浅/深主题验证启动与重新加载预热、首次打开无新增查询、变更失效及原有缓存交互。
- `npm run test:cdp`：使用重新编译的独立调试程序与临时 WebView2/agent 目录，通过真实原生 Diff 预热、选中文件提交、推送至本地测试远程，以及原有 pi/Git Tree 链路；退出时恢复 localStorage。
- 文件预览 Tab 改为紧凑圆角、状态着色、选中背景/描边及独立关闭按钮；`node tests/preview-tabs.browser.mjs` 验证浅/深主题、长短文件名、悬停、切换、关闭及窄窗口。截图：`dist/preview-tabs/`。构建、UI 类型检查和样式审计通过。

以下为预加载优化前的初版验证记录：

- `npm test`：346/346 通过，新增缓存测试覆盖并发去重、相对路径规范化、跨项目隔离、Git 状态联动失效、单文件强制刷新、迟到响应、失败重试、空/二进制 Diff、LRU 数量/内存上限及项目移除。
- `npm run build`、`npm run check:ui` 通过；本轮仅改前端缓存与渲染，未改 Rust/Git 命令。
- `node tests/diff-cache.browser.mjs`：浅/深主题下验证 A/B/A 快速点击只产生两次原生 Diff 查询，缓存切换与重开不显示读取占位；返回聊天、关闭重开、文件/Diff 模式切换复用缓存。手动刷新仅重读当前文件，同名跨项目隔离，状态变化与提交后重新读取，失败显示错误且可重试。
- `node tests/project-git.browser.mjs`：项目上限、本地项目、AI 编辑刷新、Diff 更新及五分钟轮询回归通过。
- 首次读取或失效后仍需执行原生 Git 查询；本轮验证缓存命中时不重复发起查询，没有宣称首次打开的耗时改进。

## 2026-10-29 · 项目上限与后台刷新

- 后续 Git 列表调整：`node tests/git-groups.browser.mjs` 覆盖 Changes/Unversioned Files 分组与计数、已跟踪新增文件归类、整组/半选、折叠时选择、禁用条目、按项目恢复折叠/选择、提交路径精确传递、Diff、刷新后选择失效、空组和窄屏。文件行缩至 11px、26px 行高，并显示父目录相对路径及完整悬停提示。截图在 `dist/git-groups/`，不提交生成文件。

- `npm run build`、`npm run check:ui`、`npm test`（339/339）、`npm run test:styles`（0 错误、0 对比度失败）通过。
- `node tests/project-picker.browser.mjs`：浅/深主题、搜索、键盘选择、跟随当前项目、添加入口及窄屏抽屉通过。
- `node tests/project-git.browser.mjs`：六项目旧列表整理、满额替换与取消、重复文件夹不占名额、聊天/会话保留、本地项目状态、真实错误保留、AI 编辑触发所属项目刷新、打开的 Diff 更新通过；虚拟时间验证关闭侧栏后四分钟不轮询、五分钟刷新全部项目。覆盖浅/深主题及 600×680 窄屏整理弹窗。
- 新增单元测试覆盖五项目替换与恢复、缓存去重、移除项目后迟到结果、非仓库与实际故障区分、写入期间暂停/恢复、查询期间 AI 改动的追加刷新，以及后台聊天工具结果/运行完成的项目归属。
- `npm run test:cdp` 通过：1420 已由开发窗口占用，使用现有 `src-tauri/target/debug/skiff-desktop.exe` 的临时副本（`SKIFF_CDP_BINARY`），临时 WebView2 profile 和临时 agent 目录；本地 mock 收到真实 pi 请求，DOM 收到流式回复，页面无异常，localStorage 快照在 finally 恢复。此轮未修改 Rust，未重新编译原生二进制。
- 截图：`dist/project-git/{light,dark}-{limit,replace,local}.png`、`dist/project-git/narrow-limit.png`；只作本地验收产物，不提交生成文件。
- 本轮未验证外部程序文件变化的即时通知；外部变化依靠五分钟轮询、窗口焦点或手动刷新。既有未覆盖原生边界案例见下文。

## 自动检查

| 检查 | 结果 |
| --- | --- |
| `npm run build` | 通过 |
| `npm test` | 通过，326/326 |
| `npm run check:ui` | 通过 |
| `npm run test:styles` | 通过，0 个样式错误、0 个对比度失败 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 通过，62 通过、1 个既有环境测试忽略 |
| `git diff --check`（本功能路径） | 通过 |

新增前端测试覆盖全局 3 标签 FIFO、重复标签不提升淘汰顺序、跨项目同名文件身份，以及手动项目选择/失效回退。新增 Rust 临时仓库测试覆盖：仅提交所选文件、保留未选文件的 staged/worktree 内容、首次提交、中文与空格路径、写入前版本变化拒绝、Rollback 恢复 tracked 文件且不删除 untracked 文件。所有写测试均使用系统临时目录。

## 交互验证

- 浅色桌面真实 Tauri 窗口：活动栏层级、会话/文件/Git 切换、懒加载展开 `src`、`App.tsx` 行号与语法高亮预览通过。
- 真实 Tauri → Rust → Git：读取当前分支、HEAD、统一变更列表，并打开 `src/App.tsx` 的 HEAD 完整 Diff 通过。修复并复验了 Windows `\\?\` 规范路径用于显示后再参与比较导致的误判。
- 深色 mock 预览：文件面板 token、长路径下拉、目录/文件层级通过。
- 约 422px 窄屏 mock 预览：抽屉内仍可切换会话/文件/Git，活动栏与面板不挤压主工作区。
- 开发者仓库仅执行读取验证；commit 与 Rollback 按设计只在测试创建的临时仓库执行。

## 未覆盖项

- 未运行 `npm run test:cdp`：验证时 1420 端口正由现有 Tauri 开发窗口占用；本轮已在该真实窗口人工覆盖新增 UI → Tauri → Rust 文件/Git 读取链路，但尚未把流程加入 `tests/app.cdp.mjs`。
- 未单独完成 200% 系统缩放截图、子模块/嵌套仓库、冲突与进行中的 merge/rebase 的端到端夹具验收。
- hooks、签名和外部 `.git/index.lock` 的错误展示走统一失败后刷新路径，但没有建立会修改用户全局 Git 配置的集成夹具。
