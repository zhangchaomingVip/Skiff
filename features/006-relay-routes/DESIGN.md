# 006 · 中转提供商与模型线路

概念模型从「家族 → 渠道」改为三方关系：**中转**（接入点，保存地址与密钥）、**家族**（固定三家厂商）、**线路**（中转 × 家族，声明该中转在该家族下可用的模型与价格）。同一中转可以同时服务多个家族而无需重复录入地址和密钥；选择器只按「家族 · 模型」呈现，具体走哪条线路由默认线路解析并在会话中**钉住**。

```
中转 Relay（接入点）            家族 Family（固定三个）
  ├ base_url / api_key           ├ DeepSeek
  ├ 超时 / 启停                   ├ Kimi
  └ id                           └ GLM
         └──────── 线路 Route（矩阵单元）────────┘
                   relayId × familyId
                   ├ 模型清单（ID/价格/币种/上下文/最大输出）
                   └ 能力开关（流式/工具/视觉/推理）
```

## 数据模型

- `skiff-families.json` 升级到 version 3：

```jsonc
{
  "version": 3,
  "autoFailover": false,
  "relays": [
    { "id": "r1", "name": "某中转", "baseUrl": "https://x.example/v1",
      "apiKey": "<DPAPI 密文>", "timeoutSeconds": 60, "enabled": true }
  ],
  "families": [
    { "id": "deepseek",
      "routes": [
        { "relayId": "r1",
          "models": [ { "modelId": "deepseek-chat", "inputCost": 1, "outputCost": 2,
                        "currency": "CNY", "maxTokens": 8192, "contextWindow": 128000 } ],
          "streaming": true, "tools": true, "vision": false, "reasoning": false }
      ],
      "defaultRelayId": "r1" }       // routes 数组顺序即家族内优先级（解析与切换）
  ]
}
```

- 校验：中转名 1–32 字符且全局唯一；Base URL 为 HTTP(S)、不含凭据/查询/片段；**同一中转上模型 ID 跨线路唯一**（保证 provider+model 可唯一定位一条线路）；价格、上下文窗口、最大输出规则同 005；默认线路必须是启用中转上至少含一个模型的线路，缺省时按 `routeOrder` 自动挑选。家族允许没有任何线路。
- 相比 v2 删除：`legacyProvider`、`model_config`、家族末项保护（家族可为空）、渠道级启停（仅中转级启停）、`max_thinking`/`thinkingLevelMap` 处理（推理改为线路上的普通能力开关）。

## 交互

- 设置页两段：**中转提供商**与**模型家族**。中转列表展示名称、地址、密钥末四位、启停与删除；新增中转时必须先通过一次连接测试（`max_tokens=1`）才允许保存，之后不再重复测试，编辑表单不含测试按钮。超时在中转上配置。
- 家族卡片内为**线路**列表：每条显示中转名与模型数。添加线路时从已有中转下拉选择（不重填地址密钥），再配置模型清单（支持 `/models` 发现或手填）、单价与币种、上下文与最大输出、流式/工具/视觉/推理能力。线路支持上下移动（即家族内切换优先级）、设默认与删除；删除中转级联删除其全部线路。
- 选择器按家族分组，条目为**模型**：同一家族内相同模型 ID 的多条线路合并为一个条目，解析顺序为默认线路 → `routeOrder`。条目副行显示解析线路的中转名与该线路单价。聊天标题显示「家族 · 模型」。
- **选择即钉住（默认行为）**：会话始终记录具体线路（pi provider key + 模型 ID），不随默认线路变化自动迁移。仅当钉住线路被删除或所属中转被停用时，按默认线路 → `routeOrder` → 任一同模型条目重新解析，并提示一次。
- 键盘搜索、方向键、Enter、Escape、浮层窗口内定位等选择器行为沿用 005。

## 故障切换

- `autoFailover` 全局开关默认关闭，语义不变：请求失败后切换到家族内 `routeOrder` 中下一条**提供相同模型 ID** 的启用线路；没有则提示「无备用线路」。切换不自动重发原请求；切换成功后钉住随线路更新。
- 错误提示与脱敏规则沿用 005（网络错误、401、429、5xx、超时 toast，密钥不出现在摘要中）。

## 配置与请求

- **一条线路投影为一个 pi 提供商** `skiff-relay-<relayId>-<familyId>`（流式/工具等能力是线路级的，同一中转在不同家族的开关可能不同，因此按线路投影）：每模型独立价格/上下文/输入类型/reasoning（缓存读写单价默认取输入单价）；同一中转的全部线路共享一个密钥环境变量 `SKIFF_KEY_RELAY_<relayId>`。`is_managed_key` 改为匹配 `skiff-` 前缀，保存时清理所有不再投影的托管条目（含 v2 遗留键）。家族与线路的对应关系只存在于运行时路由数据（`SKIFF_FAMILY_RUNTIME`）与前端 offers 中。
- 密钥仅在中转保存时 DPAPI 加密、启动 pi 子进程时解密进环境；IPC 边界明文、磁盘密文，规则同 005。
- 配置更新等待会话空闲后重启 pi 并恢复会话与钉住的模型；保存失败回滚 models.json / auth.json / skiff-families.json 三件套（沿用现有备份恢复机制）。
- 前端按 offers（providerKey + modelId）反查线路与家族，废弃从 provider key 字符串解析家族的 `channelId()`；费用按消息所属（线路， 模型）的配置本地计算，规则同 005。

## 迁移与清理

- 测试环境，**不做 v2 → v3 迁移**：加载时检测到 `version < 3` 的 `skiff-families.json`，重命名为 `skiff-families.v2.bak.json` 并从空配置开始；首次保存时投影会清除遗留的 `skiff-<family>-<id>` 托管键。
- 删除 legacy 通道：`save_openai_provider` / `list_openai_providers_legacy` / `migrate_provider_config` 命令、`ProviderDialog.tsx` 及其入口、相关测试与迁移代码（`classify`/`unique_display`）。模型发现命令保留并更名 `discover_relay_models`，供线路添加时的 `/models` 拉取使用。

## 验证（计划）

- `npm run build`、`npm test`、`cargo test --manifest-path src-tauri/Cargo.toml --lib`、`cargo check`。
- Rust：schema 往返与密钥加解密、按中转投影与遗留键清理、密钥环境注入、默认线路与 `routeOrder` 校验、删除中转级联清理、同中转模型 ID 唯一性、保存失败回滚。
- Node：选择器同模型去重与解析顺序、钉住恢复与失效回退、故障切换顺序与「无备用线路」提示、费用归属与币种累计。
- 集成（隔离目录 + 本地服务）：两个中转服务同一模型时的解析与切换、中转级启停、跨家族复用中转。
- 浏览器模拟桥：新增中转（首测失败/成功）、线路增删排序、选择与恢复、401/超时提示、明暗主题与窄窗口定位。
