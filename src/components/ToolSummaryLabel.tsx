/** Keep tool identifiers in diagnostics; the transcript presents actions and targets. */
export function ToolSummaryLabel({ label, target }: { label: string; target?: string }) {
	const actions = label.slice(label.indexOf(" · ") + 3);
	return <>
		<span className="tool-summary">
			{actions.split("；").map((action, index) => {
				const failure = action.match(/（[\d,]+ 失败）$/)?.[0];
				const parts = (failure ? action.slice(0, -failure.length) : action).match(/^(.*) (\d+) (.*)$/);
				if (!parts) return <span className="tool-action" key={index}>{action}</span>;
				return <span className="tool-action" key={index}>{parts[1]} <span className="tool-count">{Number(parts[2]).toLocaleString("en-US")} {parts[3]}</span>{failure && <span className="tool-count">{failure}</span>}</span>;
			})}
		</span>
		{target && <span className="tool-target">{target}</span>}
	</>;
}
