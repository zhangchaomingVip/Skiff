import { useMemo, useState } from "react";
import type { Conversation, Project } from "../chat/workspace";
import { isArchived } from "../chat/workspace";
import { ArchivePreviewDialog } from "./ArchivePreviewDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { Button, Input } from "./ui";

const archiveTime = (timestamp: number) => new Date(timestamp).toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function ArchivedSessions({ chats, projects, busy, onRestore, onDelete }: {
	chats: Conversation[];
	projects: Project[];
	busy: boolean;
	onRestore: (id: string) => void;
	onDelete: (id: string) => void;
}) {
	const [query, setQuery] = useState("");
	const [preview, setPreview] = useState<Conversation>();
	const [deleting, setDeleting] = useState<Conversation>();
	const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
	const archived = useMemo(() => chats.filter(isArchived).sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)), [chats]);
	const filtered = useMemo(() => {
		const text = query.trim().toLocaleLowerCase();
		return archived.filter((chat) => !text || chat.title.toLocaleLowerCase().includes(text) || projectNames.get(chat.projectId)?.toLocaleLowerCase().includes(text));
	}, [archived, projectNames, query]);
	const remove = () => {
		if (!deleting) return;
		onDelete(deleting.id);
		if (preview?.id === deleting.id) setPreview(undefined);
		setDeleting(undefined);
	};

	return <section id="families-panel-archives" role="tabpanel" aria-labelledby="families-tab-archives" className="archive-sessions">
		<div className="archive-search"><Icon name="search" size={14} /><Input aria-label="搜索归档会话和项目" placeholder="搜索标题或项目" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
		<div className="archive-session-list" aria-label="归档会话列表">
			{filtered.map((chat) => <article className="archive-session-row" key={chat.id}>
				<button type="button" className="archive-session-open" onClick={() => setPreview(chat)} title={chat.title}>
					<strong>{chat.title}</strong>
					<span>{projectNames.get(chat.projectId) ?? "未知项目"}</span>
					<time dateTime={new Date(chat.archivedAt ?? 0).toISOString()}>{archiveTime(chat.archivedAt ?? 0)}</time>
				</button>
				<div className="archive-session-actions">
					<Button type="button" size="compact" variant="ghost" disabled={busy} onClick={() => setPreview(chat)}><Icon name="eye" size={14} />查看</Button>
					<Button type="button" size="compact" variant="ghost" disabled={busy} onClick={() => onRestore(chat.id)}><Icon name="refresh" size={14} />恢复</Button>
					<Button type="button" size="compact" variant="ghost" disabled={busy} aria-label={`删除归档 ${chat.title}`} title="删除索引记录" onClick={() => setDeleting(chat)}><Icon name="trash" size={14} /></Button>
				</div>
			</article>)}
			{!filtered.length && <p className="archive-empty-list">{query ? "没有匹配的归档会话" : "没有归档会话"}</p>}
		</div>
		{deleting && <ConfirmDialog title="删除归档记录" description={`从应用索引中删除「${deleting.title}」？原 pi 会话文件会保留。`} onConfirm={remove} onClose={() => setDeleting(undefined)} />}
		{preview && <ArchivePreviewDialog chat={preview} project={projects.find((project) => project.id === preview.projectId)} busy={busy} onRestore={() => onRestore(preview.id)} onDelete={() => setDeleting(preview)} onClose={() => setPreview(undefined)} />}
	</section>;
}
