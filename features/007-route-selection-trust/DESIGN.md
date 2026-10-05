# 007 · 线路选择、授权切换与实际计费

007 在 006 的「中转—家族—线路」配置上，补齐聊天框选择具体线路、线路别名与启停、默认线路解析、失败切换授权、实际线路留痕和价格快照。目标是让用户始终知道请求发给哪条线路、由哪个账户扣费，以及系统为什么发生切换。

核心原则：**系统可以替用户处理故障，但不能在没有明确授权的情况下替用户改变扣费主体；历史费用按实际应答线路保存，不随后来配置变化。**

## 术语与身份

三层身份必须分开：

- **中转 Relay**：接入地址、密钥、超时和扣费账户。一个中转可以服务多个模型家族。
- **线路 Route**：`relayId × familyId`，负责线路级启停、能力开关、默认线路和备用顺序。
- **可选项 Offer**：`routeId × modelId`，是聊天框真正选择和最近使用记录的单位。

一条线路可以继续包含多个模型。由于别名示例是 `k3-便宜`，别名放在 `ModelSpec`（可选项）上；线路本身另保留中转名作为来源标识。若以后需要给整条线路命名，可再增加 `routeAlias`，不能用一个线路别名代替多个模型别名。

`routeId` 是稳定 ID，创建后不因中转改名而变化。所有会话钉住、默认线路、最近使用、切换审计和价格快照都引用 `routeId`；`providerKey` 只作为 pi 运行时投影键，不承担产品身份。

## 数据模型

`skiff-families.json` 升级到 version 4。密钥仍按 006 的规则使用 DPAPI（或平台已支持的安全存储）加密，下面的 `apiKey` 仅表示内存/IPC 形态。

```jsonc
{
  "version": 4,
  "autoFailover": false,
  "autoRetry": false,
  "relays": [
    {
      "id": "r1",
      "name": "硅基低价",
      "baseUrl": "https://relay.example/v1",
      "apiKey": "<sealed>",
      "timeoutSeconds": 60,
      "enabled": true,
      "billingAccountId": "wallet-a"
    }
  ],
  "families": [
    {
      "id": "kimi",
      "displayName": "Kimi",
      "routes": [
        {
          "id": "route-kimi-r1",
          "relayId": "r1",
          "enabled": true,
          "models": [
            {
              "modelId": "kimi-k3",
              "alias": "k3-便宜",
              "inputCost": 1,
              "outputCost": 4,
              "cacheReadCost": 1,
              "cacheWriteCost": 1,
              "currency": "CNY",
              "maxTokens": 8192,
              "contextWindow": 128000
            }
          ],
          "streaming": true,
          "tools": true,
          "vision": false,
          "reasoning": true
        }
      ],
      "defaultRouteId": "route-kimi-r1"
    }
  ]
}
```

字段规则：

- `relay.enabled` 是中转总开关；`route.enabled` 是线路开关。只有两者都为真时，线路才进入运行时 offers、聊天下拉、默认解析和故障候选。设置页必须把两者标成不同语义。
- `billingAccountId` 是用户维护的稳定扣费主体标识，不保存 API Key 指纹，不根据 Base URL 自动推断。空值或不确定时按跨账户处理。
- `alias` 默认空。别名只改变界面显示，不改变 `modelId`、pi 模型 ID 或计费匹配。
- `cacheReadCost`、`cacheWriteCost` 缺省时沿用 `inputCost`，兼容 006 配置。价格单位保持“每百万 token”。
- 默认线路必须存在、启用并至少包含一个模型。禁用或删除默认线路时，命令应要求先选替代线路，或由用户明确确认清空；不能后台悄悄改默认线路。
- 同一家族允许不同中转提供相同 `modelId`。同一条线路内 `modelId` 不重复；`routeId + modelId` 在全局唯一。

运行时 `RuntimeOffer` 至少包含：`offerId`、`routeId`、`familyId`、`familyName`、`relayId`、`relayName`、`providerKey`、`modelId`、`alias`、`billingAccountId`、线路顺序、能力开关和完整价格。只返回有效线路；禁用线路保留在配置页供恢复，但不投影到 pi，也不进入下拉或切换候选。

