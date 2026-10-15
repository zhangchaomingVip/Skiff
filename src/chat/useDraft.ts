import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { drafts, draftAttachments, type DraftAttachment, type DraftRecord } from "./drafts";
import type { ImageAttachment } from "./types";
import type { TextAttachment } from "./textAttachments";

export interface DraftTarget { chatId: string; cwd: string; sessionFile?: string }
const empty: DraftAttachment[] = [];
export function useDraft(target?: DraftTarget) {
	const [, render] = useReducer((value) => value + 1, 0);
	useEffect(() => drafts.subscribe(render), []);
	const forkScope = useRef<{ from?: string; to?: string }>();
	const initial = useRef<{ loaded: boolean; restored: boolean }>({ loaded: false, restored: false });
	const record = target ? drafts.get(target.chatId) : undefined;
	const compatible = !record || (record.cwd === target?.cwd && (!record.sessionFile || !target?.sessionFile || record.sessionFile === target.sessionFile || !!record.edit));
	if (!initial.current.loaded && drafts.ready) initial.current = { loaded: true, restored: !!record };
	const attachments = compatible ? record?.attachments ?? empty : empty;
	const update = useCallback((patch: Partial<Pick<DraftRecord, "text" | "attachments" | "edit">>) => {
		if (!target) return;
		const current = drafts.get(target.chatId);
		const fork = forkScope.current;
		const scopeFile = fork && (!target.sessionFile || target.sessionFile === fork.from || target.sessionFile === fork.to) ? fork.to : target.sessionFile;
		drafts.save({ ...target, sessionFile: scopeFile, edit: current?.cwd === target.cwd ? current.edit : undefined, text: current?.cwd === target.cwd ? current.text : "", attachments: current?.cwd === target.cwd ? current.attachments : [], ...patch });
	}, [target?.chatId, target?.cwd, target?.sessionFile]);
	const onAttachments = useCallback((images: ImageAttachment[], files: TextAttachment[]) => {
		const current = target ? drafts.get(target.chatId) : undefined;
		const added = draftAttachments(images, files);
		update({ attachments: [...added, ...(current?.attachments.filter((attachment) => attachment.needsReattach && attachment.body === undefined && !added.some((item) => item.kind === attachment.kind && item.name === attachment.name)) ?? [])] });
	}, [update, target?.chatId]);
	const restored = useMemo(() => ({
		images: attachments.filter((item) => item.kind === "image" && item.body !== undefined).map((item): ImageAttachment => ({ type: "image", id: item.id, name: item.name, mimeType: item.mimeType ?? "image/png", data: item.body! })),
		files: attachments.filter((item) => item.kind === "text" && item.body !== undefined).map((item): TextAttachment => ({ id: item.id, name: item.name, text: item.body! })),
	}), [attachments]);
	const status = target ? drafts.status(target.chatId) : undefined;
	const notice = drafts.loadFailed ? "草稿存储无法读取，当前输入仍可使用；请保留需要的内容。" : !compatible ? "项目路径已变化，旧草稿未自动应用。" : status === "error" ? "草稿未能持久化，当前内容仅保留在内存中。" : status === "limited" ? "附件超出保存容量或存储配额，重载后需重新添加；当前内存中的附件仍可使用。" : initial.current.restored && status !== "saving" ? "已恢复草稿" : undefined;
	const rebase = (sessionFile?: string) => {
		if (!target) return;
		forkScope.current = { from: target.sessionFile, to: sessionFile };
		const current = drafts.get(target.chatId);
		if (current?.cwd === target.cwd) drafts.save({ ...current, sessionFile, edit: undefined });
	};
	return { record: compatible ? record : undefined, rebase, update, restored, text: compatible ? record?.text ?? "" : "", attachments, onText: (text: string) => update({ text }), onAttachments, removeMissing: (id: string) => update({ attachments: attachments.filter((attachment) => attachment.id !== id) }), notice, ready: drafts.ready };
}
