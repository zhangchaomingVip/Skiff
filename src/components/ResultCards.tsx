import type { IconName } from "./Icon";
import { Icon } from "./Icon";
import type { FileOp } from "../chat/turnResults";

const OP_LABEL: Record<FileOp["op"], string> = { create: "已创建", edit: "已编辑", delete: "已删除" };
const OP_ICON: Record<FileOp["op"], IconName> = { create: "file", edit: "edit", delete: "trash" };

function fileName(path: string): string {
	return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function dirName(path: string): string | undefined {
	const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	return index > 0 ? path.slice(0, index) : undefined;
}

function DiffCount({ op }: { op: FileOp }) {
	if (op.additions === undefined && op.removals === undefined) return null;
	return <span className="result-card-diff">
		{!!op.additions && <span className="added" aria-label={`新增 ${op.additions.toLocaleString("en-US")} 行`}>+{op.additions.toLocaleString("en-US")}</span>}
		{!!op.removals && <span className="removed" aria-label={`删除 ${op.removals.toLocaleString("en-US")} 行`}>-{op.removals.toLocaleString("en-US")}</span>}
	</span>;
}

function CardIcon({ op }: { op: FileOp }) {
	return <span className={`result-card-icon${op.op === "delete" ? " is-delete" : ""}`}><Icon name={OP_ICON[op.op]} size={16} /></span>;
}

/** Expanded rows show the full wrapped path; collapsed rows truncate with the value in the tooltip. */
function FileRow({ op }: { op: FileOp }) {
	return <div className="result-card-item">
		<CardIcon op={op} />
		<span className="result-card-title"><span className="result-card-op">{OP_LABEL[op.op]}</span><span className="result-card-path">{op.path}</span></span>
		<DiffCount op={op} />
	</div>;
}

function SingleCard({ op }: { op: FileOp }) {
	const dir = dirName(op.path);
	return <div className="result-card">
		<div className="result-card-head">
			<CardIcon op={op} />
			<span className="result-card-main">
				<span className="result-card-title">{OP_LABEL[op.op]} <span className="result-card-path" title={op.path}>{fileName(op.path)}</span></span>
				{dir && <span className="result-card-sub" title={op.path}>{dir}</span>}
			</span>
			<DiffCount op={op} />
		</div>
	</div>;
}

function GroupCard({ label, ops }: { label: string; ops: FileOp[] }) {
	const dirs = new Set(ops.map((op) => dirName(op.path) ?? ""));
	const totals = ops.reduce((sum, op) => ({ additions: (sum.additions ?? 0) + (op.additions ?? 0), removals: (sum.removals ?? 0) + (op.removals ?? 0) }), {} as { additions?: number; removals?: number });
	const hasDiff = ops.some((op) => op.additions !== undefined || op.removals !== undefined);
	return <details className="result-card">
		<summary className="result-card-head" aria-label={`${label}，展开查看清单`}>
			<CardIcon op={ops[0]} />
			<span className="result-card-main">
				<span className="result-card-title">{label}</span>
				{dirs.size === 1 && <span className="result-card-sub">{[...dirs][0]}</span>}
			</span>
			{hasDiff && (totals.additions || totals.removals) && <DiffCount op={{ ...ops[0], additions: totals.additions, removals: totals.removals }} />}
			<span className="result-card-chevron"><Icon name="chevron" size={14} /></span>
		</summary>
		<div className="result-card-list">{ops.map((op) => <FileRow key={op.path} op={op} />)}</div>
	</details>;
}

/** Structured task outcome after the final body; plain answers render nothing. */
export function ResultCards({ ops }: { ops: FileOp[] }) {
	if (!ops.length) return null;
	if (ops.length === 1) return <div className="result-cards"><SingleCard op={ops[0]} /></div>;
	const deletions = ops.filter((op) => op.op === "delete");
	const changes = ops.filter((op) => op.op !== "delete");
	return <div className="result-cards">
		{changes.length > 0 && <GroupCard label={`修改了 ${changes.length.toLocaleString("en-US")} 个文件`} ops={changes} />}
		{deletions.length > 0 && <GroupCard label={`删除了 ${deletions.length.toLocaleString("en-US")} 个文件`} ops={deletions} />}
	</div>;
}
