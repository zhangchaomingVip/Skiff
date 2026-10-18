# 025 验证记录

日期：2026-10-18。实现仅涉及前端与测试预览，无 Rust、原生命令、权限或配置文件格式变更。

## 环境与命令

Windows，Node v24.19.0，Microsoft Edge 151.0.4129.101，Playwright headless，无 CPU 降速。仅使用模拟 pi/Tauri 与本地 mock 供应商，不读取真实凭据或调用付费模型。

预览服务：`npm run dev -- --port 1423 --host 127.0.0.1`（`/tests/preview.html`）。浏览器脚本通过 `SKIFF_PLAYWRIGHT_DIR` 指向本机 Playwright。

| 检查 | 结果 |
| --- | --- |
| `npm run build` | 通过；保留 Vite 的现有大 chunk 提示 |
| `npm test` | 186/186 通过 |
| `npm run check:ui` | 通过 |
| `npm run test:styles` | 通过；0 样式错误，126 组对比度检查通过 |
| `node tests/settings.browser.mjs http://127.0.0.1:1423` | 通过（改动前基线同样通过） |
| `node tests/providers-settings.browser.mjs http://127.0.0.1:1423` | 通过（本期新增） |
| `node tests/sidebar-archive.browser.mjs http://127.0.0.1:1423` | 通过 |

## 实现与保护边界

- 设置分类为外观、联网搜索、系统提示词、**供应商**、**模型线路**、归档会话、快捷键；页内 tab 条已移除，两页各自只描述自己的对象。`SettingsMenu` 由同一张分类表生成，因此侧栏菜单同步出现两个新入口。
- `ProvidersSettingsContent` 承接供应商列表、目录、编辑器、连接测试/并发测速/停止、剔除与恢复、删除确认；保存仍要求新供应商通过连接测试，并沿用 `buildDiscoveredRoutes` 自动生成线路。
- `RoutesSettingsContent`（原 `FamiliesSettingsContent`）保留家族筛选、线路增删改排序、默认线路、故障切换、价格导入与推理等级；导出与文件同步更名，原 `src/components/FamiliesSettings.tsx` 已删除。
- 023 起工作区中未提交的「官方页面最新模型推荐 + 推理等级」改动已完整保留：目录与最新模型来源移入 `src/chat/useModelCatalog.ts`，线路侧的推荐与等级 UI 全部落在 `RoutesSettingsContent`，供应商保存仍消费同一份 `latest`。
- 新增 `src/components/settingsEditor.ts` 承载两页共用的草稿态、pending/error、删除确认、列表↔表单焦点交接与对外 locked 上报；焦点恢复仍是「按 aria-label 找回原行，找不到时退回第一个可用控件」。
- 运行中/加载中同时限制两个分类，原因文案区分「修改供应商配置」与「修改模型配置」；`App.tsx` 中「管理提供商」类入口（模型选择器底部、聊天区空提供商提示、主页模型目录错误态与「去更新」）指向供应商分类。
- CSS：`.family-settings-content` 改为两页共用的 `.settings-editor`；`.dialog-tabs` / `.dialog-tab*` / `.family-tab-content` 随 tab 条移除，避免留下无引用规则。

## 验收矩阵与证据

`tests/providers-settings.browser.mjs` 用真实 Edge + React 应用 + mock bridge 走完整路径：

| 场景 | 断言 |
| --- | --- |
| 供应商是独立分类 | 进入「供应商」后 `aria-pressed=true`；列表含 3 个供应商；「编辑 官方直连 的线路」计数为 0 |
| 目录 → 自定义供应商 → 连接测试 → 保存 | 搜索框出现；`#relay-name`/`#relay-base`/`#relay-key` 填写后「测试连接」返回「连接成功」；保存后列表出现「验证中转」 |
| 保存后的自动建线路与提示 | 状态提示匹配 `已为「验证中转」自动添加 N 条线路` |
| 跨页回链 | 「查看模型线路」后「模型线路」`aria-pressed=true`；「编辑 验证中转 的线路」计数为 3（DeepSeek/Kimi/GLM 各一）；供应商行计数为 0 |
| 主题 | 供应商页与模型线路页在深色下同样渲染并截图 |
| 删除至空态 | 逐个删除 4 个供应商后供应商页显示「还没添加供应商」 |
| 空态回链 | 模型线路页显示「还没有供应商」且无线路行；点「去添加供应商」回到供应商分类（`aria-pressed=true`） |
| 运行错误 | 全程无 `pageerror` |

`tests/settings.browser.mjs` 覆盖设置面板整体回归并新增互不混装断言：编辑供应商返回焦点、pending 期间关闭保护、保存失败重试、迟到测试结果取消、运行中两分类同时禁用、归档与窄窗（600×400 / 550×375）布局；其选择器已从「模型与提供商」tab 流程更新为「供应商」「模型线路」两个分类。

## 截图

`features/025-provider-settings-split/screenshots/`（1100×750，浅/深）：

- `providers-light.png`、`providers-dark.png`：供应商分类与列表。
- `provider-directory.png`：添加供应商目录（搜索 + 预设分组 + 自定义）。
- `provider-saved.png`：保存后带自动建线路提示的列表。
- `routes-light.png`、`routes-dark.png`：模型线路分类（家族筛选 + 线路卡片）。
- `providers-empty.png`：删除全部供应商后的空态。

## 未覆盖

- 原生 WebView2 / Tauri 桌面窗口未实跑（`npm run tauri -- dev` 需要 Rust 编译与 pi 环境）；本期无 Rust 变更，浏览器结果不能替代原生验收。
- 窄窗绘制由 `tests/settings.browser.mjs` 的 600×400 与 550×375 布局等价检查覆盖，非原生缩放。
- `tests/project-switch.preview.mjs` 中的设置入口与页内 tab 选择器（`[aria-label="配置提供商"]`、`[role="tab"]`）在本期之前已与当前实现不符，未纳入本期修改范围。
- 供应商页与模型线路页的深色截图仅覆盖列表态，未补编辑态截图。