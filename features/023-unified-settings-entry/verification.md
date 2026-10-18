# 023 验证记录

日期：2026-10-17。实现仅涉及前端与测试预览，无 Rust、原生命令、权限或配置格式变更。

后续变更：2026-10-18 供应商已拆为独立分类、原分类更名为「模型线路」，见 [025-provider-settings-split](../025-provider-settings-split/verification.md)；本文记录的是拆分前「模型与提供商」组合页的验收状态。

## 实现与保护边界

- `SettingsDialog` 是唯一的顶层设置容器，包含外观、模型与提供商、归档会话、快捷键。
- `FamiliesSettingsContent` 保留原供应商/线路表单、发现、并发测试、取消、价格导入、汇率、默认线路、排序、启停和故障切换处理，仅移出 Dialog 和归档分类。向容器报告编辑/pending 状态，并提供返回动作。
- 所有入口读取 App 中同一份分类限制；运行时外观和帮助可用，模型配置受当前会话运行、加载和工作区状态限制。归档继续校验 navigationBusy 和目标会话 canClose。
- 展开侧栏使用底部设置菜单，折叠和窄窗使用顶栏备用按钮。抽屉选择分类以及设置打开后跨越窄窗断点均不会叠加导航模态窗口。
- 主题继续使用 theme.ts / theme-init.js / syncNativeTheme，不改变聊天 key、会话或草稿。配置继续显式保存，失败保留表单。
- Dialog 在 keydown 阶段处理 Esc，避免保存 pending 时原生 close watcher 关闭窗口；嵌套确认层不会把取消传播到外层。编辑返回恢复到原列表控件，设置关闭使用原入口或可见备用入口。

## 环境与命令

Windows，Node v24.19.0，Microsoft Edge 151.0.4129.101，Playwright headless，无 CPU 降速。仅使用模拟 pi/Tauri，不读取真实凭据或调用付费模型。

| 检查 | 结果 |
| --- | --- |
| `npm run build` | 通过；保留 Vite 的现有大 chunk 提示 |
| `npm test` | 176/176 通过 |
| `npm run check:ui` | 通过 |
| `npm run test:styles` | 通过；0 样式错误，126 组对比度检查通过 |
| `node tests/settings.browser.mjs http://127.0.0.1:1423` | 通过 |
| `node tests/sidebar-archive.browser.mjs http://127.0.0.1:1423` | 通过 |
| `node tests/interactions.browser.mjs http://127.0.0.1:1424` | 通过 |
| `node tests/retrievability.browser.mjs http://127.0.0.1:1424` | 通过 |
| `git diff --check` | 通过 |

预览服务：

```powershell
npm run dev -- --port 1423 --host 127.0.0.1
npx vite --config tests/session-switch.vite.ts --port 1424 --host 127.0.0.1
$env:SKIFF_PLAYWRIGHT_DIR = "C:/Users/49772/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
```

1423 使用 `/tests/preview.html`。1424 使用仓库既有的 session-switch 观测配置，供聊天交互及搜索/草稿回归脚本读取运行态。测试脚本中的旧设置分类定位已更新为新入口。mock 配置补齐空的 Auto 家族，使测试遵循当前完整配置路径，能够验证真实 Offer 的别名、线路、账户与价格。

## 验收矩阵与证据

