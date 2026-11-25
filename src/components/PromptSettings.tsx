import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { loadAppendPrompt, saveAppendPrompt } from "../chat/prompt";
import { Icon } from "./Icon";
import { Button, TextArea } from "./ui";

interface SystemPromptSection { name: string; text: string }

/** Human-friendly order for pi's system-prompt sections. */
const SECTION_ORDER = ["preamble", "tools", "rules", "docs", "project_context", "skills", "cwd", "addendum"];
const orderOf = (name: string) => { const index = SECTION_ORDER.indexOf(name); return index < 0 ? SECTION_ORDER.length : index; };

/** Edits the extra system prompt Skiff passes to pi, and shows pi's current assembled prompt. */
export function PromptSettings({ sessionPath, onSaved }: { sessionPath?: string; onSaved: () => void }) {
	const [text, setText] = useState(loadAppendPrompt);
	const [sections, setSections] = useState<SystemPromptSection[]>();
	const [viewerError, setViewerError] = useState<string>();
	const [loading, setLoading] = useState(false);
	const loadSystemPrompt = async () => {
		if (!sessionPath) { setSections(undefined); setViewerError("当前对话还没有 pi 会话文件。"); return; }
		setLoading(true); setViewerError(undefined);
		try {
			const result = await invoke<SystemPromptSection[]>("read_system_prompt", { sessionPath });
			setSections([...result].sort((a, b) => orderOf(a.name) - orderOf(b.name) || a.name.localeCompare(b.name)));
		} catch (error) { setViewerError(String(error)); }
		finally { setLoading(false); }
	};
	useEffect(() => { void loadSystemPrompt(); }, [sessionPath]);
	const save = () => { saveAppendPrompt(text); onSaved(); };
	return <div className="prompt-settings">
		<section className="prompt-system family-card" aria-labelledby="prompt-system-title">
			<div className="prompt-card-heading"><h3 id="prompt-system-title"><Icon name="file" size={15} />系统内置指令</h3><Button type="button" variant="ghost" size="compact" onClick={() => void loadSystemPrompt()} disabled={loading}>{loading ? "正在读取…" : "重新读取"}</Button></div>
			{viewerError && <p className="form-error" role="alert">{viewerError}</p>}
			{sections?.map((section) => <details key={section.name} className="prompt-section">
				<summary><span className="prompt-section-name provider-tag">{section.name}</span><span className="prompt-section-size">{section.text.length} 字</span></summary>
				<pre>{section.text}</pre>
			</details>)}
			{sections && sections.length === 0 && <p className="muted">当前会话没有可显示的系统提示词段落。</p>}
			{!sections && !loading && !viewerError && <p className="muted">系统提示词将在读取后显示。</p>}
		</section>
		<section className="prompt-custom family-card" aria-labelledby="append-prompt-title">
			<h3 id="append-prompt-title">自定义附加指令</h3>
			<p className="muted">在上方系统指令末尾追加自定义提示词。</p>
			<TextArea id="append-prompt" aria-label="自定义附加指令" className="prompt-input" rows={5} value={text} onChange={(event) => setText(event.target.value)} placeholder="填写自定义指令，可留空。" spellCheck={false} />
		</section>
		<div className="prompt-hint"><span>Skiff 身份说明始终生效。清空仅移除自定义指令。</span><Button type="button" variant="ghost" size="compact" onClick={() => setText("")}>清空</Button></div>
		<div className="dialog-actions"><Button type="button" variant="primary" size="primary" onClick={save}>保存并重启</Button></div>
	</div>;
}
