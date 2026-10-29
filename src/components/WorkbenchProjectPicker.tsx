import { useEffect, useId, useRef, useState } from "react";
import type { Project } from "../chat/workspace";
import { Icon } from "./Icon";
import { Button, Input, Popover } from "./ui";

type Props = {
	projects: Project[];
	project?: Project;
	following: boolean;
	onSelect: (id: string) => void;
	onFollow: () => void;
	onAdd: () => void;
};

function ProjectOptions({ projects, project, onSelect }: Pick<Props, "projects" | "project" | "onSelect">) {
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(Math.max(0, projects.findIndex((item) => item.id === project?.id)));
	const id = useId();
	const search = query.trim().toLocaleLowerCase();
	const rows = projects.filter((item) => `${item.name} ${item.path}`.toLocaleLowerCase().includes(search));
	const activeIndex = Math.min(active, rows.length - 1);
	useEffect(() => {
		document.getElementById(`${id}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
	}, [id, activeIndex, query]);

	return <>
		<div className="workbench-project-search"><Icon name="search" size={16} /><Input appearance="plain" autoFocus role="combobox" aria-label="搜索项目" placeholder="搜索项目" aria-expanded="true" aria-controls={id} aria-autocomplete="list" aria-activedescendant={rows[activeIndex] ? `${id}-${activeIndex}` : undefined} value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={(event) => {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				setActive(Math.max(0, Math.min(rows.length - 1, activeIndex + (event.key === "ArrowDown" ? 1 : -1))));
			} else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
				event.preventDefault();
				if (rows[activeIndex]) onSelect(rows[activeIndex].id);
			}
		}} /></div>
		<div id={id} className="workbench-project-options" role="listbox" aria-label="已有项目">
			{rows.map((item, index) => <button type="button" role="option" key={item.id} id={`${id}-${index}`} aria-selected={item.id === project?.id} className={`workbench-project-option ${index === activeIndex ? "focused" : ""}`} title={item.path} onMouseMove={() => setActive(index)} onClick={() => onSelect(item.id)}>
				<Icon name="folder" size={17} /><span>{item.name}</span>{item.id === project?.id && <Icon name="check" size={16} />}
			</button>)}
			{!rows.length && <p className="workbench-project-empty" role="status">{projects.length ? "没有匹配的项目" : "暂无项目，添加一个项目开始浏览"}</p>}
		</div>
	</>;
}

export function WorkbenchProjectPicker({ projects, project, following, onSelect, onFollow, onAdd }: Props) {
	const [open, setOpen] = useState(false);
	const anchor = useRef<HTMLButtonElement>(null);
	const id = useId();
	const close = () => { setOpen(false); anchor.current?.focus(); };
	return <div className="workbench-project-picker" onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
		<Button ref={anchor} variant="ghost" className="workbench-project-trigger" aria-label={`浏览项目：${project?.name ?? "选择项目"}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} title={project?.path} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); } }}>
			<Icon name="folder" size={18} /><span className="workbench-project-name">{project?.name ?? "选择项目"}</span><Icon name="chevron" size={14} />
		</Button>
		{open && <Popover anchor={anchor} id={id} className="workbench-project-popover" aria-label="选择浏览项目" onClose={() => setOpen(false)}>
			<ProjectOptions projects={projects} project={project} onSelect={(projectId) => { onSelect(projectId); close(); }} />
			<div className="workbench-project-actions">
				<Button variant="ghost" onClick={() => { close(); onAdd(); }}><Icon name="plus" size={17} />新建项目</Button>
				{!following && <Button variant="ghost" onClick={() => { onFollow(); close(); }}><Icon name="target" size={17} />回到当前项目</Button>}
			</div>
		</Popover>}
	</div>;
}
