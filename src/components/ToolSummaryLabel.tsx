/** Keep tool identifiers in diagnostics; the transcript presents actions and targets. */
export function ToolSummaryLabel({ label, target, single = false, settled = false }: { label: string; target?: string; single?: boolean; settled?: boolean }) {
	const actions = label.slice(label.indexOf(" · ") + 3);
	return <>
		<span className="tool-summary">
			{actions.split("；").map((action, index) => {
				const failure = action.match(/（[\d,]+ 失败）$/)?.[0];
				const parts = (failure ? action.slice(0, -failure.length) : action).match(/^(.*) (\d+) (.*)$/);
				if (!parts) return <span className="tool-action" key={index}>{action}</span>;
				const verb = parts[1].replace(/了$/, "").replace(/^(修改|写入)$/, "编辑");
				const tense = settled || parts[1].endsWith("了") ? "了" : "";
				const object = parts[3].replace(/^(个|条|次)/, "") || "内容";
				return <span className="tool-action" key={index}>{single ? verb === "联网搜索" ? verb : `${verb}${tense}${object}` : <>{verb}{tense} <span className="tool-count">{Number(parts[2]).toLocaleString("en-US")} {parts[3]}</span></>}{failure && <span className="tool-count">{failure}</span>}</span>;
			})}
		</span>
		{target && <span className="tool-target">{target}</span>}
	</>;
}
