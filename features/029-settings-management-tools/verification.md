# 029 验证记录

日期：2026-10-19。基于 028 已有验收记录实现，复用真实模型匹配、可用性、来源判定、菜单和设置锁定。

## 实现

- 供应商增加显式批量模式、当前结果全选、稳定 ID 选择、选中数量和影响确认。搜索、状态、分组变化清空选择，显示排序保留选择；离页或退出模式清空。确认期间锁定提交，失败保留选择并重新读取预览。
- `preview_relay_batch` 返回最新影响和不含明文配置的摘要令牌；`batch_relays` 持有原生配置锁，重新校验全部 ID、确认令牌及默认路线，再一次验证/保存。删除包含任意默认路线时整批阻断，提供对应家族调整入口。停用只改变供应商开关。
- 路线菜单的上/下移也进入排序草稿；单个家族的「调整切换顺序」使用全部路线，提供拖动、上/下移、读屏状态提示、保存和取消。筛选值保留；Esc 丢弃草稿，外层分类锁定。原生仅接受完整、无重复的路线 ID 集合；集合变化拒绝保存，普通保存失败保留草稿。
- 供应商显示排序和可选来源分组由内存派生，偏好独立保存在 `skiff.settings.providers-view.v1`。最近使用降序、未使用置后，同值保留配置顺序；不修改家族配置数组。
- 原生 `settings_metadata.rs` 管理当前 pi agent 目录内的 `skiff-settings-metadata.v1.json`，沿用 `get_pi_agent_dir()`，尊重 `PI_CODING_AGENT_DIR`。该文件原子写入，读/合并/写与配置变更共用配置锁。丢失、损坏、未知版本降级为空记录；写入失败不改变模型请求结果。
- 连接指纹仅在原生计算和保存，前端只读取独立版本及失效标识；元数据没有密钥、原始 URL、请求/响应正文或服务端错误正文。结果只保存成功/失败、模型、时间、请求耗时、HTTP 状态或固定错误类别。名称/价格/显示名不使结果失效，端点/密钥/协议/超时变化使旧记录失效。
- 测试按发起顺序保护，完成时核对目标和版本；取消不写记录。编辑草稿结果保留在原生临时票据中，保存成功后只转存与最终连接及仍配置模型一致的结果，取消不污染历史。新增供应商通过测试判定仍使用本轮临时结果，且实际模型 ID 必须仍在当前清单中；仅改名称不会清除测试依据。
- 供应商显示最近完成测试，路线只查询仍配置的实际模型，模型页使用 028 解析出的具体目标；无记录显示未测试，超过七天显示过期。历史摘要注明实际模型、测试时间和请求耗时，不作为当前健康或路由决策依据。
- 聊天原生 stdout 观察器仅处理实时有效 assistant `message_end`，按实际 provider/model 精确对应受管理 offer；失败、取消、选择、测试和历史 RPC 不计入。工具调用可计入；每次响应去重一次，多个会话在配置锁内合并并保留较新时间。变更事件使已打开的设置页刷新本地记录，无后台测速。
- 配置提交及查询清理无引用的测试/使用记录；家族配置格式、推荐、价格、路由选择和跨账户授权逻辑不变。
- 新增命令已注册；检查了 `src-tauri/capabilities/default.json`：未增加系统访问或通用文件/进程插件权限。新增接口只操作既定 agent 目录的配置/元数据。
- 六协议 loopback 回归发现并修正原有连接测试鉴权分支：Anthropic 使用 `x-api-key`，Google/Vertex 使用既有 query key，不额外附加 Bearer。

## 检查结果

环境：Windows，Node.js 24.19.0，headless Microsoft Edge 151，隔离预览端口 1421。使用该端口已有的本仓库 Vite 服务；项目依赖未增加 Playwright，使用工作区外的 `D:/workspace/pw-tmp/node_modules/playwright`。

| 检查 | 结果 |
| --- | --- |
| `npm run build` | 通过；仅保留既有 Vite 大 chunk 提示 |
| `npm test` | 203/203 通过，新增 3 项排序/记录/影响纯逻辑回归 |
| `npm run check:ui` | 通过 |
| `npm run test:styles` | 样式错误 0，126 对对比度检查全部通过 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 40 通过；另 1 项需要显式 pi 路径的测试单独运行通过 |
| `tests/settings.browser.mjs` | 通过 |
| `tests/providers-settings.browser.mjs` | 通过 |
| `tests/models-settings.browser.mjs` | 通过 |
| `tests/settings-information.browser.mjs` | 通过；排序场景改为验证显式保存 |
| `tests/settings-management.browser.mjs` | 通过 |
| `tests/pi.integration.mjs <pi-cli.js>` | 通过，临时 agent 配置和本地 mock 服务 |
| 原生 `real_pi_responses_flow_through_native_metadata_observer` | 单独运行通过，内部运行扩展后的 `tests/pi.families.integration.mjs`，包含同实际模型 ID 的多个供应商 |

