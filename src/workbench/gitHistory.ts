import { invoke } from "@tauri-apps/api/core";
import type { DiffPreview } from "./projectWorkbench";

export interface HistoryRef { name: string; label: string; kind: "local" | "remote" | "tag"; hash: string }
export interface HistoryCommit { hash: string; parents: string[]; author: string; email: string; date: string; subject: string }
export interface GitHistory { repositoryRoot: string; scope: string; branch: string; head?: string; refs: HistoryRef[]; commits: HistoryCommit[]; hasMore: boolean }
export interface CommitFile { path: string; oldPath?: string; status: string }
export interface CommitDetail { hash: string; parents: string[]; message: string; files: CommitFile[] }
export interface ProjectUpdate { repositoryRoot: string; branch: string; upstream: string; head: string; status: "updated" | "upToDate" | "ahead" | "diverged" }

export const readGitHistory = (root: string, reference: string, limit: number) => invoke<GitHistory>("get_project_git_history", { root, reference: reference || null, limit });
export const readGitCommit = (root: string, hash: string) => invoke<CommitDetail>("get_project_git_commit", { root, hash });
export const readCommitDiff = (root: string, hash: string, path: string) => invoke<DiffPreview>("get_project_git_commit_diff", { root, hash, path });
export const updateProject = (root: string) => invoke<ProjectUpdate>("update_project_from_remote", { root });

export interface GraphLine { from: number; to: number; start: 0 | 16; end: 16 | 32; color: number }
export interface GraphRow { hash: string; column: number; color: number; width: number; lines: GraphLine[] }

/** Track pending parent hashes, so merges and branch joins use actual ancestry. */
export function layoutCommitGraph(commits: Pick<HistoryCommit, "hash" | "parents">[]): GraphRow[] {
	let lanes: string[] = [];
	const colors = new Map<string, number>();
	let nextColor = 0;
	const color = (hash: string) => { if (!colors.has(hash)) colors.set(hash, nextColor++ % 5); return colors.get(hash)!; };
	return commits.map((commit) => {
		const incoming = lanes.includes(commit.hash);
		if (!incoming) lanes.push(commit.hash);
		const before = [...lanes];
		const column = before.indexOf(commit.hash);
		const nodeColor = color(commit.hash);
		lanes.splice(column, 1);
		const parents = [...new Set(commit.parents)];
		parents.forEach((parent, index) => {
			if (!lanes.includes(parent)) lanes.splice(Math.min(column + index, lanes.length), 0, parent);
			if (index === 0 && !colors.has(parent)) colors.set(parent, nodeColor);
		});
		const lines: GraphLine[] = before.flatMap((hash, from) => hash === commit.hash ? [] : [{ from, to: lanes.indexOf(hash), start: 0, end: 32, color: color(hash) }]);
		if (incoming) lines.push({ from: column, to: column, start: 0, end: 16, color: nodeColor });
		for (const parent of parents) lines.push({ from: column, to: lanes.indexOf(parent), start: 16, end: 32, color: color(parent) });
		return { hash: commit.hash, column, color: nodeColor, width: Math.max(before.length, lanes.length), lines };
	});
}
