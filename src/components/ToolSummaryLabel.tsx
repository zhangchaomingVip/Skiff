import { useContext } from "react";
import { ProjectChangesNavigationContext } from "../workbench/projectChangesNavigation";
import { projectRelativePath } from "../workbench/projectWorkbench";

/** Keep tool identifiers in diagnostics; the transcript presents actions and targets. */
export function ToolSummaryLabel({ label, target, targetKind, plain = false }: { label: string; target?: string; targetKind?: "file" | "command"; plain?: boolean }) {
	const navigation = useContext(ProjectChangesNavigationContext);
	const actions = plain ? label : label.slice(label.indexOf(" · ") + 3);
	const preview = targetKind === "command" ? target?.replace(/\s+/g, " ").trim() : target;
	const path = targetKind === "file" && target ? (navigation ? projectRelativePath(navigation.root, target) : undefined) ?? target : undefined;
	const separator = path ? Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1 : 0;
	return <>
		<span className="tool-summary">
			{plain ? label : actions.split("；").map((action, index) => {
				const failure = action.match(/（[\d,]+ 失败）$/)?.[0];
				const parts = (failure ? action.slice(0, -failure.length) : action).match(/^(.*) (\d+) (.*)$/);
				if (!parts) return <span className="tool-action" key={index}>{action}</span>;
				return <span className="tool-action" key={index}>{parts[1]} <span className="tool-count">{Number(parts[2]).toLocaleString("en-US")} {parts[3]}</span>{failure && <span className="tool-count">{failure}</span>}</span>;
			})}
		</span>
		{preview && preview !== label.replace(/\s+/g, " ").trim() && <span className={`tool-target${path ? " tool-target-file" : targetKind === "command" ? " tool-command-preview" : ""}`} title={target}>
			{path ? <><span className="tool-target-directory">{path.slice(0, separator)}</span><span className="tool-target-basename">{path.slice(separator)}</span></> : preview}
		</span>}
	</>;
}
