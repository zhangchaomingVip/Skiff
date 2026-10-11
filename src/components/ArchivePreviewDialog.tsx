import { useEffect, useState } from "react";
import { PiRpc } from "../rpc/RpcClient";
import type { Conversation, Project } from "../chat/workspace";
import type { ChatMessage } from "../chat/types";
import { readArchivedMessages } from "../chat/archivePreview";
import { Button, Dialog, IconButton } from "./ui";
import { Icon } from "./Icon";
import { MessageList } from "./MessageList";

type PreviewState = { status: "loading" } | { status: "ready"; messages: ChatMessage[] } | { status: "error"; message: string };

export function ArchivePreviewDialog({ chat, project, busy, onRestore, onDelete, onClose }: {
	chat: Conversation;
	project?: Project;
	busy: boolean;
	onRestore: () => void;
	onDelete: () => void;
	onClose: () => void;
}) {
	const [retry, setRetry] = useState(0);
	const [preview, setPreview] = useState<PreviewState>({ status: "loading" });

	useEffect(() => {
		let cancelled = false;
		const sessionFile = chat.sessionFile;
		if (!chat.hasMessages) {
			setPreview({ status: "ready", messages: [] });
			return () => { cancelled = true; };
		}
		if (!sessionFile) {
			setPreview({ status: "error", message: "归档记录缺少 pi 会话文件。" });
			return () => { cancelled = true; };
		}
		const rpc = new PiRpc(`archive_${crypto.randomUUID()}`);
		const started = rpc.start({ cwd: project?.path });
		setPreview({ status: "loading" });
		void (async () => {
			try {
				await started;
				if (cancelled) return;
				const messages = await readArchivedMessages((command) => rpc.request(command), sessionFile, chat.routeSnapshots);
				if (!cancelled) setPreview({ status: "ready", messages });
			} catch (error) {
				if (!cancelled) setPreview({ status: "error", message: `无法读取归档会话：${String(error)}` });
			}
		})();
		return () => {
			cancelled = true;
			void started.catch(() => {}).then(() => rpc.stop()).catch(() => {});
		};
	}, [chat, project?.path, retry]);

	return <Dialog className="archive-preview-dialog" aria-label={`归档预览：${chat.title}`} onClose={onClose}>
		<div className="dialog-heading">
			<div><h2>{chat.title}</h2><p className="muted">{project?.name ?? "未知项目"}</p></div>
			<IconButton type="button" aria-label="关闭归档预览" onClick={onClose}><Icon name="close" /></IconButton>
		</div>
		<div className="archive-preview-actions">
			<Button type="button" variant="primary" size="compact" disabled={busy} onClick={onRestore}><Icon name="refresh" size={14} />恢复并继续</Button>
			<Button type="button" variant="ghost" size="compact" disabled={busy} onClick={onDelete}><Icon name="trash" size={14} />删除索引记录</Button>
		</div>
		{preview.status === "loading" && <div className="archive-preview-status" role="status"><span className="dot busy" />正在读取归档会话…</div>}
		{preview.status === "error" && <div className="archive-preview-error" role="alert"><span>{preview.message}</span><Button type="button" variant="ghost" size="compact" onClick={() => setRetry((value) => value + 1)}><Icon name="refresh" size={14} />重试</Button></div>}
		{preview.status === "ready" && <MessageList messages={preview.messages} projectName={project?.name} running={false} models={[]} onSuggestion={() => {}} followSignal={0} disabled readOnly onContinue={() => {}} onEdit={() => {}} onRegenerate={() => {}} onDelete={() => {}} />}
	</Dialog>;
}
