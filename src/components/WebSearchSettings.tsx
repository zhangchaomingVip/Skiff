import { useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { WebSearchControls } from "../chat/webSearch";
import { Button, Input } from "./ui";
import { Icon } from "./Icon";

/** Inline settings block for pi's `web_search` tool: toggle, key and health. */
export function WebSearchSettings({ search }: { search: WebSearchControls }) {
	const [apiKey, setApiKey] = useState("");
	const [error, setError] = useState<string>();
	const [pending, setPending] = useState(false);

	const save = async (event: FormEvent) => {
		event.preventDefault();
		if (pending) return;
		setPending(true);
		setError(undefined);
		try {
			await invoke("save_web_search_key", { apiKey });
			setApiKey("");
			await search.refresh();
		} catch (e) {
			setError(String(e));
		} finally {
			setPending(false);
		}
	};

	const clear = async () => {
		if (pending) return;
		setPending(true);
		setError(undefined);
		try {
			await invoke("clear_web_search_key");
			setApiKey("");
			await search.refresh();
		} catch (e) {
			setError(String(e));
		} finally {
			setPending(false);
		}
	};

	const keyState = !search.statusLoaded
		? "正在读取配置…"
		: search.validating && search.configured
			? "正在验证 Tavily API Key…"
			: !search.configured
				? "尚未配置 Tavily API Key"
				: search.validated === true
					? "Tavily API Key 验证通过"
					: search.validated === false
						? "Tavily API Key 验证失败"
						: "Tavily API Key 尚未验证";
	const keyTone = !search.statusLoaded ? "checking" : search.validating ? "checking" : !search.configured ? "missing" : search.validated === true ? "ready" : search.validated === false ? "error" : "pending";
	const extensionState = search.available
		? "已载入当前 pi 会话"
		: search.extensionInstalled
			? "文件已安装，当前 pi 会话尚未加载"
			: "尚未安装 Skiff 联网搜索扩展";
	const active = search.available && search.configured && search.validated !== false && search.enabled;
	const togglePending = search.busy || search.validating;

	return <div className="web-search-settings">
		<div className="web-search-toggle-row">
			<label className="switch" title={active ? "关闭联网搜索" : "开启联网搜索"}>
				<input type="checkbox" checked={active} disabled={!search.statusLoaded || togglePending} onChange={(event) => void search.toggle(event.target.checked)} aria-label="联网搜索开关" />
				<span className="slider" />
			</label>
			<span>联网搜索</span>
		</div>
		<p className="muted">{active ? "开启后模型可以在回答中调用 web_search 工具检索网页。" : "开启后模型可以在回答中调用 web_search 工具检索网页；状态由配置与当前 pi 会话共同决定。"}</p>
		<form onSubmit={(event) => void save(event)} className="web-search-key-form">
			<div className="provider-field">
				<label htmlFor="web-search-key">Tavily API Key</label>
				<Input id="web-search-key" type="password" autoComplete="off" required placeholder={search.configured ? `已保存 ${search.keyHint ?? ""}，填写新的会替换` : "tvly-…"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} disabled={pending} />
				<small>在 tavily.com 免费注册即可获得。</small>
			</div>
			<div className="search-health" aria-live="polite">
				<div className="search-health-row" data-state={keyTone}>
					<span>Tavily API</span>
					<span>{keyState}</span>
				</div>
				<div className="search-health-row" data-state={search.available ? "ready" : search.extensionInstalled ? "pending" : "missing"}>
					<span>pi 扩展</span>
					<span>{extensionState}</span>
				</div>
				{search.validated === false && search.validationMessage && <p className="search-health-message" role="status">{search.validationMessage}</p>}
				{active && <p className="search-ready"><Icon name="check" size={15} />联网搜索配置完成</p>}
			</div>
			{search.agentDir && <p className="muted search-config-path">配置目录：{search.agentDir}</p>}
			{(error || search.error) && <p className="form-error" role="alert">{error || search.error}</p>}
			<div className="dialog-actions search-dialog-actions">
				<Button type="button" variant="ghost" size="compact" onClick={() => void search.install()} disabled={pending || search.busy}>
					{search.busy ? "处理中…" : search.available ? "更新扩展" : search.extensionInstalled ? "重新加载扩展" : "安装扩展"}
				</Button>
				{search.configured && <Button type="button" variant="ghost" size="compact" onClick={() => void search.refresh()} disabled={pending || search.validating}><Icon name="refresh" size={14} />重新验证</Button>}
				{search.configured && <Button type="button" variant="ghost" size="compact" onClick={() => void clear()} disabled={pending || search.busy}>删除已保存的 Key</Button>}
				<Button type="submit" variant="primary" size="primary" disabled={pending || !apiKey.trim()}>{pending ? "保存并验证中…" : "保存并验证"}</Button>
			</div>
		</form>
	</div>;
}