浏览器命令均传入 `http://127.0.0.1:1421`。运行既有四个设置脚本时设置 `SKIFF_SETTINGS_SCREENSHOTS=../features/029-settings-management-tools/screenshots/`，避免覆盖 028 截图。

真实 pi 测试使用已安装的 `@earendil-works/pi-coding-agent/dist/bundle/cli.js`，通过参数/`SKIFF_TEST_PI_CLI` 显式提供。可重跑原生集成：

```powershell
$env:SKIFF_TEST_PI_CLI = "<本机 pi-cli.js 绝对路径>"
cargo test --manifest-path src-tauri/Cargo.toml --lib real_pi_responses_flow_through_native_metadata_observer -- --ignored
```

该测试由 Node 建立临时 agent 目录和 loopback 服务，捕获真实 pi 事件后交给与生产 stdout 观察器相同的原生记录函数。验证流式/非流式、多模型/同模型供应商、价格/能力、图片/历史恢复、401/超时、原生归属与响应去重；临时配置和事件文件在完成后清理。未使用用户凭据或付费端点。

## 验收证据

| 场景 | 证据 |
| --- | --- |
| 批量选择 | management 浏览器脚本验证当前结果全选、筛选/分组清空、排序保留、退出/离页、Enter 进入批量模式 |
| 批量启停 | 原生事务用例验证全量 ID 校验、默认/路线开关保真；浏览器模拟保存失败后整批不变、选择保留及重试 |
| 批量删除 | 默认路线整批阻断、家族入口、名称/路线数；取消及成功删除；配置变化后拒绝旧确认并刷新预览 |
| 测试记录 | 原生测试记录最近失败、取消不覆盖、磁盘重读；纯逻辑验证无记录/七天边界/配置变化；浏览器刷新后读回 |
| 测试归属 | 精确供应商/模型、别名实际 ID、迟到结果保护；六种协议通过本地 HTTP 服务验证请求鉴权和持久结果 |
| 草稿与秘密 | 原生草稿一致/不一致/新供应商转存，记录文件无密钥/URL/服务端正文；浏览器取消不写、保存转存、超时修改失效及缓存脱敏 |
| 使用记录 | 原生仅实时有效响应/工具调用，排除失败/取消/历史/未知归属，去重、多线程会话合并；真实 pi 事件接原生记录器；浏览器设置打开时刷新最近使用排序 |
| 展示排序 | 纯逻辑覆盖名称/最近使用/状态、同值稳定和配置不变；浏览器覆盖筛选、来源分组和偏好读取 |
| 路线排序 | 搜索/仅可用期间进入仍包含全部路线；拖动/键盘、保存/取消/Esc、失败草稿保留/重试、外部集合变化拒绝与重新加载 |
| 路由回归 | 既有 Node 测试覆盖固定会话、精确实际 ID、能力要求、只向后/不绕回及跨账户授权；原生排序不改变路线内容/默认值，真实 pi 测试覆盖具体目标响应归属 |
| 数据兼容 | 旧配置和空元数据直接读取；原生覆盖损坏/不可写、模型删除清理、并发合并，既有迁移回归全部通过 |
| 视觉与焦点 | 既有设置回归两主题、长名称、550×375/600×400；新增批量条、确认层和排序键盘操作，检查无横向溢出并人工查看代表截图 |

## 截图与验证边界

代表截图：

- [批量影响确认](screenshots/management-batch-impact-light.png)
- [默认路线阻断](screenshots/management-batch-default-blocked-light.png)
- [刷新后测试记录](screenshots/management-history-reloaded-light.png)
- [最近使用排序](screenshots/management-recent-use-light.png)
- [完整路线排序草稿](screenshots/management-route-order-light.png)
- [深色窄窗确认层](screenshots/management-confirm-dark-550.png)
- [浅色窄窗批量条](screenshots/management-batch-actions-light-550.png)
- [实际模型映射](screenshots/information-models-mapping-light.png)

550×375 是 1100×750 在 200% 下的布局等效检查，未实测原生 WebView 的系统缩放。未运行完整 Tauri 桌面 WebView、真实厂商六协议端点或真实扣费账户授权流程。真实 pi 的使用归属集成通过捕获事件接同一原生记录器验证，未把整个 Tauri 进程事件桥作为端到端集成启动；完整桌面自动跨账户切换链路也未实测。上述边界不等同于 mock 或纯逻辑用例已经覆盖真实服务。
