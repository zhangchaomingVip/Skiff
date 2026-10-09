import { useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { Button, IconButton, Card, Chip, Dialog, Field, ListRow, Popover, SegmentedControl, Tooltip } from "../src/components/ui";
import { ProjectDialog } from "../src/components/ProjectDialog";
import { ConfirmDialog } from "../src/components/ConfirmDialog";
import { ThemeToggle } from "../src/components/ThemeToggle";
import { Icon } from "../src/components/Icon";
import { ComposerHarness } from "./ComposerHarness";
import { setThemePreference, type ThemePreference } from "../src/theme";
import "../src/tokens.css";
import "../src/index.css";
import "../src/components/ui.css";
import "./uiGallery.css";

const requested = new URLSearchParams(location.search).get("theme");
if (["light", "dark", "system"].includes(requested ?? "")) setThemePreference(requested as ThemePreference);
function Gallery() {
	const [dialog, setDialog] = useState<"generic" | "project" | "delete">();
	const [popover, setPopover] = useState(false);
	const [segment, setSegment] = useState("all");
	const [submits, setSubmits] = useState(0);
	const [loading, setLoading] = useState(false);
	const [name, setName] = useState("");
	const anchor = useRef<HTMLButtonElement>(null);
	return <main className="gallery"><header><h1>Skiff 组件与目标样例</h1><ThemeToggle /></header><p>生产 token 与原语。Tab 检查 focus；悬停与按下检查 hover / pressed。所有数据是虚构测试数据。</p>
		<section><h2>Button · 28 / 32 / 36 px</h2><div className="gallery-row"><Button size="compact">紧凑</Button><Button>常规</Button><Button size="primary" variant="primary">主操作</Button><Button variant="ghost">次级操作</Button><Button variant="danger">危险操作</Button><Button aria-pressed="true">当前选择</Button><Button disabled>禁用</Button><Button loading>处理中</Button><Tooltip text="键盘聚焦可读说明"><IconButton aria-label="查看说明"><Icon name="info" size={16} /></IconButton></Tooltip></div></section>
		<section><h2>Field 与提交</h2><form onSubmit={(event) => { event.preventDefault(); if (!loading) { setLoading(true); setSubmits((count) => count + 1); window.setTimeout(() => setLoading(false), 1200); } }}><Field label="测试名称" value={name} onChange={(event) => setName(event.target.value)} hint="受控值与可访问标签" /><Field label="错误示例" error="请填写路径" aria-label="错误示例" /><div className="gallery-row"><Button>非提交按钮</Button><Button type="submit" loading={loading}>提交</Button><output aria-label="提交计数">提交 {submits} 次</output></div></form></section>
		<section><h2>Card / ListRow / Chip / SegmentedControl</h2><Card selected className="gallery-card"><strong>deepseek-chat · 当前选择</strong><p>默认线路：官方直连 · 扣费账户：wallet-a</p><p>CNY · 输入 ¥0.3 · 输出 ¥1.2 / 每百万 token</p><Chip tone="success">可用</Chip><Chip tone="warning">需选择线路</Chip><Chip tone="danger">请求失败</Chip></Card><ListRow onClick={() => setDialog("generic")}>列表行 · 打开详情</ListRow><SegmentedControl label="模型范围" value={segment} onChange={setSegment} options={[{ value: "recent", label: "最近使用" }, { value: "all", label: "全部模型" }]} /></section>
		<section><h2>Dialog / Popover</h2><div className="gallery-row"><Button onClick={() => setDialog("generic")}>打开弹层</Button><Button onClick={() => setDialog("project")}>添加项目</Button><Button onClick={() => setDialog("delete")}>删除确认</Button><Button ref={anchor} onClick={() => setPopover((open) => !open)}>打开浮层</Button></div>{popover && <Popover anchor={anchor} onClose={() => setPopover(false)} aria-label="浮层样例"><Field label="浮层搜索" autoFocus /><Button onClick={() => setPopover(false)}>关闭浮层</Button></Popover>}</section>
		<section><h2>正式页面目标布局</h2><p>复用生产页面和模拟 bridge，没有第二套选择逻辑。</p>{["launcher", "chat"].map((scene) => <div key={scene} className="gallery-row">{["light", "dark"].map((theme) => <a key={theme} href={`/tests/preview.html?fixture=${scene}&theme=${theme}&static=1`}>{scene} · {theme} · 使用视口 600/900/1200</a>)}</div>)}</section>
		<ComposerHarness />
		{dialog === "generic" && <Dialog aria-label="详情样例" onClose={() => setDialog(undefined)}><h2>详情样例</h2><Field label="详情输入" /><Button onClick={() => setDialog(undefined)}>关闭详情</Button></Dialog>}
		{dialog === "project" && <ProjectDialog onClose={() => setDialog(undefined)} onAdd={async () => { await new Promise((resolve) => window.setTimeout(resolve, 1500)); }} />}
		{dialog === "delete" && <ConfirmDialog title="删除测试项目" description="测试焦点默认在取消，确认计数只保存在此页面内。" onConfirm={() => setSubmits((count) => count + 1)} onClose={() => setDialog(undefined)} />}
	</main>;
}
ReactDOM.createRoot(document.getElementById("root")!).render(<Gallery />);