| 场景 | 本次证据 |
| --- | --- |
| 所有入口 | 设置菜单、主页无线路时的管理入口、聊天模型选择器管理入口、折叠顶栏、Ctrl+, 均进入同一面板；无重复 Dialog。菜单打开后按 Ctrl+, 会先收起原弹层。 |
| 分类与编辑 | 定向进入供应商列表；模型线路编辑、返回/取消、保存延迟、Esc/关闭禁用、失败重试、供应商删除确认均通过；返回焦点回到原供应商行。 |
| 测试取消 | 延迟本地 mock 测试，Esc 返回后打开另一供应商；验证取消命令发出，迟到结果不覆盖新编辑页。 |
| 配置错误 | 保留原错误，提供重新读取配置；外观与快捷键仍能进入。 |
| 主题 | 三种偏好、实时系统主题变化、localStorage、刷新后的偏好和选中状态通过；切主题前后 pi 实例 ID、聊天草稿和工作区记录不变。 |
| 键盘与弹层 | Tab/Shift+Tab 循环，Ctrl+K/Ctrl+N/停止快捷键隔离，重复设置快捷键，IME 保护，确认层/编辑层/容器 Esc 顺序通过。分享、系统提示词或扩展请求打开时 Ctrl+, 不抢占。 |
| 窄窗和缩放布局 | 1100×750、600×400、550×375 通过；最后一项模拟 1100×750 在 200% 缩放下的有效布局空间。关闭按钮持续可见，分类、模型编辑保存可达，无页面或面板横向溢出。 |
| 侧栏与焦点 | 抽屉选择后仅剩设置模态；宽窗设置打开后缩到窄窗不会弹出侧栏抽屉；入口消失后焦点返回顶栏设置。 |
| 模型与推理 | 既有 sidebar-archive 脚本验证长别名、同型号不同线路、键盘选择与 routeId；模型与推理实现未拆分，配置与 Offer 单元测试通过。 |
| 多会话 | A 生成期间 B 打开设置；A 待确认状态继续更新，关闭设置不停止 A、不发送其确认响应；返回 A 后仍能处理对应请求。当前会话运行时模型分类禁用，外观/帮助可用。 |
| 聊天回归 | 018 脚本覆盖流式、编辑、恢复草稿、图片/文本附件、重试、插话/排队、停止、扩展请求、原 owner 隔离和清理；新增脚本验证分享预览、系统提示词与诊断入口保留。 |
| 搜索和草稿 | 019 脚本覆盖历史搜索、冷会话、只读历史、导航/主页/刷新恢复、失败发送、归档/删除清理与存储限制。 |
| 归档 | 查看/关闭预览、删除确认、恢复目标、删除仅清索引、保留 pi 文件、运行中保护、进程/监听器清理通过。 |
| 原生窗口 | TitleBar 与拖拽/窗口控制代码未变；浏览器结果不代表原生窗口验收，见下方限制。 |

机器可读证据：

- [本期交互验证](browser-verification.json)
- [聊天交互回归](chat-regression.json)
- [搜索和草稿回归](retrievability-regression.json)

## 截图

均为模拟数据，截图时禁用过渡动画以捕获稳定布局。

| 内容 | 浅色 | 深色 |
| --- | --- | --- |
| 1100×750 | [默认窗口](screenshots/light-default.png) | [默认窗口](screenshots/dark-default.png) |
| 600×400 | [最小窗口](screenshots/light-minimum.png) | [最小窗口](screenshots/dark-minimum.png) |
| 200% 有效布局空间 | [布局模拟](screenshots/light-zoom-200-layout.png) | [布局模拟](screenshots/dark-zoom-200-layout.png) |

- [供应商编辑](screenshots/provider-editor.png)
- [最小窗口编辑与保存](screenshots/editor-minimum.png)
- [缩放布局中的编辑与保存](screenshots/editor-zoom-200-layout.png)
- [归档分类](screenshots/archives.png)

## 尚未覆盖的环境行为

- 未启动 Tauri/WebView2 实测原生拖拽、最小化、最大化、关闭、OS 窗口主题同步和真实 200% WebView 缩放。保留既有实现，布局模拟不能替代这些原生验证。
- 未在实体 macOS 验证 Cmd+,。平台判断和帮助按现有实际组合键实现；Ctrl+K 和 Ctrl+Shift+Backspace 保留 Ctrl，不宣称额外的 Cmd 组合可用。
- 未调用真实供应商、外部价格页面或搜索服务，也未验证系统分享面板；相关业务实现与原回调保留，配置测试使用本地 mock。新增范围内未发现功能回退。
