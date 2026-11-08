import type { Project } from "../chat/workspace";
import { useProjectGitStatus } from "../workbench/useProjectGitStatus";
import { Icon } from "./Icon";

export function FileWorkspaceEmpty({ project, tool = "files" }: { project?: Project; tool?: "files" | "git" }) {
	const git = useProjectGitStatus(project);
	const kind = git.status ? "Git 项目" : git.local ? "本地项目" : undefined;
	const diff = tool === "git";
	return <section className="file-workspace-empty" aria-label="文件工作区">
		<div className="file-workspace-empty-icon" aria-hidden="true"><Icon name={diff ? "git" : "sailboat"} size={24} /></div>
		<h1>{project ? diff ? "查看变更对比" : "打开一个文件" : "选择一个项目"}</h1>
		<p>{project ? diff ? "从左侧点击变更文件，在这里查看 Diff 内容" : "从左侧选择文件，在这里查看内容" : "从左侧选择项目，再浏览文件"}</p>
		{project && <div className="file-workspace-project"><Icon name={git.status ? "git" : "folder"} size={14} /><span>{project.name}{kind && ` · ${kind}`}</span></div>}
	</section>;
}
