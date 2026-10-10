# 会话切换基线

日期：2026-10-10。源版本：`653ba3cf522cad157c4e3b7c7515e1ecd712b8f2`。开始实施时只有已暂存的 `features/011-session-switch-performance/task.md`，应用源文件没有未提交差异。

环境：Windows 11 家庭版中文，10.0.26200；Intel Core Ultra 5 125H；33,846,259,712 字节内存；Node 24.19.0、npm 11.17.0、pi 1.1.0；Edge 151.0.4129.101。机器同时安装 WebView2 149.0.4022.80 和 151.0.4129.101，未启动 Tauri，不能确定实际应用使用哪个版本。视口 1440×1000、DPR 1、headless Edge、无 CPU 限速。

测试入口复用 `uiFixture.mjs` 和 `mockPi.mjs`，挂载正式 App。独立 production 构建和 localhost:1431/1432 隔离 origin，不读取真实 pi 配置或日常应用存储。测试配置的 `SKIFF_SWITCH_BASELINE` 用 `git show` 加载冻结版本的应用源码，前后使用同一 fixture 和观测代码。标准构建关闭 React profiling 和浏览器 tracing；分析构建另开 1433，启用 profiling 和 Chrome Performance trace。两个采集类型不能混合作性能对比。

真实复现：先等 Session 0 就绪，设置 `rpc_start` 屏障，实际点击 Session 1；启动挂起期间再实际点击跨项目 Session 2。旧版 Session 2 按钮为 disabled，普通 Playwright 点击超时，捕获阶段没有 Session 2 的可信点击，选中 ID 仍为 Session 1。释放屏障后仅 Session 1 加载。没有使用 force 点击或通过替换 hook 目标完成此复现。

另一个独立问题：已加载 Session 0→Session 1 的首个 App render，目标 ID 已变化，但历史还属于 Session 0。测试在 App 的 props 交付边界检查 fixture 归属标签，并只记录错误消息数和消息规模；不把合成消息的 `history_0` ID 当作会话 ID。旧版在边界检查失败。

这证明普通小规模复现首先是**导航被禁用**，另外存在**旧快照进入新子树**。等待旧进程的启动与退出是异步串行等待；短历史下不能由此推断主线程阻塞。代码块和长历史的额外渲染成本单独记录在性能矩阵。

基线普通场景：100 条纯文本、30 个会话、项目折叠、历史响应注入 150 ms。预热一次往返，60 次可信点击，两个方向各 30 次。

| 阶段 | P50 | P95 |
| --- | ---: | ---: |
| 点击→目标高亮 DOM 提交 | 18.8 ms | 57.2 ms |
| 点击→加载占位 | 无占位 | 无占位 |
| 点击→两次 rAF 绘制机会 | 34.9 ms | 86.1 ms |
| 点击→历史 DOM 提交 / 可发送快照 | 208.0 ms | 231.0 ms |

两次 rAF 是浏览器获得绘制机会的观测值，不是操作系统屏幕实际呈现时间；React Profiler commit 也不是绘制时间。历史提交与选中反馈分开统计。原始基线、最终结果、分规模采样和诊断 trace 的索引见 `verification.md`。

复现命令（PowerShell；已安装 Playwright，或设置 `SKIFF_PLAYWRIGHT_DIR` 指向现有安装）：

```powershell
npm run build
$env:SKIFF_SWITCH_BASELINE="653ba3cf522cad157c4e3b7c7515e1ecd712b8f2"
$env:SKIFF_SWITCH_OUT="dist/session-switch-baseline"
npx vite build --config tests/session-switch.vite.ts
Remove-Item Env:SKIFF_SWITCH_BASELINE, Env:SKIFF_SWITCH_OUT
npx vite preview --config tests/session-switch.vite.ts --outDir dist/session-switch-baseline --port 1431 --strictPort
# 在另一终端执行，普通可信点击，不强制点击 disabled 控件：
node tests/session-switch.browser.mjs http://localhost:1431 dist/baseline.json --baseline
```

真实 pi 的本地集成通过；它使用临时配置及本机 HTTP 服务，验证推理、图片、usage、fork 和恢复，并清理子进程。它没有经过 Tauri 的 Windows 进程树管理，不能代替真实 WebView2 的启动/退出计时。
