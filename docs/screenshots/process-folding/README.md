# 两阶段过程折叠

完整界面：`http://localhost:1421/tests/preview.html?fixture=process-folding&theme=light`，深色改为 `theme=dark`。使用 mock bridge，不调用模型。

流式回归页：`http://localhost:1421/tests/process-folding.html?theme=light`。依次点击控制按钮，驱动正式 reducer 和 MessageList，覆盖思考增量、乱序工具结果、首个正文 token、正文中工具调用、成功/失败和结束事件。

动作与失败回归页：`http://localhost:1421/tests/preview.html?fixture=process-actions&theme=light`。复现纯思考轮首，以及正文之间两次读取（一次失败）和一次搜索。

工具计数回归页：`http://localhost:1421/tests/preview.html?fixture=file-discovery&theme=light`。源调用顺序故意打乱，包含同一路径的两次读取、写入与编辑，以及 bash、文件查找、列目录和内容搜索；验证摘要按固定顺序显示，展开详情仍保留具体动作。

## 渲染规则

- 首个正文 token 前，所有思考、工具和结果收进轮首摘要；正文之间的过程收进行内摘要，默认均关闭。
- 实时字数包含正在接收的思考段。现有消息没有独立的思考结束字段，完成段数通过后续非空内容块或消息结束识别。空的 `text_start` 不冻结计数。
- 摘要直接显示「思考了 N 段（X 字）」，去掉「思考过程」前缀。字数保留千分位逗号；首段尚未结束时显示「思考中（X 字）」。轮首继续显示当前步骤数，行内省略步骤。
- 工具摘要固定按「读取了 N 个文件 · 编辑了 M 个文件 · 执行了 K 条命令 · 联网搜索了 S 次」排序，零次项隐藏。全部按工具调用次数计数：相同路径不去重，write/edit 合并为编辑；bash、glob/find、ls/list/tree、grep/rg 等本地检索合并为命令，只有 web_search 独立计为联网搜索。未知工具保留在最后的工具调用项，失败次数跟在对应类别后。
- 单次调用详情保留真实动作、目标、参数、结果与编辑差异。摘要中的命令类别包含文件查找和目录列举，展开后仍能看清每个工具做了什么。
- 首个正文 token 到达时冻结轮首思考和步骤数字；下一段正文到达时冻结相应行内数字。工具动作在调用出现时即可见，结果和失败注记持续更新，迟到结果也不会冻结。助手图片也作为内容边界，保留原来的显示顺序。
- 每个折叠组使用稳定标识，手动展开/收起在流式更新、下一条助手消息及结束事件后保持。搜索显式揭示一轮时仍可展开其过程。
- 复用 ProcessDisclosure 的图标、文案、右侧状态与箭头槽。行内摘要使用小字号、透明背景和单行省略；展开只下推后文。

## 验证

- 鼠标、Enter 切换，Space 关闭当前组，`aria-expanded`、原生 `details.open` 和持有的展开状态同步。
- 流式预览中，轮首从 0 字增长到 1,280 字；工具组完成后显示 1 段思考、2 条命令、步骤 3。正文开始后数字冻结，行内工具完成后仍为原值。
- 手动展开轮首后，工具完成和正文到达都不重置它。展开行内摘要前后，上方正文的 top 均为 276.890625px；下一条助手消息到达后行内组保持展开。
- 行内工具失败在收起态标在对应动作旁，不把整个折叠组标为失败；真正的轮次错误仍在轮首显示「运行失败」。展开后的工具组及单次调用也保留失败注记和详情。
- 1440 × 1000 和 600 × 900，浅深色均无横向溢出。行内行背景透明，文案为 `nowrap` / `ellipsis`，数字为 `tabular-nums`。
- `npm test`：238 项通过；`npm run build`、`npm run check:ui`、`npm run test:styles` 通过。相关的旧浏览器脚本已调整默认折叠预期，本次未整套执行这些脚本。

截图：`light-wide.jpg`、`dark-wide.jpg`、`light-narrow.jpg`、`dark-narrow.jpg`；`summary-dark.jpg` 是正文区裁剪。所有内容为测试数据。

动作计数与失败注记更新后的截图：`actions-light.jpg`、`actions-dark.jpg`（1280 × 720），`actions-light-narrow.jpg`、`actions-dark-narrow.jpg`（600 × 900）。前述早期截图保留两阶段折叠的布局记录。

文件动作分类早期截图：`file-discovery-light.jpg`、`file-discovery-dark.jpg`。保留单次查找、列目录、读取及编辑详情的布局记录，摘要的计数口径以当前规则为准。

早期统一计数与排序截图：`counts-light.jpg`、`counts-dark.jpg`。保留布局记录，联网搜索与本地检索的分类以当前规则为准。

当前摘要截图：`web-summary-light.jpg`、`web-summary-dark.jpg`。摘要为「思考了 1 段（28 字） · 读取了 2 个文件 · 编辑了 2 个文件 · 执行了 4 条命令 · 联网搜索了 1 次（1 失败）」，展开后保留本地检索和联网搜索的真实动作与目标，键盘折叠行为保持。
