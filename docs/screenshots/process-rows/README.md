# 对话过程行

预览入口：`http://localhost:1421/tests/preview.html?fixture=process-rows&theme=light`，深色主题改为 `theme=dark`。仅使用 mock bridge，不调用真实模型。

- `light-wide.png` / `dark-wide.png`：1440 × 1000，三条 bash 命令、write + edit 两个文件、read + edit 混合动作，以及失败的长命令。
- `light-narrow.png` / `dark-narrow.png`：600 × 900，同一组内容的窄屏布局。

轮次标题、思考过程、工具组和单个工具使用同一行结构：20px 图标槽、中间文字、右侧状态、16px 箭头槽。桌面样例中所有顶层过程行的图标左侧均为 296px、文字左侧均为 324px、箭头右侧均为 1124px，行高为 32px。窄屏检查未出现消息区或折叠行横向溢出。

交互检查：鼠标展开工具组和子工具；Enter 展开嵌套参数，保持外层展开；Space 收起工具组；Enter 收起和恢复本轮过程。各层 `aria-expanded` 与原生 `details.open` 同步。

验证：`npm run build`、`npm run check:ui`、`npm run test:styles`，以及 `node --import ./tests/register.mjs --test tests/polish.test.ts`（18 项通过）。文件数仅对路径明确的单文件工具去重计数，多文件工具或不完整参数使用文件操作次数；失败或未完成的操作不使用完成时态。
