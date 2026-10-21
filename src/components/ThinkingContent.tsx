/** Reasoning is process material, visually separate from the assistant's answer. */
export function ThinkingContent({ text }: { text: string }) {
	return <div className="thinking-note"><span className="thinking-note-label">过程记录</span><pre>{text || "正在整理思路…"}</pre></div>;
}
