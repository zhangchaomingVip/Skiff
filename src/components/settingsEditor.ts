import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Dispatch, type Ref, type RefObject, type SetStateAction } from "react";

/** Handle the settings shell uses to coordinate Escape, pending saves and back. */
export type SettingsEditorHandle = { pending: boolean; editing: boolean; back: () => void };

/** A destructive action awaiting confirmation inside a settings form. */
export type SettingsRemoval = { title: string; description: string; action: () => Promise<boolean> };

type SettingsEditor<D> = {
	draft: D | undefined;
	setDraft: Dispatch<SetStateAction<D | undefined>>;
	pending: boolean;
	setPending: (pending: boolean) => void;
	error: string | undefined;
	setError: (error: string | undefined) => void;
	removing: SettingsRemoval | undefined;
	setRemoving: (removal: SettingsRemoval | undefined) => void;
	contentRef: RefObject<HTMLDivElement>;
	closeDraft: () => void;
	mutate: (action: () => Promise<boolean>) => Promise<void>;
	rememberEditorTrigger: () => void;
};

/** Keep keyboard focus in the toolbar if filtering or a mutation removes its row. */
export function useSettingsListFocus(content: RefObject<HTMLDivElement>, editing: boolean) {
	const previous = useRef<HTMLElement>();
	useEffect(() => {
		const remember = (event: FocusEvent) => { if (content.current?.contains(event.target as Node)) previous.current = event.target as HTMLElement; };
		document.addEventListener("focusin", remember);
		return () => document.removeEventListener("focusin", remember);
	}, [content]);
	useLayoutEffect(() => {
		if (!editing && previous.current && (!document.activeElement || document.activeElement === document.body)) {
			const target = previous.current.isConnected ? previous.current : content.current?.querySelector<HTMLElement>(".settings-toolbar input, .settings-toolbar button");
			// Configuration updates can briefly disable the containing fieldset
			// while the session reconnects. Restore once that lock is released.
			if (target && !target.matches(":disabled")) target.focus();
		}
	});
}

/**
 * Plumbing shared by the settings pages that swap a list for a form: draft
 * presence, pending/error state, the deletion confirmation, focus handoff
 * between the triggering row and the form, and the lock the shell reads.
 * `onClose` lets a page reset state it owns, such as a running connection test.
 */
export function useSettingsEditor<D extends { kind: string }>({ ref, onLockChange, onClose }: {
	ref: Ref<SettingsEditorHandle>;
	onLockChange: (locked: boolean, pending: boolean) => void;
	onClose?: () => void;
}): SettingsEditor<D> {
	const [draft, setDraft] = useState<D>();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const [removing, setRemoving] = useState<SettingsRemoval>();
	const contentRef = useRef<HTMLDivElement>(null);
	const editorTrigger = useRef<HTMLElement | null>(null);
	const editorTriggerLabel = useRef<string | null>(null);
	const rememberEditorTrigger = () => {
		if (!editorTrigger.current && document.activeElement instanceof HTMLElement) {
			editorTrigger.current = document.activeElement;
			editorTriggerLabel.current = document.activeElement.getAttribute("aria-label");
		}
	};
	const closeDraft = () => { onClose?.(); setDraft(undefined); setError(undefined); };
	useImperativeHandle(ref, () => ({ pending, editing: !!draft, back: closeDraft }));
	useLayoutEffect(() => { onLockChange(pending || !!draft, pending); }, [pending, !!draft, onLockChange]);
	useLayoutEffect(() => {
		if (draft) {
			(contentRef.current?.querySelector<HTMLElement>("input:not([type=checkbox]):not(:disabled), select:not(:disabled)") ?? contentRef.current?.querySelector<HTMLElement>("button:not(:disabled)"))?.focus();
		} else if (editorTrigger.current) {
			const target = editorTrigger.current;
			const replacement = Array.from(contentRef.current?.querySelectorAll<HTMLElement>("button[aria-label]") ?? []).find((element) => element.getAttribute("aria-label") === editorTriggerLabel.current);
			editorTrigger.current = null;
			editorTriggerLabel.current = null;
			(target.isConnected ? target : replacement ?? contentRef.current?.querySelector<HTMLElement>(".settings-toolbar input, .settings-toolbar button") ?? contentRef.current?.querySelector<HTMLElement>("button:not(:disabled)"))?.focus();
		}
	}, [draft?.kind]);
	const mutate = async (action: () => Promise<boolean>) => {
		if (pending) return;
		setPending(true); setError(undefined);
		try { await action(); } catch (e) { setError(String(e)); }
		finally { setPending(false); }
	};
	return { draft, setDraft, pending, setPending, error, setError, removing, setRemoving, contentRef, closeDraft, mutate, rememberEditorTrigger };
}
