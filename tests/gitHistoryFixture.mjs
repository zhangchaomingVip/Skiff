const hash = (n) => n.toString(16).padEnd(40, "ab4176d9").slice(0, 40);
const subjects = ["feat: 合并项目工作台与主题更新", "feat: Git Tree 提交历史浏览", "feat: 添加四套应用主题色", "fix: 保留项目切换后的文件预览", "优化一些细碎的视觉因素", "调整整体风格", "活动栏设计", "优化项目侧栏", "优化设置样式", "增加联网工具和 HTML 读取工具", "调整视觉效果", "主页布局修改需求", "初始项目结构"];
const commits = subjects.map((subject, index) => ({ hash: hash(200 - index), parents: index === 0 ? [hash(199), hash(198)] : index === 1 ? [hash(197)] : index === subjects.length - 1 ? [] : [hash(199 - index)], subject, author: "zhangchaoming", email: "developer@example.invalid", date: `2026-10-${String(29 - Math.floor(index / 2)).padStart(2, "0")}T10:30:00+08:00` }));
const refs = [
	{ name: "refs/heads/main", label: "main", kind: "local", hash: hash(200) },
	{ name: "refs/heads/feature/git-tree", label: "feature/git-tree", kind: "local", hash: hash(199) },
	{ name: "refs/heads/feature/themes", label: "feature/themes", kind: "local", hash: hash(198) },
	{ name: "refs/remotes/origin/main", label: "origin/main", kind: "remote", hash: hash(200) },
	{ name: "refs/tags/v0.1.0", label: "v0.1.0", kind: "tag", hash: hash(193) },
];
export function gitHistoryFixture(command, args) {
	if (command === "update_project_from_remote") return { repositoryRoot: args.root, branch: "main", upstream: "origin/main", head: hash(200), status: "upToDate" };
	if (command === "get_project_git_history") {
		const start = args.reference && args.reference !== "HEAD" ? refs.find((ref) => ref.name === args.reference)?.hash : undefined;
		const selected = start ? commits.slice(commits.findIndex((commit) => commit.hash === start)) : commits;
		return { repositoryRoot: args.root, scope: "", branch: "main", head: hash(200), refs, commits: selected.slice(0, args.limit), hasMore: false };
	}
	if (command === "get_project_git_commit") {
		const commit = commits.find((item) => item.hash === args.hash);
		return { hash: args.hash, parents: commit?.parents ?? [], message: `${commit?.subject ?? "提交"}\n\n增加分支树、提交拓扑和历史文件预览。\n保持当前对话和工作区文件不变。`, files: [
			{ path: "src/components/GitTree.tsx", status: "A" }, { path: "src/components/git-tree.css", status: "A" }, { path: "src/App.tsx", status: "M" }, { path: "src-tauri/src/git_history.rs", status: "A" }, { path: "tests/gitHistory.test.ts", status: "A" },
		] };
	}
	if (command === "get_project_git_commit_diff") return { path: args.path, version: args.hash, kind: "text", truncated: false, content: `diff --git a/${args.path} b/${args.path}\n--- a/${args.path}\n+++ b/${args.path}\n@@ -1,2 +1,3 @@\n import { Icon } from "./Icon";\n+import { GitTreeWorkspace } from "./GitTree";\n` };
}
