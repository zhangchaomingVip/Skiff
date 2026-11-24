import { useRef, useState } from "react";
import { browserNative, type BrowserStatus } from "./native";
import type { BrowserPanelControls } from "./useBrowserPanel";
import type { PiSessionActions } from "../chat/usePiSession";
import { sameBrowser } from "./model";

export const BROWSER_CONTINUE_PROMPT = "用户已交还浏览器，请继续之前的浏览任务。第一步必须调用 browser snapshot 获取当前页面和新的元素引用；不要复用接管前的引用，不要重复已完成的提交。";
export const BROWSER_READ_PROMPT = "当前页面就是我要你看的页面。请先调用 browser snapshot 读取当前页面（不要使用 open 打开新网址，不要点击或提交），用一句话概括页面内容，然后等待我的下一步指示。";
export function useBrowserActions(chatId: string | undefined, controls: BrowserPanelControls, actions: PiSessionActions, isCurrent: () => boolean, send: (text: string) => Promise<boolean>) {
	const [operations, setOperations] = useState<Record<string, { generation: string; kind: string }>>({});
	const [failures, setFailures] = useState<Record<string, { chatId: string; generation: string; text: string }>>({});
	const locked = useRef(new Set<string>());
	const selected = useRef(chatId); selected.current = chatId;
	const run = async (kind: "takeOver" | "return" | "stop" | "close" | "continue" | "read", flush?: () => Promise<void>): Promise<BrowserStatus | undefined> => {
		const target = controls.status;
		if (!chatId || !target || locked.current.has(chatId) || !isCurrent()) return undefined;
		locked.current.add(chatId);
		setFailures((previous) => { const next = { ...previous }; delete next[chatId]; return next; });
		setOperations((previous) => ({ ...previous, [chatId]: { ...target, kind } }));
		const current = () => selected.current === chatId && isCurrent();
		let succeeded = false;
		try {
			if (kind === "continue") {
				if (!await send(BROWSER_CONTINUE_PROMPT)) throw new Error("未能启动续跑，请在对话中重新发送任务");
				succeeded = true;
				return controls.status ?? undefined;
			}
			if (kind === "read") {
				// Hand the current page to the AI without opening a new URL. The return
				// handshake already drains in-flight input and marks requiresSnapshot, so
				// the model must read this exact page before it can act on it.
				if (flush) await flush();
				let status = await browserNative.beginControl(target, "return");
				if (current()) controls.updateStatus(status);
				status = await browserNative.completeControl(target, "return", status.controlVersion);
				if (!sameBrowser(target, status)) throw new Error("浏览器实例已改变，请重新读取状态");
				if (current()) controls.updateStatus(status);
				if (!await send(BROWSER_READ_PROMPT)) throw new Error("未能把当前页面交给 AI，请稍后重试");
				succeeded = true;
				return status;
			}
			if (flush && kind === "return") await flush();
			let status: BrowserStatus;
			if (kind === "close") {
				// Native close invalidates AI and input before waiting; pi is interrupted concurrently.
				const results = await Promise.allSettled([browserNative.close(target), actions.abort({ browserManaged: true, strict: true })]);
				if (results[0].status === "fulfilled" && current()) controls.updateStatus(results[0].value);
				for (const result of results) if (result.status === "rejected") throw result.reason;
				succeeded = true;
				return results[0].status === "fulfilled" ? results[0].value : undefined;
			}
			status = await browserNative.beginControl(target, kind);
			if (current()) controls.updateStatus(status);
			if (kind !== "return") await actions.abort({ browserManaged: true, strict: true });
			status = await browserNative.completeControl(target, kind, status.controlVersion);
			if (!sameBrowser(target, status)) throw new Error("浏览器实例已改变，请重新读取状态");
			if (current()) controls.updateStatus(status);
			succeeded = true;
			return status;
		} catch (error) {
			setFailures((previous) => ({ ...previous, [chatId]: { ...target, text: String(error) } }));
			return undefined;
		} finally {
			locked.current.delete(chatId);
			setOperations((previous) => { const next = { ...previous }; delete next[chatId]; return next; });
			// A failed request leaves ownership uncertain; reconcile once. A successful one
			// already returned the authoritative status, and a late refresh could overwrite a
			// follow-up navigation that shares the same control version.
			if (!succeeded) controls.refresh();
		}
	};
	const operation = chatId ? operations[chatId] : undefined;
	const failure = chatId ? failures[chatId] : undefined;
	return { run, pending: operation && operation.generation === controls.status?.generation ? operation.kind : undefined, error: failure && sameBrowser(failure, controls.status) ? failure.text : undefined };
}
export type BrowserActions = ReturnType<typeof useBrowserActions>;
