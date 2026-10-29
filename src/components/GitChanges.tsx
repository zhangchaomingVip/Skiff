import { useState } from "react";
import type { GitEntry } from "../workbench/projectWorkbench";
import { Icon } from "./Icon";
import { useFileContextMenu } from "./FileContextMenu";

const kindLabel: Record<GitEntry["kind"], string> = { modified: "M", added: "A", deleted: "D", renamed: "R", untracked: "U", conflict: "!" };
const retainedCollapsedGroups = new Map<string, string[]>();

export function GitChanges({ cacheKey, entries, selected, writing, onSelect, onOpen }: { cacheKey: string; entries: GitEntry[]; selected: string[]; writing: boolean; onSelect: (paths: string[]) => void; onOpen: (entry: GitEntry) => void }) {
	const [collapsed, setCollapsed] = useState<string[]>(() => retainedCollapsedGroups.get(cacheKey) ?? []);
	const openFileMenu = useFileContextMenu();
	const selectedPaths = new Set(selected);
	const groups = [
		{ id: "changes", label: "Changes", entries: entries.filter((entry) => entry.kind !== "untracked") },
		{ id: "unversioned", label: "Unversioned Files", entries: entries.filter((entry) => entry.kind === "untracked") },
	];
	const select = (paths: string[], checked: boolean) => {
		const next = new Set(selected);
		for (const path of paths) { if (checked) next.add(path); else next.delete(path); }
		onSelect([...next]);
	};
	return <div className="git-changes">
		{groups.filter((group) => group.entries.length).map((group) => {
			const selectable = group.entries.filter((entry) => entry.selectable).map((entry) => entry.path);
			const count = selectable.filter((path) => selectedPaths.has(path)).length;
			const all = selectable.length > 0 && count === selectable.length;
			const mixed = count > 0 && !all;
			return <details key={group.id} className="git-change-group" aria-label={group.label} open={!collapsed.includes(group.id)} onToggle={(event) => {
				const open = event.currentTarget.open;
				setCollapsed((current) => {
					if (current.includes(group.id) === !open) return current;
					const next = open ? current.filter((id) => id !== group.id) : [...current, group.id];
					retainedCollapsedGroups.set(cacheKey, next);
					return next;
				});
			}}>
				<summary className="git-group-heading"><Icon name="chevron" size={16} />
					<input type="checkbox" aria-label={`选择全部 ${group.label}`} aria-checked={mixed ? "mixed" : all} checked={all} ref={(node) => { if (node) node.indeterminate = mixed; }} disabled={writing || !selectable.length} onClick={(event) => event.stopPropagation()} onChange={(event) => select(selectable, event.target.checked)} />
					<strong>{group.label}</strong><small>{group.entries.length} {group.entries.length === 1 ? "file" : "files"}</small>
				</summary>
				{group.entries.map((entry) => {
					const path = entry.path.replaceAll("\\", "/");
					const separator = path.lastIndexOf("/");
					const name = path.slice(separator + 1);
					const directory = separator >= 0 ? path.slice(0, separator) : ".";
					return <div key={`${entry.path}:${entry.oldPath ?? ""}`} className="git-change-row" onContextMenu={(event) => openFileMenu(event, entry.path)}>
						<input type="checkbox" aria-label={`选择 ${entry.path}`} checked={selectedPaths.has(entry.path)} disabled={!entry.selectable || writing} onChange={(event) => select([entry.path], event.target.checked)} />
						<button className="git-file" data-kind={entry.kind} aria-label={`查看 Diff：${entry.path}`} title={entry.oldPath ? `${entry.oldPath} → ${entry.path}` : entry.path} onClick={() => onOpen(entry)}><span className={`git-kind ${entry.kind}`}>{kindLabel[entry.kind]}</span><span title={name}>{name}</span><small title={directory}>{directory}</small></button>
					</div>;
				})}
			</details>;
		})}
		{!entries.length && <div className="workbench-empty">工作区没有变更</div>}
	</div>;
}
