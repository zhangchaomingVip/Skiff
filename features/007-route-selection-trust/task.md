# 007 执行与验收任务

每一段完成后先运行该段列出的检查，再进入下一段。除非任务明确要求，不改动无关 UI 或旧版配置。所有任务都以 `features/007-route-selection-trust/DESIGN.md` 为验收依据。

## 0. 冻结契约与测试夹具

- [x] 确认 `RouteSpec`、`ModelSpec`、`RuntimeOffer`、`RouteSnapshot`、`RouteEvent` 的 TypeScript/Rust 字段和空值规则。
- [x] 确认 `routeId`、`offerId`、`billingAccountId` 的生成与比较规则；确认别名属于模型级。
- [ ] 增加两中转同名模型、同账户/跨账户、重复别名、禁用默认线路和能力不匹配的最小 fixtures。

验收：fixture 能覆盖设计中的每种解析和授权分支；`npm run build`、`npm test` 基线通过。

## 1. v4 配置模型与迁移（Rust + 前端类型）

- [x] 为 `RelaySpec` 增加 `billingAccountId`，为 `RouteSpec` 增加稳定 `id` 和 `enabled`。
- [x] 为 `ModelSpec` 增加 `alias`、缓存读写单价；为家族把 `defaultRelayId` 替换为 `defaultRouteId`，保留兼容读取。
- [x] 实现 v3 → v4 迁移：补 routeId、默认启用、空别名、空账户，并保留现有顺序和密钥。
- [x] 更新 normalize/校验：routeId 与 offerId 唯一、别名长度和控制字符、默认线路有效、同中转不同线路仍允许同名模型的规则按设计执行。
- [x] 保持密钥加解密、损坏配置保护和配置锁行为不变。

验收：Rust 单测覆盖 v3 往返迁移、默认线路约束、重复别名/模型、账户空值、价格字段和密钥脱敏；`cargo test --manifest-path src-tauri/Cargo.toml --lib`、`cargo check --manifest-path src-tauri/Cargo.toml` 通过。

## 2. 运行时投影与有效 offers

- [x] 线路投影只包含 `relay.enabled && route.enabled` 的线路；禁用线路从 pi provider、运行时环境、offers 和故障候选中消失。
- [x] 扩充 `RuntimeOffer`，携带 offerId、routeId、alias、账户、顺序、能力和完整价格。
- [ ] providerKey 继续按线路生成，但前端不再从 providerKey 反解析产品身份。
- [x] 配置保存失败时继续整体回滚 models/auth/families 三件套。

验收：隔离目录验证启停、删除、恢复、跨家族复用同一中转；禁用线路不出现在 `models.json` 和 `list_model_runtime`；无密钥进入日志或运行时 JSON。

## 3. 选择器、别名与最近使用

- [x] 将 `modelsFromOffers` 改为每个有效 offer 一个选择项，不再合并同一家族同模型的多条线路。
- [x] 实现标题消歧：`alias || modelId`，冲突时追加中转名；副行展示模型 ID、中转和价格。
- [x] 搜索覆盖家族、模型 ID、别名和中转名，保留键盘操作和窗口边界定位。
- [x] 在本地保存最近 8 个 offerId；停用/删除后清理；失败无应答不提升最近项。
- [x] 会话选择持久化 routeId + modelId，同时兼容旧 provider/id。

验收：Node 单测覆盖同名多开、重复别名、启停过滤、搜索、最近排序、旧会话恢复；浏览器预览验证键盘、窄窗口、明暗主题和无结果状态。

## 4. 默认线路与会话钉住

- [x] 实现按 `defaultRouteId → 备用顺序` 的同家族同模型解析。
- [x] 默认线路不提供目标模型时，跳过默认线路并按候选顺序选择；不能跨家族误选。
- [x] 禁止后台悄悄重写用户默认值；禁用/删除默认线路时要求替代或明确清空。
- [x] 当前线路失效时空闲后重启 pi，恢复会话并只提示一次回退结果。
- [x] 配置变化不会中断生成中的请求。

验收：Node 测试覆盖默认优先、默认不含模型、禁用当前线路、删除线路、刷新恢复和提示去重；集成测试验证 provider/model 与 routeId 一致。

## 5. 失败分类与切换状态机

- [x] 将网络、超时、429、5xx、明确 401 与参数错误、上下文超限、能力不支持、取消分开分类。
- [x] 候选只包含同家族、同 modelId、有效且满足视觉/工具/推理/流式能力的线路。
- [x] 为每个请求维护 requestId、已尝试 routeId 和最多一次自动切换，禁止竞态和循环。
- [x] 保留手动切换入口；`autoFailover` 默认关闭。
- [x] 明确 `autoRetry` 默认关闭，切换本身不重发原请求。

验收：Node 单测覆盖每种错误分类、无候选、能力过滤、一次切换、无循环和不自动重发；隔离服务验证 401/429/503/超时与 400/上下文错误。

## 6. 扣费账户授权交互

- [x] 比较源/目标 `billingAccountId`；相同账户静默切换并显示系统消息。
- [x] 跨账户、空账户或未知账户显示 `[同意] [本次会话都同意] [保持失败]`。
- [x] 实现一次授权、当前会话授权和拒绝的生命周期；会话结束后清理授权。
- [x] 授权前不切换；拒绝后不继续自动尝试；目标线路和账户信息在确认内容中清楚显示。

验收：浏览器预览和 Node 状态机测试覆盖三按钮、重复错误、切换目标变化、会话重开和用户手动跨账户选择。

## 7. 实际线路元数据、价格快照和审计

- [x] 为完成的助手回复附加 RouteSnapshot，包含线路、模型、别名、账户、币种和输入/输出/缓存价格。
- [x] 费用计算优先使用快照；配置改价、改名、删除后历史费用不变；缺少用量显示未核算。
- [x] 保存 RouteEvent：源/目标、失败分类、授权方式、是否自动、是否重试和结果；禁止保存密钥、请求正文和敏感 URL 参数。
- [x] 将元数据存入 Skiff 会话元数据，不注入 pi 上下文；刷新和历史恢复仍能显示实际应答线路。

验收：Node 测试覆盖跨线路/币种累计、缓存价格、删除线路、改价、失败有用量和无用量；集成验证审计内容脱敏且刷新后仍可读。

## 8. 全量回归与交付检查

- [x] `npm run build`
- [x] `npm test`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --lib`
- [x] `cargo check --manifest-path src-tauri/Cargo.toml`
- [x] `node tests/pi.families.integration.mjs <pi-cli.js>`（隔离目录、本地服务）
- [x] 浏览器预览完成同名多开、别名搜索、线路启停、默认线路、同账户静默切换、跨账户确认、历史费用和窄窗口走查。
- [x] 更新 007 设计文档中的验证记录，记录未支持平台、未能验证的真实账户行为和任何剩余限制。

最终验收标准：用户能在下拉中选到具体线路；禁用线路不会被使用；默认线路只参与未明确选择时的解析；自动切换默认关闭，跨扣费账户必有授权；每条回复和费用都能还原实际应答线路。

