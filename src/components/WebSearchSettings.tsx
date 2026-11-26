import { useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { WebSearchControls, WebSearchProvider } from "../chat/webSearch";
import { Button, Input, Select } from "./ui";
import { Icon } from "./Icon";

/** Picker order; add an engine here and in PROVIDER_COPY to offer it. */
const PROVIDERS: WebSearchProvider[] = ["tavily", "exa"];

const PROVIDER_COPY: Record<WebSearchProvider, { label: string; tagline: string; engine: string; key: string }> = {
	tavily: {
		label: "Tavily",
		tagline: "通用搜索，可检索 X 原帖",
		engine: "通用网页搜索，免费额度充足；限定 x.com 并配合时间范围可检索 X 原帖。",
		key: "在 tavily.com 免费注册即可获得。",
	},
	exa: {
		label: "Exa",
		tagline: "语义搜索，适合技术文档",
		engine: "语义搜索，适合技术文档与观点类内容，按量计费；无法检索 X（Twitter）原帖。",
		key: "在 exa.ai 注册后在控制台创建 API Key。",
	},
};

type State = "ready" | "pending" | "error" | "missing" | "checking" | "idle";

/**
 * Inline settings block for pi's `web_search` tool: one switch, the engine
 * picker with its key, and a folded diagnostics row. Reading pages (`read_url`)
 * has no switch: it follows web search and falls back to a local fetch.
 */
export function WebSearchSettings({ search }: { search: WebSearchControls }) {
	const [apiKey, setApiKey] = useState("");
	const [error, setError] = useState<string>();
	const [pending, setPending] = useState(false);
	// A saved key starts read-only; editing reveals an empty field for a replacement.
	const [editing, setEditing] = useState(false);
	const isExa = search.provider === "exa";
	const copy = PROVIDER_COPY[search.provider];
	const providerLabel = copy.label;
	const editingKey = editing || !search.configured;

	const save = async (event: FormEvent) => {
		event.preventDefault();
		if (pending) return;
		setPending(true);
		setError(undefined);
		try {
			await invoke("save_web_search_key", { provider: search.provider, apiKey });
			setApiKey("");
			setEditing(false);
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
			setEditing(false);
			await search.refresh();
		} catch (e) {
			setError(String(e));
		} finally {
			setPending(false);
		}
	};

	const cancelEdit = () => { setApiKey(""); setEditing(false); setError(undefined); };
	const switchProvider = (value: WebSearchProvider) => { cancelEdit(); void search.setProvider(value); };
	const optionLabel = (provider: WebSearchProvider) => {
		const { label, tagline } = PROVIDER_COPY[provider];
		const ready = search.configuredProviders.includes(provider) || (provider === search.provider && search.configured);
		return `${label}（${tagline}）${ready ? "" : " · 未配置 Key"}`;
	};

	const active = search.available && search.configured && search.validated !== false && search.enabled;
	const togglePending = search.busy || search.validating;
	const editable = !pending && !search.busy;

	const keyState = !search.statusLoaded
		? "正在读取配置"
		: search.validating
			? "正在验证"
			: search.validated === true
				? "验证通过"
				: search.validated === false
					? "验证失败"
					: "待验证";
	const keyTone: State = !search.statusLoaded ? "checking" : search.validating ? "checking" : search.validated === true ? "ready" : search.validated === false ? "error" : "pending";
	// 已保存的 Key 只以掩码示人，尾号来自 Rust 返回的 hint（`…6d93`）。
	const maskedKey = `${"•".repeat(12)}${(search.keyHint ?? "").replace(/^…/, "")}`;
	const extensionState: { tone: State; label: string } = search.available
		? { tone: "ready", label: "扩展已载入" }
		: search.extensionInstalled
			? { tone: "pending", label: "扩展待重载" }
			: { tone: "missing", label: "扩展未安装" };
	const sessionState: { tone: State; label: string } = active
		? { tone: "ready", label: "当前对话已生效" }
		: search.enabled
			? { tone: "pending", label: "当前对话未生效" }
			: { tone: "idle", label: "当前对话已关闭" };
	// The folded diagnostics row only surfaces the first thing that needs attention.
	const diagnosis = extensionState.tone !== "ready" ? extensionState : sessionState.tone === "pending" ? sessionState : { tone: "ready" as State, label: "运行正常" };

	return <div className="web-search-settings">
		<div className="settings-group">
			<div className="settings-row">
				<div className="settings-row-text">
					<label className="settings-row-title" htmlFor="web-search-enabled">联网搜索</label>
					<span className="settings-row-hint">允许模型在回答时检索网页，并读取链接正文。</span>
				</div>
				<label className="switch" title={active ? "关闭联网搜索" : "开启联网搜索"}>
					<input id="web-search-enabled" type="checkbox" checked={active} disabled={!search.statusLoaded || togglePending} onChange={(event) => void search.toggle(event.target.checked)} />
					<span className="slider" />
				</label>
			</div>
		</div>
		<form className="web-search-form" onSubmit={(event) => void save(event)}>
			<div className="settings-group">
				<div className="settings-row">
					<div className="settings-row-text">
						<label className="settings-row-title" htmlFor="web-search-engine">搜索引擎</label>
						<span className="settings-row-hint">{copy.engine}</span>
					</div>
					<Select id="web-search-engine" className="web-search-engine-select" value={search.provider} onChange={(event) => switchProvider(event.target.value as WebSearchProvider)} disabled={!editable}>
						{PROVIDERS.map((provider) => <option key={provider} value={provider}>{optionLabel(provider)}</option>)}
					</Select>
				</div>
				<div className="settings-row is-stacked">
					<div className="settings-row-text">
						<div className="web-search-key-heading">
							<label className="settings-row-title" htmlFor="web-search-key">{providerLabel} API Key</label>
							{!editingKey && <span className="web-search-badge" data-state={keyTone} aria-live="polite"><span className="web-search-dot" aria-hidden="true" />{keyState}</span>}
						</div>
						<span className="settings-row-hint">{copy.key}</span>
					</div>
					<div className="web-search-key-row">
						{editingKey
							? <>
								<Input id="web-search-key" type="password" autoComplete="off" placeholder={search.configured ? "输入新的 Key 以替换已保存的" : isExa ? "exa-…" : "tvly-…"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} disabled={pending} />
								{search.configured && <Button type="button" variant="ghost" size="compact" onClick={cancelEdit} disabled={pending}>取消</Button>}
							</>
							: <>
								<Input id="web-search-key" className="web-search-key-masked" readOnly value={maskedKey} aria-label={`${providerLabel} API Key 已保存`} />
								<Button type="button" variant="secondary" size="compact" aria-label="测试已保存的 Key" onClick={() => void search.verify()} disabled={pending || search.validating}><Icon name="refresh" size={14} />{search.validated === undefined ? "测试" : "重新测试"}</Button>
								<Button type="button" variant="ghost" size="compact" aria-label="修改已保存的 Key" onClick={() => setEditing(true)} disabled={!editable}><Icon name="edit" size={14} />修改</Button>
								<Button type="button" variant="ghost" size="compact" aria-label="清除已保存的 Key" onClick={() => void clear()} disabled={!editable}>清除</Button>
							</>
						}
					</div>
					{search.validated === false && search.validationMessage && <p className="web-search-message" role="status">{search.validationMessage}</p>}
				</div>
			</div>
			{(error || search.error) && <p className="form-error" role="alert">{error || search.error}</p>}
			{editingKey && <div className="web-search-footer">
				<Button type="submit" variant="primary" size="primary" disabled={pending || !apiKey.trim()}>{pending ? "保存并验证中…" : "保存并验证"}</Button>
			</div>}
		</form>
		<details className="settings-group web-search-diagnostics">
			<summary className="settings-row">
				<span className="settings-row-title"><span className="web-search-caret" aria-hidden="true" />诊断</span>
				<span className="web-search-chip" data-state={diagnosis.tone}><span className="web-search-dot" aria-hidden="true" />{diagnosis.label}</span>
			</summary>
			<div className="settings-row web-search-status-row">
				<div className="web-search-status" aria-live="polite">
					<span className="web-search-chip" data-state={extensionState.tone}><span className="web-search-dot" aria-hidden="true" />{extensionState.label}</span>
					<span className="web-search-chip" data-state={sessionState.tone}><span className="web-search-dot" aria-hidden="true" />{sessionState.label}</span>
				</div>
				<div className="web-search-status-actions">
					<Button type="button" variant="ghost" size="compact" onClick={() => void search.refresh()} disabled={!editable || search.validating}>刷新状态</Button>
					<Button type="button" variant="ghost" size="compact" onClick={() => void search.install()} disabled={!editable}>{search.busy ? "处理中…" : search.available ? "更新扩展" : search.extensionInstalled ? "重新加载扩展" : "安装扩展"}</Button>
				</div>
			</div>
		</details>
	</div>;
}
