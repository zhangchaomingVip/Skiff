import { useEffect, useState, type FormEvent } from "react";
import { browserNative, type BrowserDependencies } from "../browser/native";
import { CopyButton } from "./CopyButton";
import { Icon } from "./Icon";
import { Button, Input } from "./ui";

type StatusTone = "ready" | "pending" | "error" | "missing" | "checking" | "idle";

export function BrowserSettings({ onSaved }: { onSaved: () => void }) {
	const [status, setStatus] = useState<BrowserDependencies>();
	const [checking, setChecking] = useState(true);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const [cliPath, setCliPath] = useState("");
	const [configuredPath, setConfiguredPath] = useState("");
	const [revision, recheck] = useState(0);

	useEffect(() => {
		let disposed = false;
		setChecking(true);
		setError(undefined);
		void browserNative.dependencies().then((value) => {
			if (disposed) return;
			setStatus(value);
			setCliPath(value.configuredCliPath ?? "");
			setConfiguredPath(value.configuredCliPath ?? "");
		}).catch((reason) => {
			if (!disposed) setError(String(reason));
		}).finally(() => {
			if (!disposed) setChecking(false);
		});
		return () => { disposed = true; };
	}, [revision]);

	const applyPath = async (nextPath: string | null) => {
		if (pending) return;
		setPending(true);
		setError(undefined);
		try {
			const updated = await browserNative.configure(nextPath);
			setStatus(updated);
			setCliPath(updated.configuredCliPath ?? "");
			setConfiguredPath(updated.configuredCliPath ?? "");
		} catch (reason) {
			setError(String(reason));
		} finally {
			setPending(false);
		}
	};

	const savePath = async (event: FormEvent) => {
		event.preventDefault();
		await applyPath(cliPath.trim() || null);
	};

	const toggle = async (enabled: boolean) => {
		if (pending) return;
		setPending(true);
		setError(undefined);
		try {
			setStatus(await browserNative.setEnabled(enabled));
			onSaved();
		} catch (reason) {
			setError(String(reason));
		} finally {
			setPending(false);
		}
	};

	const cliState: { tone: StatusTone; label: string } = checking && !status
		? { tone: "checking", label: "正在检测 CLI" }
		: !status
			? { tone: "error", label: "无法检测 CLI" }
			: status.cliPath
				? { tone: "ready", label: status.version ? `agent-browser ${status.version}` : "已找到 CLI" }
				: { tone: "missing", label: "未检测到 CLI" };

	const kernelState: { tone: StatusTone; label: string } = checking && !status
		? { tone: "checking", label: "正在检测内核" }
		: !status
			? { tone: "error", label: "内核状态未知" }
			: status.browserInstalled
				? { tone: "ready", label: "浏览器内核已安装" }
				: { tone: "missing", label: "未安装浏览器内核" };

	const capabilityState: { tone: StatusTone; label: string } = !status
		? { tone: checking ? "checking" : "error", label: checking ? "读取中" : "读取失败" }
		: !status.supported
			? { tone: "error", label: "当前平台不支持" }
			: status.ready && status.enabled
				? { tone: "ready", label: "已启用" }
				: status.ready
					? { tone: "idle", label: "未启用" }
					: { tone: "pending", label: "待安装依赖" };

	const pathDirty = configuredPath !== cliPath.trim();

	return <section className="settings-page browser-settings" aria-labelledby="browser-title">
		<h2 id="browser-title">AI 浏览器</h2>
		<p className="muted">AI 可在独立浏览器中打开网页、点击和填写。</p>

		<div className="settings-group">
			<div className="settings-row">
				<div className="settings-row-text">
					<label className="settings-row-title" htmlFor="browser-enabled">启用 AI 浏览器</label>
					<span id="browser-enabled-hint" className="settings-row-hint">保存后重新连接当前对话；其他已有对话在下次重新连接时生效。关闭后立即拒绝所有对话的新浏览器操作。</span>
				</div>
				<label className="switch" title={status?.enabled ? "关闭 AI 浏览器" : "启用 AI 浏览器"}>
					<input id="browser-enabled" type="checkbox" checked={status?.enabled ?? false} disabled={!status || pending} aria-describedby="browser-enabled-hint" onChange={(event) => void toggle(event.target.checked)} />
					<span className="slider" />
				</label>
			</div>
		</div>

		<div className="settings-group">
			<div className="settings-row web-search-status-row">
				<div className="settings-row-text">
					<span className="settings-row-title">运行状态</span>
					<div className="web-search-status" aria-live="polite">
						<span className="web-search-chip" data-state={cliState.tone}><span className="web-search-dot" aria-hidden="true" />{cliState.label}</span>
						<span className="web-search-chip" data-state={kernelState.tone}><span className="web-search-dot" aria-hidden="true" />{kernelState.label}</span>
						<span className="web-search-chip" data-state={capabilityState.tone}><span className="web-search-dot" aria-hidden="true" />{capabilityState.label}</span>
					</div>
					<span className="settings-row-hint" role="status">{status?.message ?? (error ? "无法读取浏览器设置" : "正在读取浏览器设置…")}</span>
				</div>
				<div className="web-search-status-actions">
					<Button type="button" variant="ghost" size="compact" disabled={pending || checking} onClick={() => recheck((value) => value + 1)}>
						<Icon name="refresh" size={14} />重新检测依赖
					</Button>
				</div>
			</div>

			{status?.cliPath && <div className="settings-row">
				<div className="settings-row-text">
					<span className="settings-row-title">当前可执行文件</span>
					<code className="web-search-path">{status.cliPath}</code>
				</div>
				<CopyButton text={status.cliPath} label="复制可执行文件路径" iconOnly />
			</div>}

			{status && !status.ready && status.installCommands.length > 0 && <div className="settings-row is-stacked">
				<div className="settings-row-text">
					<span className="settings-row-title">安装依赖</span>
					<span className="settings-row-hint">在终端运行以下命令，完成后点击上方「重新检测依赖」。</span>
				</div>
				<div className="browser-install-commands">
					{status.installCommands.map((command) => <div key={command}>
						<code>{command}</code>
						<CopyButton text={command} label="复制安装命令" iconOnly />
					</div>)}
				</div>
			</div>}
		</div>

		{status && <form onSubmit={(event) => void savePath(event)} className="settings-group">
			<div className="settings-row is-stacked">
				<div className="settings-row-text">
					<label className="settings-row-title" htmlFor="browser-cli-path">自定义 agent-browser 路径</label>
					<span id="browser-cli-path-hint" className="settings-row-hint">留空自动查找。修改路径前请先关闭所有运行中的托管浏览器。</span>
				</div>
				<div className="browser-path-row">
					<Input id="browser-cli-path" value={cliPath} disabled={pending} placeholder={status.cliPath ?? "自动查找 agent-browser"} aria-describedby="browser-cli-path-hint" onChange={(event) => setCliPath(event.target.value)} />
					<Button type="submit" variant={pathDirty ? "primary" : "secondary"} size="compact" disabled={pending || !pathDirty} loading={pending}>保存路径</Button>
					{configuredPath && !pathDirty && <Button type="button" variant="ghost" size="compact" disabled={pending} onClick={() => void applyPath(null)}>恢复自动</Button>}
				</div>
			</div>
		</form>}

		{error && <div className="browser-settings-error">
			<p className="form-error" role="alert">{error}</p>
			<Button type="button" variant="ghost" size="compact" disabled={pending || checking} onClick={() => recheck((value) => value + 1)}>重新读取</Button>
		</div>}
	</section>;
}
