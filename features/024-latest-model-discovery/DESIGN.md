# 024 · 最新模型发现与推荐勾选

主页模型列表完全由用户配置的线路模型清单决定（`families.json` → `runtime_offers` → `list_model_runtime`），不会随厂商上新而更新。本次改动让 Skiff 主动感知「厂商出了新模型」，并在用户配置线路时自动推荐最新模型，解决两件事：

1. **新模型提示**：配置的家族里出现用户尚未配置的更新模型时（如已配 5.3、官方出了 5.4），提示用户重新拉取模型列表；
2. **首次自动推荐**：用户首次为某家族添加线路时，自动勾选两个最新模型（旗舰 + flash 变体），其余模型可见但不勾选。

**数据源策略：官方文档页优先，models.dev 目录兜底。** 官方页面更新最早（公告当天即可见），models.dev（社区目录，结构化、稳定）作为解析失败或页面改版时的降级源，最大化保证「最新」的及时性。

## 非目标

- 不自动修改用户已保存的线路配置，只提示与预勾选。用户可能刻意保留旧模型（如中转站旧模型更便宜）。
- 不解析版本号语义做「最新」判断的唯一依据（`deepseek-flash` 的 ID 无版本号、`flashx`/`vision`/`turbo` 是变体），版本对比只作辅助。
- 不做厂商官方 JSON 接口对接——智谱等厂商没有公开的最新模型 JSON，只有 HTML 文档页。

## 数据源设计

### 源一：官方文档页（优先）

各家族一个官方「模型概览/列表」页，由 Rust 侧抓取 HTML（复用 `fetch_pricing_page` 的抓取与体积限制逻辑），前端解析出模型 ID 集合：

| 家族 | 页面 |
| --- | --- |
| glm | `https://docs.bigmodel.cn/cn/guide/start/model-overview` |
| deepseek | `https://api-docs.deepseek.com/zh-cn/quick_start/pricing` |
| kimi | `https://platform.moonshot.cn/docs/pricing/chat` |

解析采用与 `pricingPage.ts` 相同的容错思路（HTML 表格 / JSON 嵌套扫描），提取**在售模型 ID 列表**；每个 ID 尽量附带 status（如「已下线」字样）。页面改版导致解析为空时静默降级到源二，不报错打扰。

- 优点：上新当天即收录，时效最高。
- 风险：页面结构变化 → 解析失败率上升，因此必须有源二兜底与缓存降级。

### 源二：models.dev 公共目录（兜底）

复用现有 `fetch_public_catalog`（`providers.rs:346`，24h 磁盘缓存、断网回退过期缓存），条目含 `status` 与 `last_updated`。已验证 zhipuai/deepseek/moonshotai-cn 数据齐全（glm-5.3 → 2026-08-14、glm-5.3-flash → 2026-08-26 等），deprecated 标记可信（deepseek-v4-flash 已标记）。

### 合并规则

按家族合并两源，产出一个 `FamilyCatalog`：

- 模型 ID 集合取并集；官方源命中的 ID 标记 `official: true`；
- status：官方源的「已下线/弃用」字样优先，其次 models.dev 的 `status` 字段；
- 变体分组：按「基础版本」归组（如 `glm-5.3` / `glm-5.3-flash` / `glm-5.3-flashx` 同属 5.3 组），基础版本提取规则为去掉尾部 `-flash`、`-flashx`、`-turbo`、`-vision` 等已知变体后缀，剩余部分相同即同组；`deepseek-flash` 这类无版本号 ID 独立成组。
- **最新组** = 在售（非 deprecated）模型中 `last_updated` 最新（官方源无时间时以 models.dev 为准）的基础版本组。组内推荐序：旗舰 > flash > 其他变体。

## 功能一：新模型提示

### 检测时机与缓存

- Rust 新增 `latest_models` 命令：拉取并合并两源，产出各家族的 `FamilyCatalog`。官方页抓取结果带独立磁盘缓存（TTL 6h），models.dev 沿用 24h；两源都失败时返回过期缓存并带 `stale: true`，两源均无缓存时报错（前端静默，不弹错误）。
- 启动后调用一次 + 手动刷新（主页/设置页提供入口）。

### Diff 逻辑（前端）

对每个家族比较「已配置模型 ID 集合」与 `FamilyCatalog`：

- **有更新模型** = 最新组中存在未配置的在售 ID（如最新组是 5.4，用户只配了 5.3）→ 提示；
- **有淘汰模型** = 已配置 ID 被标记 deprecated 且存在同家族替代 → 提示（次要，弱化展示）。

### 展示

- 主页家族分组头（`LauncherView` 的 `launcher-group-head`）追加提示 chip：「有新模型 glm-5.4」，点击进入该家族对应线路的编辑页，预打开「获取模型列表」并高亮新 ID；多线路时选默认线路。
- 提示 dismiss 后写入 localStorage（key 含模型 ID，换新模型会重新提示），不重复打扰。
- 主页错误路径不新增：目录拉取失败时主页完全不变。

## 功能二：首次自动推荐勾选

新增共享模块（如 `src/chat/latestModels.ts`）导出：

- `pickRecommendedIds(discovered, catalog, familyId): { recommended: string[]; reason: "latest" | "fallback-available" | "offline" }`：输入「获取模型列表」得到的 ID 与家族目录，输出推荐勾选集合（旗舰 + flash，最多 2 个）；
- 三档降级：目录可匹配 → 推荐最新组内中转站也有的 2 个；目录离线或无匹配 → 在发现列表内选最新（按 `last_updated`，无则按现有 `sortDiscoveredModels` 序取前 2）；完全无数据 → 返回空集，UI 维持现状。

接入两个现有入口：

1. **ModelIdField 多选弹层**（`ModelIdField.tsx`）：该家族在当前线路下尚无已添加模型时，拉取成功后按推荐集合预勾选，其余保持可见不勾；已有模型时维持全不勾。弹层内对推荐项加「推荐」小标。
2. **批量建线路**（`providerRoutes.ts` 的 `buildDiscoveredRoutes`）：`fillModel` 之外增加推荐过滤，只有推荐集合内的 ID 才写入新线路的模型清单（推荐为空时保持现状全量写入）；被过滤的 ID 仍可通过手动勾选补回。函数签名需向后兼容，推荐模块不可用时行为与现状一致。

## 验证（计划）

- `npm test`：合并规则（官方优先、status 优先、变体分组）、`pickRecommendedIds` 三档降级、diff 有更新/淘汰/无变化、`buildDiscoveredRoutes` 推荐过滤与空推荐回退。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`：官方页解析（fixture HTML，含改版样例 → 空结果降级）、缓存 TTL 与 stale 回退、`latest_models` 两源合并。
- `npm run build`、`npm run check:ui`、`cargo check`。
- 浏览器模拟桥（`tests/preview.html`）：首次添加 GLM 线路自动勾选两个推荐模型、手动追加旧模型、主页新模型 chip 显示与 dismiss、明暗主题。
- 真机冒烟：`npm run dev -- --port 1421` 隔离目录下走一遍新增中转 → 测试 → 推荐勾选 → 保存 → 主页仅显示推荐模型。
