import { Dialog, IconButton, TextArea, Button } from "./ui";
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_APPEND_PROMPT, loadAppendPrompt, saveAppendPrompt } from "../chat/prompt";
import { Icon } from "./Icon";

interface SystemPromptSection { name: string; text: string }

/** Human-friendly order for pi's system-prompt sections. */
const SECTION_ORDER = ["preamble", "tools", "rules", "docs", "project_context", "skills", "cwd", "addendum"];
const orderOf = (name: string) => { const index = SECTION_ORDER.indexOf(name); return index < 0 ? SECTION_ORDER.length : index; };

/** Edits the extra system prompt Skiff passes to pi, and shows pi's current assembled prompt. */
export function PromptDialog({ sessionPath, onSaved, onClose }: { sessionPath?: string; onSaved: () => void; onClose: () => void }) {
	const [text, setText] = useState(loadAppendPrompt);
	const [sections, setSections] = useState<SystemPromptSection[]>();
	const [viewerError, setViewerError] = useState<string>();
	const [loading, setLoading] = useState(false);
	const loadSystemPrompt = async () => {
		if (!sessionPath) { setViewerError("当前聊天还没有 pi 会话文件。"); return; }
		setLoading(true); setViewerError(undefined);
		try {
			const result = await invoke<SystemPromptSection[]>("read_system_prompt", { sessionPath });
			setSections([...result].sort((a, b) => orderOf(a.name) - orderOf(b.name) || a.name.localeCompare(b.name)));
		} catch (error) { setViewerError(String(error)); }
		finally { setLoading(false); }
	};
	const save = () => { saveAppendPrompt(text); onSaved(); };
	return <Dialog onClose={onClose}  className="project-dialog prompt-dialog" aria-labelledby="prompt-dialog-title" >
		<div className="dialog-heading"><h2 id="prompt-dialog-title">系统提示词</h2><IconButton type="button"  onClick={onClose} aria-label="关闭提示词设置"><Icon name="close" /></IconButton></div>
		<p className="muted">附加到 pi 系统提示词末尾（--append-system-prompt），随每次会话启动生效。保存后当前会话会重启。</p>
		<label htmlFor="append-prompt">附加指令</label>
		<TextArea id="append-prompt" className="prompt-input" rows={8} value={text} onChange={(event) => setText(event.target.value)} placeholder="例如：每次调用工具前先用一句话说明你要做什么。" spellCheck={false} />
		<div className="prompt-hint"><span>默认指令会让模型像 Codex 一样在工具前先说一句旁白。</span><Button type="button" variant="ghost" size="compact" onClick={() => setText(DEFAULT_APPEND_PROMPT)}>恢复默认</Button></div>

		<details className="prompt-system" onToggle={(event) => { if ((event.target as HTMLDetailsElement).open && !sections) void loadSystemPrompt(); }}>
			<summary><Icon name="file" size={13} />查看 pi 当前系统提示词（只读）</summary>
			{loading && <p className="muted">正在读取…</p>}
			{viewerError && <p className="form-error" role="alert">{viewerError}</p>}
			{sections && sections.map((section) => <details key={section.name} className="prompt-section">
				<summary><span className="prompt-section-name">{section.name}</span><span className="prompt-section-size">{section.text.length} 字</span></summary>
				<pre>{section.text}</pre>
			</details>)}
		</details>

		<div className="dialog-actions"><Button type="button" variant="ghost" onClick={onClose}>取消</Button><Button type="button" variant="primary" size="primary" onClick={save}>保存并重启</Button></div>
	</Dialog>;
}