## 聊天框选择器

- 一个下拉按模型家族分组；每一条 `Offer` 都是独立选项。同一家族的两个 `kimi-k3` 必须出现两行，不能再合并成一个模型项后由默认线路代选。
- 基础标题为 `alias || modelId`。如果可见选项标题重复，追加 ` · relayName`；别名与其他模型冲突时也执行同样的消歧。
- 副行固定展示实际模型 ID、中转名和单价；无论标题是否有别名，辅助标签都要能读出完整的家族、模型和中转。
- “模型全网唯一”按当前有效 offers 判断。禁用线路不参与碰撞计算；重新启用后可能触发消歧，但已保存的会话和历史消息不改写。
- 搜索匹配家族名、模型 ID、别名和中转名。保留方向键、Enter、Escape、浮层边界和无结果状态。
- 最近使用保存 `offerId`，默认保留最近 8 条，按用户明确选择或一次成功应答更新；失败且没有应答的尝试不应把线路顶到最近列表。线路删除或停用后从最近列表清理，不显示幽灵项。
- 选择后立即钉住该 `routeId + modelId`。改变默认线路不迁移已有会话；钉住线路失效时，按同家族同模型的默认线路、备用顺序、首个有效 offer 解析一次，并显示一次可关闭提示。

会话索引保留现有 `provider/id` 兼容字段，同时增加 `routeId` 和 `modelId`。恢复旧会话时先用 `routeId` 精确匹配；没有该字段时再用旧 `provider/id` 反查。

## 默认线路和备用顺序

默认线路只负责以下场景：新会话初始选择、只给出家族和模型 ID 的解析、钉住线路失效后的第一次回退。若默认线路不提供目标模型，解析器在同一家族的有效线路中按备用顺序寻找该模型。

默认线路和备用顺序是两个概念：默认线路是单选值，备用顺序是线路列表顺序。设置页拖动线路只改变备用顺序；设置默认线路不会重排备用顺序。故障切换从当前线路之后开始，不循环回到已尝试线路。

## 失败切换和授权

`autoFailover` 全局默认关闭。关闭时，错误只展示给用户，并提供手动选择线路入口。用户直接点击选择属于显式操作，可以跨账户；界面仍显示目标账户和价格。

开启后，只有可归因于中转的可重试错误才进入切换流程：网络断开、连接失败、超时、429、5xx，以及明确的服务端 401。参数错误、上下文超限、能力不支持、用户取消、内容策略拒绝和本地配置错误不自动切换。401 切换后必须记录为凭据类故障。

候选线路必须满足：同一家族、同一 `modelId`、有效启停状态，并支持本次请求需要的视觉、工具、推理和流式能力。每个用户请求最多自动切换一次；使用请求 ID 和已尝试 `routeId` 防止重复、竞态和循环。

切换与重试分开：

- 默认切换只改变后续使用的线路，**不自动重发原请求**。
- `autoRetry` 单独存在且默认关闭。若未来开启，最多重发一次，并在系统消息中明确“可能产生新的费用”。失败请求若服务端已返回用量，也要单独记录，不把两次用量合并成一次。

账户授权规则：

- 目标线路和当前线路的 `billingAccountId` 相同：允许静默切换，追加一条系统消息和审计事件。
- 账户不同、任一账户为空或无法确认：先展示系统消息和 `[同意] [本次会话都同意] [保持失败]`。
- `[同意]` 只授权当前切换；`[本次会话都同意]` 仅对当前会话和该目标账户生效；`[保持失败]` 保持当前线路，不继续自动切换。
- 授权发生在切换前。若 `autoRetry` 关闭，确认后只完成线路切换，用户仍需主动重试。

## 实际线路、价格和审计

每条完成的助手消息保存一个不可变的 `RouteSnapshot`：

