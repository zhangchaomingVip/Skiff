# Git 面板「Commit and Push」大提交卡顿排查记录

> 记录时间：2026-10-30。状态：已定位根因，暂未改代码，留待下次处理。

## 现象

工作台 Git 面板勾选 126 个文件（13 added + 113 modified，其中大量是 `src-tauri/icons/`、`public/` 下的 PNG/ICO/ICNS 图标二进制）后点击「Commit and Push」，界面长时间无响应：两个按钮变灰、底部只剩一句「正在执行 Git 操作…」。用户等不及，改用手动 `git commit` 提交成功。

## 排查结论

### 按钮禁用条件

`src/components/ProjectWorkbenchPanel.tsx` 的 `GitPanel` 中，两个提交按钮的禁用条件：

```js
disabled={writing || loading || !selected.length || !message.trim() || !!status.operation}
```

消息已填、文件已选、`.git` 无 `MERGE_HEAD`/`rebase-*`/`CHERRY_PICK_HEAD`/`REVERT_HEAD` 残留（`status.operation` 为空）时，按钮变灰只可能来自 `writing`（写操作进行中）或 `loading`（git status 刷新中）。本次是 `writing`：点击后进入 commit 流程，`setWriting(true)` 直到整个 commit + push 结束才复位。

### 各阶段耗时实测（Windows + git 2.x + git-lfs 3.7.1）

| 步骤 | 耗时 | 说明 |
| --- | --- | --- |
| `git status --porcelain=v1 -z --untracked-files=all` | ~82ms | 状态读取，快 |
| `git add -A -- <paths>` | ~3s | 构造 80 个二进制（100KB~2MB）+ 46 个文本 ≈ 80MB，主要耗时在 blob 哈希 |
| `git commit -m` | ~0.16s | 快 |
| `git ls-remote origin` | ~4.4s | SSH 到 github 握手偏慢 |

仓库无 `.gitattributes`，未启用 LFS 跟踪，`filter.lfs.*` 配置不生效，排除 LFS 因素。

## 根因

「Commit and Push」走 `src-tauri/src/git_push.rs` 的 `commit_and_push`，把本地提交与远程推送**串行**执行：

1. `commit_selected`（`src-tauri/src/project_workbench.rs:534`）：`read-tree HEAD` → `git add -A -- <paths>` → `git diff --cached --quiet` → `git commit` → `git reset`。其中 `git add` 对大量二进制文件需要数秒。
2. `push_commit`（`src-tauri/src/git_push.rs:25`）：`git push` 用 `try_wait` 轮询，最长 **120s** 超时；仅 SSH 握手就 ~4.4s，网络慢时更久。

整个过程前端 `writing=true`（`ProjectWorkbenchPanel.tsx` 的 `commit()`），两个按钮禁用，且只有一句「正在执行 Git 操作…」，**没有区分「提交中 / 推送中」的阶段反馈**。大提交 + 慢网络的组合下，界面表现就是「卡死」，而实际本地提交只花了 3s 左右。

## 涉及代码位置

- `src/components/ProjectWorkbenchPanel.tsx`：`GitPanel.commit()`（约 145-156 行）、按钮禁用条件（约 181 行）
- `src-tauri/src/git_push.rs`：`commit_and_push`（约 53 行）、`push_commit` 120s 超时（25-51 行）
- `src-tauri/src/project_workbench.rs`：`commit_selected`（534 行起）、`read_status`（含 `--untracked-files=all`）
- `src/workbench/gitStatusCache.ts`：`pause`/`ticket` 机制（写操作期间暂停轮询，写完成后恢复）
- `src/workbench/diffPreviewCache.ts`：diff 预取已限流（并发 2、每根最多 24 条），非卡顿主因

## 下次修复方向（未实施）

1. **push 解耦为后台任务**：本地 commit 完成后立即返回并解锁 UI，push 异步执行、结果通过 Tauri 事件回传。Tauri 侧已有 `Emitter`/`app.emit` 基建（参考 `src-tauri/src/lib.rs` 的 `rpc://` 事件），前端可 `listen` 接收推送成功/失败。
2. **缩短 push 超时**：120s → 更短（如 30~45s），并让超时/失败信息更明确（当前已能区分「已创建本地提交；推送失败」与「已提交并推送」）。
3. **阶段化反馈**：前端区分「正在提交… / 正在推送…」，避免误判为卡死。
4. `git add` 的 blob 哈希是硬成本，无法大幅优化；如确需提速可考虑精简 pathspec，但收益有限。

## 复现与验证

- 全链路：`npm run test:cdp`（注意：当前会在新增的 `verifyDraftAttachments` 用例失败——`filechooser` 事件超时，与本问题无关，需先处理该用例或单独跑 git 用例）。
- 已有 git 用例：`tests/git-commit.cdp.mjs` 的 `verifyGitCommit` 覆盖「本地 Commit 不推送」「Commit and Push 更新本地测试远程」两条路径。
- 基准构造：临时仓库 + 80 个二进制 + 46 个文本，测量 `git add / commit / status` 耗时（本次用 node 一次性脚本完成）。
