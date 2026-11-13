# 041 · 图片并发生成

日期：2026-11-13。

## 行为

- 图片生成默认允许同时进行 5 个任务。在设置 → 图片生成 → 同时生成任务数中选择 3、5、10、不限，即选即保存，适用于所有图片服务。旧配置无需迁移，缺省为 5。
- 未达到上限时，已有任务不会禁用生成按钮或快捷键。仅本次提交期间锁定按钮以防重复发送；达到上限时显示进行中数量和调整设置的提示，不自动排队。
- 调低上限不会取消已有任务，待任务数量降至上限以下后允许继续提交。生成和保存中的任务均占用名额。不限表示 Skiff 不限制任务数，服务商仍可限流。
- 每个任务独立持有参数、参考图快照、结果及停止等待操作。失败/取消只影响对应任务；WebView 重载后全部活动任务仍可跟踪。
- 视频生成维持既有行为。

## 实现

`generation/config.json` 新增 `concurrencyLimit`，0 表示不限；保存命令只接受 0/3/5/10，并在原有配置锁下更新，保留全部服务及加密凭据。Rust 在活动任务锁内检查数量并注册任务；同一 UUID 重放先返回旧记录，即使已达上限也不发送第二次 POST。未增加系统访问权限或 capability。

前端根据任务数量判断能否提交，提交前后更新任务版本，拒绝过期轮询覆盖新接受任务。新提交的临时卡片可与已有任务卡片同时展示。后台请求、作品落盘、取消及应用重启后的中断语义沿用现有实现。

## 验证

- `npm run build -- --emptyOutDir=false`、`npm run check:ui`、`npm run test:styles` 通过。
- `npm test`：408 项通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib generation::tests`：19 项通过，覆盖默认值/旧配置、合法选项、边界限制和服务/凭据保留。
- `cargo build --manifest-path src-tauri/Cargo.toml` 通过；完整 Rust 单测 94 项通过，4 项既有真实浏览器测试按原配置忽略。
- `node tests/image-concurrency.browser.mjs`：浅/深主题验证四档设置、默认 5、旧轮询返回、重复提交防护、乱序完成、独立取消、超过 10 个任务、配置与任务重载恢复及 600px 设置布局。
- `npm run test:cdp -- --images`：隔离的真实 WebView2 → Tauri → Rust → 本地 mock 服务，验证 3/5/10/不限的后端检查、上限时 UUID 幂等、两张独立参考图快照、11 个并行任务重载、乱序落盘、单任务失败和取消；原文生图/图生图/画廊流程及随后 pi 聊天通过。
- `node tests/image-generation.browser.mjs`、`node tests/image-edit.browser.mjs`、`node tests/image-gallery.browser.mjs`、`node tests/generation-redesign.browser.mjs` 浅/深主题既有回归通过。
- 截图：`dist/image-concurrency/` 和 `dist/image-concurrency*-cdp.png`，不入库。CDP 使用临时生成目录、pi 目录和 WebView2 profile，结束恢复 localStorage。

未调用真实图片服务，真实账户的并发额度由服务商决定。