```jsonc
{
  "routeId": "route-kimi-r1",
  "offerId": "route-kimi-r1/kimi-k3",
  "providerKey": "skiff-relay-r1-kimi",
  "familyId": "kimi",
  "modelId": "kimi-k3",
  "alias": "k3-便宜",
  "relayName": "硅基低价",
  "billingAccountId": "wallet-a",
  "currency": "CNY",
  "inputCost": 1,
  "outputCost": 4,
  "cacheReadCost": 1,
  "cacheWriteCost": 1
}
```

回复 meta 行优先使用快照显示“实际应答线路”；线路被改名、改价或删除后，历史消息仍显示原快照。费用计算优先使用快照价格和该条消息的用量，不能回查当前配置覆盖历史价格。没有用量时显示“未能核算”，不使用 pi 的估算费用冒充实际费用。

每次切换追加 `RouteEvent`，至少记录：时间、会话 ID、请求 ID、源线路、目标线路、失败分类、是否跨账户、授权方式、是否自动、是否重试和结果。事件不得包含 API Key、完整 URL 查询参数或请求正文。事件与价格快照保存在 Skiff 自己的会话元数据中，不注入 pi 的用户/助手上下文。

## 配置更新、迁移和安全

- 线路启停、别名、默认和排序变更在当前请求结束后生效；生成中不在中途替换 provider。当前钉住线路被停用或删除时，空闲后重启 pi、恢复会话并按解析规则回退一次。
- v3 → v4 迁移保留所有中转、线路、模型、价格、能力和顺序；为现有线路生成稳定 `routeId`，把 `defaultRelayId` 映射为 `defaultRouteId`，`route.enabled` 默认真，别名为空，扣费账户为空。旧会话继续按 provider/model 展示，无法补出的历史价格不伪造。
- 保存仍需原子更新 `models.json`、`auth.json`、`skiff-families.json`，失败时整体回滚。禁用线路不得写入 pi 的有效 provider，但配置和密钥可保留以便恢复。
- 账户标识和审计可以写入本地元数据；密钥继续只在受保护存储和 pi 子进程环境中出现。

## 验证范围

- Rust：v3 → v4 往返、routeId/defaultRouteId 校验、线路级启停、账户字段、别名和价格快照序列化、投影清理、原子回滚、密钥脱敏。
- Node：offers 不合并重复模型、标题消歧、搜索、最近使用、默认解析、失效回退、能力过滤、错误分类、单次切换和无循环。
- UI：别名编辑、线路开关、默认线路约束、跨账户三按钮、系统消息、实际线路 meta、禁用当前线路提示、窄窗口和键盘操作。
- 集成：两个中转提供同名模型；同账户静默切换；跨账户三种授权；401/429/5xx/超时与 400/上下文错误区分；改价或删除后历史费用仍按快照显示；失败请求不自动重发。

## 第 8 段全量验证记录

验证日期：2026-10-05（Asia/Shanghai）。

- `npm run build`：通过。Vite 仅报告现有的大 chunk 提示。
- `npm test`：90/90 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`：14/14 通过。
- `cargo check --manifest-path src-tauri/Cargo.toml`：通过。
- `node tests/pi.families.integration.mjs C:\\Users\\49772\\AppData\\Roaming\\npm\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js`：通过。测试使用隔离目录和回环 HTTP 服务，无真实账户请求，覆盖多模型、独立价格/限制、会话恢复、独立密钥、流式/工具开关、401 与超时。
- 浏览器预览：通过同名多开、提供商/模型搜索、线路启停、默认线路入口、跨账户三按钮授权、拒绝后保持源线路、历史快照线路显示和窄布局 CSS 检查；预览页的非 Tauri `TitleBar` 环境崩溃已修复。
- 设置入口补齐：线路启停、模型别名、扣费账户、缓存读写单价、明确清空默认线路；禁用供应商后其 offers 从下拉消失。

限制：当前环境未提供可编程浏览器 viewport 覆盖能力，因此窄窗口走查使用现有响应式断点和 DOM/CSS 检查；未连接真实供应商账户，授权和计费行为均通过本地 mock 与回环服务验证。Rust 测试仍有 `src/providers.rs` 中既有的 `Write` 未使用警告，不影响构建或测试结果。

