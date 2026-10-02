function prettyArgs(argsText: string): string {
	if (!argsText.trim()) return "";
	try {
		return JSON.stringify(JSON.parse(argsText), null, 2);
	} catch {
		return argsText;
	}
}

/** Collapsible card for a single tool invocation streamed by pi. */
export function ToolCallBlock({
	name,
	argsText,
	done,
}: {
	name: string;
	argsText: string;
	done: boolean;
}) {
	const args = prettyArgs(argsText);
	return (
		<details className="tool">
			<summary>
				<span className="tool-name">{name}</span>
				<span className={`tool-state ${done ? "done" : "running"}`}>{done ? "已完成" : "执行中…"}</span>
			</summary>
			{args ? <pre className="tool-args">{args}</pre> : <div className="muted">无参数</div>}
		</details>
	);
}
