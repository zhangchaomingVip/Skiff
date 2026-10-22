/** Reasoning is process material, visually separate from the assistant's answer. */
export function ThinkingContent({ text, showLabel = true }: { text: string; showLabel?: boolean }) {
	return <div className="thinking-note">{showLabel && <span className="thinking-note-label">思考</span>}<pre>{text || "正在整理思路…"}</pre></div>;
}
