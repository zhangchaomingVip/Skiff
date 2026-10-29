import type { Project } from "../chat/workspace";
import { useProjectGitStatus } from "../workbench/useProjectGitStatus";
import { Icon } from "./Icon";

export function FileWorkspaceEmpty({ project }: { project?: Project }) {
	const git = useProjectGitStatus(project);
	const kind = git.status ? "Git 项目" : git.local ? "本地项目" : undefined;
	return <section className="file-workspace-empty" aria-label="文件工作区">
		<Icon name="sailboat" size={24} />
		<h1>{project ? "打开一个文件" : "选择一个项目"}</h1>
		<p>{project ? "从左侧选择文件，在这里查看内容" : "从左侧选择项目，再浏览文件"}</p>
		{project && <div className="file-workspace-project">{project.name}{kind && ` · ${kind}`}</div>}
	</section>;
}
