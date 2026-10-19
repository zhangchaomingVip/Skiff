# 028 验证记录

日期：2026-10-19。已完成第一期实现；未新增原生命令、配置迁移或第二期管理工具。

## 实现与边界

- `src/chat/settingsModels.ts` 统一设置页的可用候选、精确 ID 优先/目录别名匹配、测试目标、摘要与筛选。聊天和故障切换的精确 ID 匹配未改动。
- 供应商增加搜索、按搜索结果计数的状态筛选和预设来源标签，移除列表密钥指纹与重复状态标签；高级字段折叠，原生表单校验失败后展开并聚焦。未知主机不会通过预设端点的字符串前缀被认作官方。
- 模型展示各自优先供应商，映射以路线 ID 为标识，区分家族默认、模型优先及阻断原因。Auto 只计入至少有一个未剔除模型的可用路线。测试使用真实调用 ID、供应商协议、端点和超时；取消、配置变化和卸载后均忽略迟到结果。
- 路线增加搜索/可用筛选、显示/总量计数、最多两个实际模型摘要、全部模型展开及逐模型币种/报价。更多菜单保留编辑、默认、排序和删除；筛选期间禁用排序，默认路线保护、显式清空和全局故障切换继续使用原 RPC。
- 供应商保存后按家族提供精确路线入口，编辑草稿中不跳页。保存保留价格、能力、推理等级、路线顺序及剔除模型原位置。列表失去原行或配置更新临时锁定后恢复焦点；菜单复用 Popover 的 Esc 处理与焦点恢复。

## 已运行检查

环境：Windows，Node.js 24.19.0，headless Microsoft Edge 151；Vite 预览端口 1421。

| 检查 | 结果 |
| --- | --- |
| `npm run build` | 通过；保留 Vite 既有的大 chunk 提示 |
| `npm test` | 200/200 通过；包含新增 6 项设置派生/保真回归 |
| `npm run check:ui` | 通过 |
| `npm run test:styles` | 样式错误 0；126 对对比度检查全部通过 |
| `node tests/settings.browser.mjs http://127.0.0.1:1421` | 通过 |
| `node tests/providers-settings.browser.mjs http://127.0.0.1:1421` | 通过 |
| `node tests/models-settings.browser.mjs http://127.0.0.1:1421` | 通过 |
| `node tests/settings-information.browser.mjs http://127.0.0.1:1421` | 通过 |

浏览器检查均使用 `npm run dev -- --port 1421 --host 127.0.0.1` 与 `/tests/preview.html` 的模拟桥接，未调用真实模型。Playwright 使用工作区之外的临时安装，通过 `SKIFF_PLAYWRIGHT_DIR` 指定；没有修改项目依赖。

## 验收覆盖

| 场景 | 自动化证据 |
| --- | --- |
| 供应商搜索/状态/空态 | 名称和脱敏端点搜索，不匹配密钥；搜索后的状态计数、启停后行消失及工具条焦点；无供应商/无结果和添加入口 |
| 来源与协议 | 官方、中转、本机、自定义及相似未知域名兜底；六种协议选项；本机空密钥连接测试可操作 |
| 可用性/模型映射 | 默认路线缺少目标模型；供应商停用、路线停用、全部剔除、空模型；精确 ID 胜过前置别名，多个别名按原顺序；Auto 无独立测试且不虚计可用数 |
| 测试请求与生命周期 | 断言真实 `first/deepseek-v4.1-flash`、`anthropic`、端点、123 秒超时；供应商/实际 ID/成功失败/延迟保留；停止、编辑清单变化及卸载的迟到结果被忽略 |
| 数据保真 | 筛选/展开前后配置相等；供应商保存逐项比对路线、模型价格/币种、能力、顺序、默认和剔除模型；手动添加后展示超过两个，刷新不覆盖手动项 |
| 逐模型报价 | 同路线不同 CNY/USD 价格、零价和全部真实模型 ID；摘要未移除历史或手动模型 |
| 路线操作 | 默认路线禁删/禁停、显式清空确认及取消、设默认、完整家族顺序上移、筛选时禁排序；删除确认/Esc/行移除后焦点；筛选空结果时全局故障切换仍生效 |
| 导航与锁定 | 保存后指定家族/供应商/路线并进入正确编辑器；草稿不提供跨页入口；分类锁、pending、运行中限制和嵌套确认 Esc 回归 |
| 视觉与键盘 | 两种主题，1100×750、600×400、550×375；长显示名/ID、映射表局部横向滚动、页面不横向溢出、保存按钮可达；菜单方向键/Home/End/Esc、滚动到聚焦项及关闭后恢复焦点 |

## 截图

完整证据在 [screenshots/](screenshots/)，代表截图：

- [浅色供应商](screenshots/information-providers-light-1100.png)
- [浅色实际模型映射与测试](screenshots/information-models-mapping-light.png)
- [逐模型价格](screenshots/information-routes-light.png)
- [深色路线](screenshots/information-routes-dark-1100.png)
- [550×375 深色菜单](screenshots/information-menu-dark-550.png)
- [550×375 局部映射表](screenshots/information-models-light-550.png)
- [600×400 深色供应商](screenshots/information-providers-dark-600.png)
- [窄窗保存按钮](screenshots/information-editor-light-550.png)

已人工查看代表截图。550×375 是 1100×750 在 200% 下的布局等效验证，不代表原生 WebView 的实际缩放测试。

## 未覆盖项

未运行 Tauri 桌面原生 WebView、真实 pi/付费服务、系统密钥存储及六种协议的真实服务联通测试；未运行 Rust 检查（本期无 Rust 或 capability 改动）。浏览器模拟验证请求参数和交互，不替代原生端到端协议验证。现有聊天/故障切换行为由全量 Node 回归覆盖，未进行真实跨账户调用。
