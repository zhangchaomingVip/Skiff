# 032 · 验证记录

日期：2026-10-28（Asia/Shanghai）

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
