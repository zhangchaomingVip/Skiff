import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { browserNative, type BrowserStatus, type BrowserTarget } from "./native";
import { isBrowserStatus, observeBrowser, sameBrowser, type BrowserPanelRecord } from "./model";

export function useBrowserPanel(chatId: string | undefined, active: boolean) {
	const records = useRef(new Map<string, BrowserPanelRecord>());
	const epochs = useRef(new Map<string, number>());
	const [, render] = useReducer((value: number) => value + 1, 0);
	const [visible, setVisible] = useState(() => !document.hidden);
	const current = useRef(chatId); current.current = chatId;
	const [refresh, refreshNow] = useReducer((value: number) => value + 1, 0);
	useEffect(() => {
		const update = () => setVisible(!document.hidden);
		document.addEventListener("visibilitychange", update);
		return () => document.removeEventListener("visibilitychange", update);
	}, []);
	useEffect(() => {
		if (!chatId || !active || !visible) return;
		let disposed = false;
		let timer: ReturnType<typeof setTimeout>;
		const poll = async () => {
			const before = records.current.get(chatId)?.status;
			const epoch = epochs.current.get(chatId);
			try {
				const status = await browserNative.find(chatId);
				if (disposed || current.current !== chatId || epochs.current.get(chatId) !== epoch) return;
				if (status !== null && (!isBrowserStatus(status) || status.chatId !== chatId)) throw new Error("浏览器状态归属不匹配，请重新连接");
				const previous = records.current.get(chatId) ?? { expanded: false };
				if (previous.status && previous.status !== before && !sameBrowser(previous.status, before)) return;
				const next = observeBrowser(previous, status);
				if (JSON.stringify(previous) !== JSON.stringify(next)) { records.current.set(chatId, next); render(); }
			} catch (reason) {
				if (!disposed && current.current === chatId && epochs.current.get(chatId) === epoch) {
					const previous = records.current.get(chatId) ?? { expanded: false };
					const error = String(reason);
					if (previous.error !== error) { records.current.set(chatId, { ...previous, error }); render(); }
				}
			} finally { if (!disposed) timer = setTimeout(() => void poll(), 1000); }
		};
		void poll();
		return () => { disposed = true; clearTimeout(timer); };
	}, [chatId, active, visible, refresh]);
	const setExpanded = useCallback((expanded: boolean) => {
		const id = current.current;
		if (!id) return;
		const previous = records.current.get(id) ?? { expanded: false };
		records.current.set(id, { ...previous, expanded }); render();
	}, []);
	const updateStatus = useCallback((status: BrowserStatus) => {
		const id = current.current;
		if (!id || status.chatId !== id) return;
		const previous = records.current.get(id);
		if (!previous || !sameBrowser(previous.status, status)) return;
		records.current.set(id, observeBrowser(previous, status)); render();
	}, []);
	const updateUrl = useCallback((target: BrowserTarget, url: string) => {
		const previous = records.current.get(target.chatId);
		if (target.chatId !== current.current || !previous?.status || !sameBrowser(previous.status, target)) return;
		records.current.set(target.chatId, { ...previous, status: { ...previous.status, url } }); render();
	}, []);
	const forget = useCallback((id: string) => { epochs.current.set(id, (epochs.current.get(id) ?? 0) + 1); records.current.delete(id); render(); }, []);
	const record = chatId ? records.current.get(chatId) : undefined;
	return { expanded: record?.expanded ?? false, status: record?.status, error: record?.error, visible: active && visible, setExpanded, updateStatus, updateUrl, forget, refresh: refreshNow };
}
export type BrowserPanelControls = ReturnType<typeof useBrowserPanel>;
