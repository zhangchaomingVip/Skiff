import { useEffect, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "./Icon";

export interface ProviderInfo {
	name: string; baseUrl: string; hasKey: boolean; modelIds: string[];
	reasoning: boolean; vision: boolean; maxThinking: string; contextWindow: number; maxTokens: number;
}

const blank = (): ProviderInfo => ({ name: "", baseUrl: "", hasKey: false, modelIds: [], reasoning: false, vision: false, maxThinking: "high", contextWindow: 128000, maxTokens: 8192 });

export function ProviderDialog({ onSaved, onClose }: { onSaved: (provider: ProviderInfo) => void; onClose: () => void }) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const [providers, setProviders] = useState<ProviderInfo[]>([]);
	const [form, setForm] = useState<ProviderInfo>(blank);
	const [modelText, setModelText] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [error, setError] = useState<string>();
	const [pending, setPending] = useState(false);
	const [loading, setLoading] = useState(true);
	useEffect(() => {
		dialogRef.current?.showModal();
		void invoke<ProviderInfo[]>("list_openai_providers").then(setProviders).catch((e) => setError(String(e))).finally(() => setLoading(false));
	}, []);
	const patch = (value: Partial<ProviderInfo>) => setForm((current) => ({ ...current, ...value }));
	const discover = async () => {
		setPending(true); setError(undefined);
		try { const models = await invoke<string[]>("discover_openai_models", { baseUrl: form.baseUrl, apiKey }); setModelText(models.join("\n")); }
		catch (e) { setError(String(e)); } finally { setPending(false); }
	};
	const save = async (event: FormEvent) => {
		event.preventDefault(); if (pending) return;
		setPending(true); setError(undefined);
		try {
			const saved = await invoke<ProviderInfo>("save_openai_provider", { input: { ...form, apiKey, modelIds: modelText.split(/[\n,，]/).map((id) => id.trim()).filter(Boolean) } });
			onSaved(saved);
		} catch (e) { setError(String(e)); setPending(false); }
	};
	return <dialog ref={dialogRef} className="project-dialog provider-dialog" aria-labelledby="provider-title" onCancel={(event) => { if (pending) event.preventDefault(); else onClose(); }}>
		<form onSubmit={(event) => void save(event)}>
			<div className="dialog-heading"><h2 id="provider-title">配置提供商</h2><button type="button" className="icon-btn" onClick={onClose} disabled={pending} aria-label="关闭提供商设置"><Icon name="close" /></button></div>
			<p className="muted">连接 OpenAI 兼容接口，配置保存到本机 pi。</p>
			<label htmlFor="saved-provider">提供商</label><select id="saved-provider" disabled={pending || loading} value={providers.some((p) => p.name === form.name) ? form.name : ""} onChange={(event) => { const selected = providers.find((p) => p.name === event.target.value) ?? blank(); setForm(selected); setApiKey(""); setModelText(selected.modelIds.join("\n")); setError(undefined); }}><option value="">{loading ? "正在加载…" : "添加新提供商"}</option>{providers.map((provider) => <option key={provider.name} value={provider.name}>{provider.name}</option>)}</select>
			<div className="provider-field"><label htmlFor="provider-name">名称</label><input id="provider-name" required pattern="[A-Za-z0-9_-]+" maxLength={64} placeholder="my-gateway" value={form.name} onChange={(e) => patch({ name: e.target.value })} disabled={pending} /></div>
			<div className="provider-field"><label htmlFor="provider-base">Base URL</label><input id="provider-base" type="url" required placeholder="https://api.example.com/v1" value={form.baseUrl} onChange={(e) => patch({ baseUrl: e.target.value })} disabled={pending} /><small>填写 API 根地址，包含 /v1 等前缀；无需填写 /chat/completions。</small></div>
			<div className="provider-field"><label htmlFor="provider-key">API Key</label><input id="provider-key" type="password" autoComplete="off" required={!form.hasKey} placeholder={form.hasKey ? "已保存，留空保留原密钥" : "sk-…"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} disabled={pending} /></div>
			<div className="provider-field"><div className="field-heading"><label htmlFor="provider-models">模型 ID</label><button type="button" className="btn ghost compact" onClick={() => void discover()} disabled={pending || !form.baseUrl || !apiKey.trim()}>获取模型</button></div><textarea id="provider-models" rows={3} placeholder="可留空自动获取，或填写模型 ID，每行一个" value={modelText} onChange={(e) => setModelText(e.target.value)} disabled={pending} /></div>
			<div className="provider-capabilities"><label><input type="checkbox" checked={form.reasoning} onChange={(e) => patch({ reasoning: e.target.checked })} disabled={pending} />支持推理等级</label><label><input type="checkbox" checked={form.vision} onChange={(e) => patch({ vision: e.target.checked })} disabled={pending} />支持图片输入</label></div>
			<details className="provider-advanced"><summary>模型能力与限制</summary><p className="muted">按服务商声明填写，应用于以上模型；能力勾选不会让纯文本模型具备看图能力。</p><label htmlFor="provider-thinking">推理上限</label><select id="provider-thinking" value={form.maxThinking} onChange={(e) => patch({ maxThinking: e.target.value })} disabled={pending || !form.reasoning}><option value="high">high</option><option value="xhigh">xhigh</option><option value="max">max</option></select><div className="provider-limits"><label>上下文窗口<input type="number" min={1024} required value={form.contextWindow} onChange={(e) => patch({ contextWindow: Number(e.target.value) })} disabled={pending} /></label><label>最大输出 Token<input type="number" min={1} max={form.contextWindow} required value={form.maxTokens} onChange={(e) => patch({ maxTokens: Number(e.target.value) })} disabled={pending} /></label></div></details>
			{error && <p className="form-error" role="alert">{error}</p>}
			<div className="dialog-actions"><button type="button" className="btn ghost" onClick={onClose} disabled={pending}>取消</button><button className="btn primary" disabled={pending || loading}>{pending ? "正在连接…" : "保存并使用"}</button></div>
		</form>
	</dialog>;
}
