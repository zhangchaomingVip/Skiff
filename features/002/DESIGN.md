# 002 · claude / codex 接入（下一期）

> 状态：**未开始（deferred）**。本期（001 聊天界面）只接了 deepseek（经 `pi --mode rpc`）。

## 决策

claude / codex 放到**下一期**，采用 **「直接调用官方 CLI（`claude` / `codex`）」** 的方式，
**不通过 cc-switch 网关路由 `pi`**。

## 为什么不改走 cc-switch 网关

排查 cc-switch 时发现一个会卡死的根因：

- `pi-coding-agent` 的 anthropic provider 在 `pi-ai/dist/api/anthropic-messages.js` 的
  `createClient` 里写死用 `model.baseUrl`（来自其内置模型目录，固定为
  `https://api.anthropic.com`）。
- `@anthropic-ai/sdk` 只在 `baseURL` 未显式传入时才读 `ANTHROPIC_BASE_URL` 环境变量；
  而 `pi` 显式把 `model.baseUrl` 传了进去，于是 env 被覆盖、**不生效**。
- 结论：往 `pi --mode rpc` 子进程注入 cc-switch 的
  `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`（claude）、
  `OPENAI_API_KEY` / `OPENAI_BASE_URL`（codex）**无法把 `pi` 的 claude/codex 调用重定向到网关**。
  自定义 baseUrl 须经 `pi` 自己的 provider 配置传入，复杂度高且不直观。

因此，claude/codex 这期直接拉起官方 CLI 进程（`claude` / `codex`），复用与 `pi` 相同的
「Rust spawn + stdin/stdout 事件桥」模式即可，不依赖 `pi` 的 provider 路由。

## 参考（若仍想复用 cc-switch 凭据）

cc-switch 凭据位于 `~/.cc-switch/cc-switch.db` 的 `providers` 表：

- claude：`settings_config.env` 里的 `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`
- codex：`settings_config.auth.OPENAI_API_KEY` + `settings_config.config` 里的 `base_url`

`settings.json` 的 `currentProviderClaude` / `currentProviderCodex` 指向当前选中的 provider id。
（本期不依赖这些；官方 CLI 自己认对应的环境变量。）
