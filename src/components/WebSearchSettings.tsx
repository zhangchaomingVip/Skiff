import { useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { WebSearchControls, WebSearchProvider } from "../chat/webSearch";
import { Button, Input, SegmentedControl } from "./ui";
import { Icon } from "./Icon";
import { CopyButton } from "./CopyButton";

const PROVIDER_COPY: Record<WebSearchProvider, { engine: string; key: string; readUrl: string }> = {
	tavily: {
		engine: "通用网页搜索，免费额度充足；限定 x.com 并配合时间范围可检索 X 原帖。",
		key: "在 tavily.com 免费注册即可获得。",
		readUrl: "直接读取链接正文，不必再搜索一遍；Tavily 走 Extract，每次实时抓取，计入 Tavily 额度。",
	},
	exa: {
		engine: "语义搜索，适合技术文档与观点类内容，按量计费；无法检索 X（Twitter）原帖。",
		key: "在 exa.ai 注册后在控制台创建 API Key。",
		readUrl: "直接读取链接正文，不必再搜索一遍；Exa 走 Contents，读缓存最快，按页计费约 $0.001。",
	},
};

type State = "ready" | "pending" | "error" | "missing" | "checking" | "idle";

/** Inline settings block for pi's `web_search` tool: toggles, engine/key and runtime health. */
export function WebSearchSettings({ search }: { search: WebSearchControls }) {
	const [apiKey, setApiKey] = useState("");
	const [error, setError] = useState<string>();
	const [pending, setPending] = useState(false);
	const isExa = search.provider === "exa";
	const providerLabel = isExa ? "Exa" : "Tavily";
	const copy = PROVIDER_COPY[search.provider];

	const save = async (event: FormEvent) => {
		event.preventDefault();
		if (pending) return;
		setPending(true);
		setError(undefined);
		try {
			await invoke("save_web_search_key", { provider: search.provider, apiKey });
			setApiKey("");
			// 保存（新填或替换）Key 是唯一会自动调用引擎校验的入口，会消耗额度。
			await search.verify();
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

	const active = search.available && search.configured && search.validated !== false && search.enabled;
	const togglePending = search.busy || search.validating;
	const editable = !pending && !search.busy;

	const keyState = !search.statusLoaded
		? "正在读取配置…"
		: search.validating
			? `正在验证 ${providerLabel} 密钥…`
			: !search.configured
				? "尚未配置密钥"
				: search.validated === true
					? "密钥验证通过"
					: search.validated === false
						? "密钥验证失败"
						: `密钥已保存${search.keyHint ? ` · ${search.keyHint}` : ""}`;
	const keyTone: State = !search.statusLoaded ? "checking" : search.validating ? "checking" : !search.configured ? "missing" : search.validated === true ? "ready" : search.validated === false ? "error" : "pending";
	const extensionState: { tone: State; label: string } = search.available
		? { tone: "ready", label: "扩展已载入" }
		: search.extensionInstalled
			? { tone: "pending", label: "扩展待重载" }
			: { tone: "missing", label: "扩展未安装" };
	const serviceState: { tone: State; label: string } = !search.statusLoaded
		? { tone: "checking", label: "正在读取配置" }
		: search.validating
			? { tone: "checking", label: "正在验证" }
			: !search.configured
				? { tone: "missing", label: "服务未配置" }
				: search.validated === true
					? { tone: "ready", label: "服务连通" }
					: search.validated === false
						? { tone: "error", label: "验证失败" }
						: { tone: "pending", label: "待验证" };
	const sessionState: { tone: State; label: string } = active
		? { tone: "ready", label: "当前会话已生效" }
		: search.enabled
			? { tone: "pending", label: "当前会话未生效" }
			: { tone: "idle", label: "当前会话已关闭" };

	return <div className="web-search-settings">
		<div className="settings-group">
			<div className="settings-row">
				<div className="settings-row-text">
					<label className="settings-row-title" htmlFor="web-search-enabled">联网搜索</label>
					<span className="settings-row-hint">允许模型在回答中调用 web_search 检索网页。</span>
				</div>
				<label className="switch" title={active ? "关闭联网搜索" : "开启联网搜索"}>
					<input id="web-search-enabled" type="checkbox" checked={active} disabled={!search.statusLoaded || togglePending} onChange={(event) => void search.toggle(event.target.checked)} />
					<span className="slider" />
				</label>
			</div>
			<div className="settings-row">
				<div className="settings-row-text">
					<label className="settings-row-title" htmlFor="web-search-read-url">读取网页（read_url）</label>
					<span className="settings-row-hint">{copy.readUrl}</span>
				</div>
				<label className="switch" title={search.readUrlEnabled ? "关闭读取网页" : "开启读取网页"}>
					<input id="web-search-read-url" type="checkbox" checked={search.readUrlEnabled} disabled={!search.statusLoaded || togglePending} onChange={(event) => void search.setReadUrl(event.target.checked)} />
					<span className="slider" />
				</label>
			</div>
		</div>
		<form className="web-search-form" onSubmit={(event) => void save(event)}>
			<div className="settings-group">
				<div className="settings-row">
					<div className="settings-row-text">
						<span className="settings-row-title">搜索引擎</span>
						<span className="settings-row-hint">{copy.engine}</span>
					</div>
					<SegmentedControl label="搜索引擎" value={search.provider} onChange={(value) => void search.setProvider(value)} disabled={!editable} options={[{ value: "tavily", label: "Tavily" }, { value: "exa", label: "Exa" }]} />
				</div>
				<div className="settings-row is-stacked">
					<div className="settings-row-text">
						<label className="settings-row-title" htmlFor="web-search-key">{providerLabel} API Key</label>
						<span className="settings-row-hint">{copy.key}</span>
					</div>
					<div className="web-search-key-row">
						<Input id="web-search-key" type="password" autoComplete="off" placeholder={search.configured ? "填写新的 Key 会替换已保存的值" : isExa ? "exa-…" : "tvly-…"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} disabled={pending} />
						{search.configured && <Button type="button" variant="ghost" size="compact" aria-label="测试已保存的 Key" onClick={() => void search.verify()} disabled={pending || search.validating}><Icon name="refresh" size={14} />{search.validated === undefined ? "测试" : "重新测试"}</Button>}
						{search.configured && <Button type="button" variant="ghost" size="compact" aria-label="清除已保存的 Key" onClick={() => void clear()} disabled={!editable}>清除</Button>}
						<span className="web-search-badge" data-state={keyTone} aria-live="polite"><span className="web-search-dot" aria-hidden="true" />{keyState}</span>
					</div>
					{search.validated === false && search.validationMessage && <p className="web-search-message" role="status">{search.validationMessage}</p>}
				</div>
			</div>
			<div className="settings-group">
				<div className="settings-row web-search-status-row">
					<div className="settings-row-text">
						<span className="settings-row-title">运行状态</span>
						<div className="web-search-status" aria-live="polite">
							<span className="web-search-chip" data-state={extensionState.tone}><span className="web-search-dot" aria-hidden="true" />{extensionState.label}</span>
							<span className="web-search-chip" data-state={serviceState.tone}><span className="web-search-dot" aria-hidden="true" />{serviceState.label}</span>
							<span className="web-search-chip" data-state={sessionState.tone}><span className="web-search-dot" aria-hidden="true" />{sessionState.label}</span>
						</div>
					</div>
					<div className="web-search-status-actions">
						<Button type="button" variant="ghost" size="compact" onClick={() => void search.refresh()} disabled={!editable || search.validating}>刷新状态</Button>
						<Button type="button" variant="ghost" size="compact" onClick={() => void search.install()} disabled={!editable}>{search.busy ? "处理中…" : search.available ? "更新扩展" : search.extensionInstalled ? "重新加载扩展" : "安装扩展"}</Button>
					</div>
				</div>
				{search.agentDir && <div className="settings-row">
					<div className="settings-row-text">
						<span className="settings-row-title">配置目录</span>
						<code className="web-search-path">{search.agentDir}</code>
					</div>
					<CopyButton text={search.agentDir} label="复制配置目录" iconOnly />
				</div>}
			</div>
			{(error || search.error) && <p className="form-error" role="alert">{error || search.error}</p>}
			<div className="web-search-footer">
				<Button type="submit" variant="primary" size="primary" disabled={pending || !apiKey.trim()}>{pending ? "保存并验证中…" : "保存并验证"}</Button>
			</div>
		</form>
	</div>;
}
