import { useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { WebSearchControls, WebSearchProvider } from "../chat/webSearch";
import { Button, IconButton, Input, SegmentedControl } from "./ui";
import { Icon } from "./Icon";

const PROVIDERS: WebSearchProvider[] = ["tavily", "exa"];

const PROVIDER_COPY: Record<WebSearchProvider, { label: string; tagline: string; keyUrl: string; placeholder: string }> = {
	tavily: {
		label: "Tavily",
		tagline: "通用检索",
		keyUrl: "https://app.tavily.com",
		placeholder: "tvly-…",
	},
	exa: {
		label: "Exa",
		tagline: "语义检索",
		keyUrl: "https://dashboard.exa.ai/api-keys",
		placeholder: "exa-…",
	},
};

const engineOptions = PROVIDERS.map((value) => {
	const { label, tagline } = PROVIDER_COPY[value];
	return { value, label: `${label} · ${tagline}` };
});

export function WebSearchSettings({ search }: { search: WebSearchControls }) {
	const [apiKey, setApiKey] = useState("");
	const [error, setError] = useState<string>();
	const [pending, setPending] = useState(false);
	// A saved key starts read-only; editing reveals an empty field for a replacement.
	const [editing, setEditing] = useState(false);
	const { label, keyUrl, placeholder } = PROVIDER_COPY[search.provider];
	const editingKey = editing || !search.configured;
	const showConfiguration = search.enabled || !search.configured;
	const active = search.available && search.configured && search.validated !== false && search.enabled;
	const editable = !pending && !search.busy && !search.validating;

	const save = async (event: FormEvent) => {
		event.preventDefault();
		if (!editable || !apiKey.trim()) return;
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
		if (!editable) return;
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
	const switchProvider = (value: WebSearchProvider) => {
		if (value === search.provider) return;
		cancelEdit();
		void search.setProvider(value);
	};
	const editKey = () => { if (!editingKey && editable) setEditing(true); };

	// 已保存的 Key 只以掩码示人，尾号来自 Rust 返回的 hint（`…6d93`）。
	const maskedKey = `${"•".repeat(12)}${(search.keyHint ?? "").replace(/^…/, "")}`;
	const diagnosis = !search.available
		? search.extensionInstalled
			? { tone: "pending", label: "扩展待重载" }
			: { tone: "missing", label: "扩展未安装" }
		: search.enabled && !active
			? { tone: "pending", label: "当前对话未生效" }
			: { tone: "ready", label: "运行正常" };

	return <div className="web-search-settings">
		<div className="settings-group">
			<div className="settings-row">
				<h2 id="websearch-title" className="settings-row-title">联网搜索</h2>
				<div className="web-search-toggle">
					<span role="status">
						{search.statusLoaded && <span className="web-search-chip" data-state={diagnosis.tone}><span className="web-search-dot" aria-hidden="true" />{diagnosis.label}</span>}
					</span>
					<label className="switch" title={active ? "关闭联网搜索" : "开启联网搜索"}>
						<input id="web-search-enabled" type="checkbox" aria-labelledby="websearch-title" checked={active} disabled={!search.statusLoaded || !editable} onChange={(event) => void search.toggle(event.target.checked)} />
						<span className="slider" />
					</label>
				</div>
			</div>
			{search.statusLoaded && diagnosis.tone !== "ready" && <div className="settings-row web-search-repair">
				<Button variant="ghost" size="compact" loading={search.busy} disabled={!editable} onClick={() => void search.install()}>
					{search.busy ? "处理中…" : search.extensionInstalled || search.available ? "重新加载扩展" : "安装扩展"}
				</Button>
			</div>}
		</div>
		{showConfiguration && <form className="web-search-form" onSubmit={(event) => void save(event)}>
			<div className="settings-group">
				<div className="settings-row web-search-engine">
					<span className="settings-row-title">搜索引擎</span>
					<SegmentedControl label="搜索引擎" value={search.provider} options={engineOptions} onChange={switchProvider} disabled={!editable} />
				</div>
				<div className="settings-row is-stacked web-search-key">
					<div className="web-search-key-heading">
						<label className="settings-row-title" htmlFor="web-search-key">{label} API Key</label>
						<a href={keyUrl} target="_blank" rel="noreferrer">获取 Key（含免费额度）↗</a>
					</div>
					<div className="web-search-key-row">
						<div className="web-search-key-field">
							<Input id="web-search-key" type={editingKey ? "password" : "text"} autoComplete="off"
								className={editingKey ? undefined : "web-search-key-masked"} placeholder={placeholder}
								readOnly={!editingKey} value={editingKey ? apiKey : maskedKey} disabled={!editable}
								onFocus={editKey} onClick={editKey} onChange={(event) => setApiKey(event.target.value)} />
							{!editingKey && <IconButton className="web-search-key-clear" variant="ghost" size="compact"
								aria-label="清除已保存的 Key" onClick={() => void clear()} disabled={!editable}><Icon name="close" size={14} /></IconButton>}
						</div>
						{editingKey
							? <>
								<Button type="submit" variant="primary" size="compact" loading={pending} disabled={!editable || !apiKey.trim()}>{pending ? "保存中…" : "保存"}</Button>
								{search.configured && <Button variant="ghost" size="compact" onClick={cancelEdit} disabled={!editable}>取消</Button>}
							</>
							: <Button variant="secondary" size="compact" aria-label="测试已保存的 Key"
								onClick={() => void search.verify()} loading={search.validating} disabled={!editable}>{search.validating ? "测试中…" : "测试"}</Button>
						}
					</div>
					{!editingKey && search.validated !== undefined && <p className="web-search-message" data-state={search.validated ? "ready" : "error"} role="status">
						{search.validated ? "✓ 有效" : `✗ ${search.validationMessage ?? "验证失败"}`}
					</p>}
				</div>
			</div>
		</form>}
		{(error || search.error) && <p className="form-error" role="alert">{error || search.error}</p>}
	</div>;
}
