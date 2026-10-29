import { useState } from "react";
import { MAX_PROJECTS, type Project } from "../chat/workspace";
import { Icon } from "./Icon";
import { Button, Dialog } from "./ui";

export function ProjectRemovalChoices({ projects, count, selected, onChange, disabled = false }: { projects: Project[]; count: number; selected: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
	return <fieldset className="project-removal-choices" disabled={disabled}>
		<legend>最多保留 {MAX_PROJECTS} 个项目，请选择 {count} 个移出列表</legend>
		<p>聊天记录和本地文件会保留，重新添加文件夹即可恢复。</p>
		<div>{projects.map((project) => <label key={project.id} title={project.path}>
			<input type={count === 1 ? "radio" : "checkbox"} name="remove-project" checked={selected.includes(project.id)} disabled={!selected.includes(project.id) && selected.length >= count && count > 1} onChange={(event) => onChange(count === 1 ? [project.id] : event.target.checked ? [...selected, project.id] : selected.filter((id) => id !== project.id))} />
			<Icon name="folder" /><span><strong>{project.name}</strong><small>{project.path}</small></span>
		</label>)}</div>
	</fieldset>;
}

export function ProjectListLimit({ projects, onRemove }: { projects: Project[]; onRemove: (ids: string[]) => void }) {
	const [selected, setSelected] = useState<string[]>([]);
	const count = projects.length - MAX_PROJECTS;
	return <Dialog className="project-dialog" aria-label="整理项目列表" onClose={() => undefined}>
		<div className="dialog-heading"><h2>整理项目列表</h2></div>
		<ProjectRemovalChoices projects={projects} count={count} selected={selected} onChange={setSelected} />
		<div className="dialog-actions"><Button variant="primary" disabled={selected.length !== count} onClick={() => onRemove(selected)}>移出所选项目</Button></div>
	</Dialog>;
}
