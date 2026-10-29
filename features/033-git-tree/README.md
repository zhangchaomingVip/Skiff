# Git Tree · 2026-10-29

侧边工具栏依次为「对话」「文件」「Commit」「Git Tree」。Commit 继续处理未提交变更；Git Tree 浏览历史。沿用 032 的项目选择器，浏览其他项目不改变当前聊天。

桌面使用三栏：

- 左栏：所有分支、HEAD、本地分支、按远程分组的远程分支、标签；支持名称过滤。
- 中栏：按真实父提交关系绘制的拓扑图、提交标题、作者和精确到分钟的日期时间（24 小时制）。提交列表不显示 HEAD/分支标签，引用信息保留在分支树和提交详情中。点击或上下方向键选择提交。文本搜索匹配已加载的标题、作者、hash；搜索结果隐藏连线，避免把不相邻的提交错误连接。
- 右栏：提交的变更文件树、完整说明、作者、日期、hash 和父提交。点击文件读取该提交的历史 Diff，与当前工作区内容无关。合并提交默认与第一父提交比较，初始提交与空树比较。

窄屏使用分支抽屉，提交记录和详情上下排列。聊天组件保持挂载，返回对话保留会话；Git Tree 的项目请求、提交详情和 Diff 均忽略已失效的响应。

提交列表中「提交信息 / 作者 / 日期」之间提供贯穿列表的拖动分隔线。两条边界分别调整提交信息列和作者列，所有行同步对齐；支持方向键微调和 Home/End 调至边界。列宽保存在 `skiff.git-tree.columns.v1`，切换项目与重启后保留。窄屏保留各列，宽度不足时在列表内横向滚动。

历史读取接口在 `src-tauri/src/git_history.rs`，复用既有项目目录与仓库识别。项目为仓库子目录时，历史和文件限定到该目录并显示范围。浏览历史只读，不 checkout、fetch 或改写暂存区。完整 hash 校验、字面路径参数、禁用 external diff/textconv；新增接口不需要扩展 capabilities。

每次加载 100 条，可继续加载到最近 1000 条。远程分支来自本地已有的远程引用。历史 Diff 截断上限为 2 MB，二进制单独提示。非仓库、空历史、失效分支和读取失败有对应状态及刷新/重试入口。

## Update Project

分支树与历史工具栏上的两个入口统一使用左下箭头和 `Update Project` 文字，更新当前浏览项目所在仓库的**当前检出分支**，不受左侧历史筛选影响，不切换分支。

- 不弹 Merge/Rebase 策略对话框。显式 fetch 当前分支的 upstream 后，只允许 fast-forward；不生成 merge commit，不 rebase，不 reset，不自动 stash。
- 已同步显示「已是最新」；本地领先显示「无需拉取」；本地与远程分叉时更新远程引用，但停止本地更新，提示用 IDE/命令行处理。
- 检查整个仓库（含项目目录之外）的未提交/未跟踪改动和未完成 Git 操作。detached HEAD、未配置 upstream、网络/认证错误均给出原因。fetch 结束后重新检查 HEAD、分支、跟踪配置和工作区；禁止覆盖忽略文件。
- 原生实现在 `src-tauri/src/git_update.rs`，与提交/恢复共用写入锁。网络操作不弹终端凭据输入，超时 120 秒；不把可能包含凭据的 transport stderr 输出到 UI。复用现有 Git 进程权限，无需增加 capabilities。
- 两个入口共用运行状态，重复点击无效；切换项目后的迟到结果只归属原项目。更新成功刷新历史、Git 状态、文件树及已打开的文件预览。

验证：新增 4 项 Rust 临时远程仓库测试通过，覆盖快进/最新/领先/分叉、改动和操作拦截、fetch 后竞态、忽略文件保护、失败时的状态保持与错误脱敏。`node tests/git-update.browser.mjs` 验证两个入口、请求互斥、反馈、文件树刷新、跨项目结果隔离，浅深主题均通过。`npm run test:cdp` 的临时本地远程仓库真实验证未提交改动拦截、快进更新和分叉保留本地提交；未访问开发者远程仓库。截图 `dist/git-update-cdp.png`、`dist/git-update/`。

## 验证

- `npm run build -- --emptyOutDir=false`、`npm run check:ui` 通过。
- `npm test`：349 项通过，包含合并与多父提交的图布局测试。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib project_workbench`：既有 4 项通过；新增 `project_workbench::history` 2 项通过，覆盖空仓库、分支/标签、分页、detached HEAD、合并、初始提交、重命名、删除、中文路径、二进制、子目录与只读性。
- 样式和对比度审计通过（直接调用审计函数，避免覆盖工作区已有的审计报告）。
- `node tests/git-tree.browser.mjs`：浅色/深色、分支筛选、键盘选择、历史 Diff、搜索、跨项目浏览、迟到响应、错误/空状态、继续加载、窄屏通过。
- `node tests/project-picker.browser.mjs`：项目选择器既有交互回归通过。
- `node tests/git-tree-columns.browser.mjs`：浅深主题的整列拖动、列宽独立性、行对齐、拖动不误选提交、键盘边界、重新加载后的列宽记忆及窄屏横向滚动后拖动通过。截图位于 `dist/git-tree-columns/`。
- `npm run test:cdp`：真实 WebView2 → Tauri → Rust → Git 验证通过；临时仓库的 HEAD、index 和未提交内容不变。使用 `SKIFF_CDP_BINARY` 启动已编译的调试程序副本，临时 pi 配置和独立 WebView2 用户目录；保留原 harness 的 localStorage 快照/恢复流程。原有真实 pi 的本地 mock 回复验证也通过。

截图：`dist/git-tree/light.png`、`dark.png`、`narrow.png`，真实桌面截图 `dist/git-tree-cdp.png`。生成文件不入库。
