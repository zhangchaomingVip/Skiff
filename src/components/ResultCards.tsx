import { Icon } from "./Icon";
import { useContext, useId, useState } from "react";
import { Button } from "./ui";
import { ProjectChangesNavigationContext } from "../workbench/projectChangesNavigation";
import type { FileOp } from "../chat/turnResults";
import { projectRelativePath } from "../workbench/projectWorkbench";

const OP_LABEL: Record<FileOp["op"], string> = { create: "已创建", edit: "已编辑", delete: "已删除" };

function DiffCount({ op }: { op: Pick<FileOp, "additions" | "removals"> }) {
	if (op.additions === undefined && op.removals === undefined) return null;
	return <span className="result-card-diff">
		{op.additions !== undefined && <span className="added" aria-label={`新增 ${op.additions.toLocaleString("en-US")} 行`}>+{op.additions.toLocaleString("en-US")}</span>}
		{op.removals !== undefined && <span className="removed" aria-label={`删除 ${op.removals.toLocaleString("en-US")} 行`}>-{op.removals.toLocaleString("en-US")}</span>}
	</span>;
}

/** Show each full path, with the directory quieter than the file name. */
function FileRow({ op }: { op: FileOp }) {
	const navigation = useContext(ProjectChangesNavigationContext);
	const path = navigation && op.op !== "delete" ? projectRelativePath(navigation.root, op.path) : undefined;
	const separator = Math.max(op.path.lastIndexOf("/"), op.path.lastIndexOf("\\")) + 1;
	const name = <><span className="result-card-directory">{op.path.slice(0, separator)}</span>{op.path.slice(separator)}</>;
	return <li className="result-card-item">
		{navigation && path !== undefined ? <button className="result-card-path result-card-file" title={op.path} aria-label={`打开文件：${op.path}`} onClick={() => navigation.onOpenFile(path)}>{name}</button> : <span className="result-card-path" title={op.path}><span className="sr-only">{OP_LABEL[op.op]} </span>{name}</span>}
		<DiffCount op={op} />
	</li>;
}

function GroupCard({ label, ops }: { label: string; ops: FileOp[] }) {
	const navigation = useContext(ProjectChangesNavigationContext);
	const [expanded, setExpanded] = useState(false);
	const listId = useId();
	const single = ops.length === 1 ? ops[0] : undefined;
	const path = single && navigation && single.op !== "delete" ? projectRelativePath(navigation.root, single.path) : undefined;
	const title = single ? `${OP_LABEL[single.op]} ${single.path.slice(Math.max(single.path.lastIndexOf("/"), single.path.lastIndexOf("\\")) + 1)}` : label;
	const visibleOps = expanded ? ops : ops.slice(0, 3);
	const deleted = ops[0].op === "delete";
	const totals = ops.reduce((sum, op) => ({
		additions: op.additions === undefined ? sum.additions : (sum.additions ?? 0) + op.additions,
		removals: op.removals === undefined ? sum.removals : (sum.removals ?? 0) + op.removals,
	}), {} as Pick<FileOp, "additions" | "removals">);
	return <section className="result-card" aria-label={title}>
		<div className="result-card-head">
			<span className={`result-card-icon${deleted ? " is-delete" : ""}`}><Icon name={deleted ? "trash" : "fileChanges"} size={24} /></span>
			<span className="result-card-main">
				{single && navigation && path !== undefined ? <button className="result-card-title result-card-file" title={single.path} aria-label={`打开文件：${single.path}`} onClick={() => navigation.onOpenFile(path)}>{title}</button> : <span className="result-card-title" title={single?.path}>{title}</span>}
				<DiffCount op={totals} />
			</span>
			{navigation && <Button size="compact" className="result-card-view" onClick={() => navigation.onOpen()}>{navigation.label}</Button>}
		</div>
		{!single && <ul id={listId} className="result-card-list">{visibleOps.map((op) => <FileRow key={op.path} op={op} />)}</ul>}
		{ops.length > 3 && <button type="button" className="result-card-more" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded((value) => !value)}>{expanded ? "收起" : `再显示 ${ops.length - 3} 个文件`}<Icon name="chevron" size={14} /></button>}
	</section>;
}

/** Structured task outcome after the final body; plain answers render nothing. */
export function ResultCards({ ops }: { ops: FileOp[] }) {
	if (!ops.length) return null;
	const deletions = ops.filter((op) => op.op === "delete");
	const changes = ops.filter((op) => op.op !== "delete");
	const changeLabel = changes.every((op) => op.op === "create") ? "已创建" : changes.every((op) => op.op === "edit") ? "已编辑" : "已修改";
	return <div className="result-cards">
		{changes.length > 0 && <GroupCard label={`${changeLabel} ${changes.length.toLocaleString("en-US")} 个文件`} ops={changes} />}
		{deletions.length > 0 && <GroupCard label={`已删除 ${deletions.length.toLocaleString("en-US")} 个文件`} ops={deletions} />}
	</div>;
}
