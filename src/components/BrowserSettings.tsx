import { useEffect, useState, type FormEvent } from "react";
import { browserNative, type BrowserDependencies } from "../browser/native";
import { Button, Input } from "./ui";
import { CopyButton } from "./CopyButton";

export function BrowserSettings({ onSaved }: { onSaved: () => void }) {
	const [status, setStatus] = useState<BrowserDependencies>();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const [cliPath, setCliPath] = useState("");
	const [configuredPath, setConfiguredPath] = useState("");
	const [revision, recheck] = useState(0);
	useEffect(() => {
		let disposed = false;
		setError(undefined);
		void browserNative.dependencies().then((value) => {
			if (disposed) return;
			setStatus(value);
			setCliPath(value.configuredCliPath ?? "");
			setConfiguredPath(value.configuredCliPath ?? "");
		}).catch((reason) => { if (!disposed) setError(String(reason)); });
		return () => { disposed = true; };
	}, [revision]);
	const savePath = async (event: FormEvent) => {
		event.preventDefault();
		if (pending) return;
		setPending(true); setError(undefined);
		try {
			setStatus(await browserNative.configure(cliPath.trim() || null));
			setConfiguredPath(cliPath.trim());
		} catch (reason) { setError(String(reason)); }
		finally { setPending(false); }
	};
	const toggle = async (enabled: boolean) => {
		if (pending) return;
		setPending(true);
		setError(undefined);
		try {
			setStatus(await browserNative.setEnabled(enabled));
			onSaved();
		} catch (reason) { setError(String(reason)); }
		finally { setPending(false); }
	};
	return <section className="settings-page" aria-labelledby="browser-title">
		<h2 id="browser-title">AI 浏览器</h2>
		<p className="muted">允许 AI 在当前聊天的独立浏览器中打开网页、点击和填写。第一次打开网页时才启动浏览器。</p>
		<div className="settings-group"><div className="settings-row">
			<div className="settings-row-text"><label className="settings-row-title" htmlFor="browser-enabled">启用 AI 浏览器</label><span id="browser-enabled-hint" className="settings-row-hint">保存后重新连接当前聊天；其他已有聊天在下次重新连接时生效。关闭后立即拒绝所有聊天的新浏览器操作。</span></div>
			<label className="switch"><input id="browser-enabled" type="checkbox" checked={status?.enabled ?? false} disabled={!status || pending} aria-describedby="browser-enabled-hint" onChange={(event) => void toggle(event.target.checked)} /><span className="slider" /></label>
		</div></div>
		<p className="muted" role="status">{status?.message ?? (error ? "无法读取浏览器设置" : "正在读取浏览器设置…")}</p>
		{status && <>
			<div className="browser-dependency-actions"><Button disabled={pending} onClick={() => recheck((value) => value + 1)}>重新检测依赖</Button></div>
			{!status.ready && <div className="browser-install-commands"><p className="muted">在终端运行以下命令，然后重新检测。</p>{status.installCommands.map((command) => <div key={command}><code>{command}</code><CopyButton text={command} label="复制安装命令" /></div>)}</div>}
			<form onSubmit={(event) => void savePath(event)} className="settings-group"><div className="settings-row is-stacked"><div className="settings-row-text"><label className="settings-row-title" htmlFor="browser-cli-path">自定义 agent-browser 路径</label><span id="browser-cli-path-hint" className="settings-row-hint">留空自动查找。修改路径前请先关闭所有运行中的托管浏览器。</span></div><Input id="browser-cli-path" value={cliPath} disabled={pending} placeholder={status.cliPath ?? "自动查找 agent-browser"} aria-describedby="browser-cli-path-hint" onChange={(event) => setCliPath(event.target.value)} /><Button type="submit" disabled={pending || configuredPath === cliPath.trim()} loading={pending}>保存路径</Button></div></form>
		</>}
		{error && <p role="alert">{error}</p>}
		{error && <Button disabled={pending} onClick={() => { setError(undefined); void browserNative.dependencies().then(setStatus).catch((reason) => setError(String(reason))); }}>重新读取</Button>}
	</section>;
}
