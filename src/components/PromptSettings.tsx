import { useState } from "react";
import { loadAppendPrompt, saveAppendPrompt } from "../chat/prompt";
import { SystemPromptViewer } from "./SystemPromptViewer";
import { Button, TextArea } from "./ui";

export function PromptSettings({ sessionPath, onSaved, editRestricted }: { sessionPath?: string; onSaved: () => void; editRestricted?: string }) {
	const [text, setText] = useState(loadAppendPrompt);
	const save = () => { saveAppendPrompt(text); onSaved(); };
	return <div className="prompt-settings">
		<SystemPromptViewer key={sessionPath} sessionPath={sessionPath} />
		<fieldset className="settings-config prompt-edit" disabled={!!editRestricted} aria-labelledby="append-prompt-title">
			<section className="prompt-custom family-card" aria-labelledby="append-prompt-title">
				<h3 id="append-prompt-title">自定义附加指令</h3>
				<p className="muted">在上方系统指令末尾追加自定义提示词。</p>
				<TextArea id="append-prompt" aria-label="自定义附加指令" className="prompt-input" rows={5} value={text} onChange={(event) => setText(event.target.value)} placeholder="填写自定义指令，可留空。" spellCheck={false} />
			</section>
			<div className="prompt-hint"><span>Skiff 身份说明始终生效。清空仅移除自定义指令。</span><Button type="button" variant="ghost" size="compact" onClick={() => setText("")}>清空</Button></div>
			<div className="dialog-actions"><Button type="button" variant="primary" size="primary" onClick={save}>保存并重启</Button></div>
		</fieldset>
	</div>;
}
