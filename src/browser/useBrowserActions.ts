import { useRef, useState } from "react";
import { browserNative, type BrowserStatus } from "./native";
import type { BrowserPanelControls } from "./useBrowserPanel";
import type { PiSessionActions } from "../chat/usePiSession";
import { sameBrowser } from "./model";

export const BROWSER_CONTINUE_PROMPT = "用户已交还浏览器，请继续之前的浏览任务。第一步必须调用 browser snapshot 获取当前页面和新的元素引用；不要复用接管前的引用，不要重复已完成的提交。";
export function useBrowserActions(chatId: string | undefined, controls: BrowserPanelControls, actions: PiSessionActions, isCurrent: () => boolean, send: (text: string) => Promise<boolean>) {
	const [operations, setOperations] = useState<Record<string, { generation: string; kind: string }>>({});
	const [failures, setFailures] = useState<Record<string, { chatId: string; generation: string; text: string }>>({});
	const locked = useRef(new Set<string>());
	const selected = useRef(chatId); selected.current = chatId;
	const run = async (kind: "takeOver" | "return" | "stop" | "close" | "continue", flush?: () => Promise<void>) => {
		const target = controls.status;
		if (!chatId || !target || locked.current.has(chatId) || !isCurrent()) return;
		locked.current.add(chatId);
		setFailures((previous) => { const next = { ...previous }; delete next[chatId]; return next; });
		setOperations((previous) => ({ ...previous, [chatId]: { ...target, kind } }));
		const current = () => selected.current === chatId && isCurrent();
		try {
			if (kind === "continue") {
				if (!await send(BROWSER_CONTINUE_PROMPT)) throw new Error("未能启动续跑，请在聊天中重新发送任务");
				return;
			}
			if (flush && kind === "return") await flush();
			let status: BrowserStatus;
			if (kind === "close") {
				// Native close invalidates AI and input before waiting; pi is interrupted concurrently.
				const results = await Promise.allSettled([browserNative.close(target), actions.abort({ browserManaged: true, strict: true })]);
				if (results[0].status === "fulfilled" && current()) controls.updateStatus(results[0].value);
				for (const result of results) if (result.status === "rejected") throw result.reason;
				return;
			}
			status = await browserNative.beginControl(target, kind);
			if (current()) controls.updateStatus(status);
			if (kind !== "return") await actions.abort({ browserManaged: true, strict: true });
			status = await browserNative.completeControl(target, kind, status.controlVersion);
			if (!sameBrowser(target, status)) throw new Error("浏览器实例已改变，请重新读取状态");
			if (current()) controls.updateStatus(status);
		} catch (error) {
			setFailures((previous) => ({ ...previous, [chatId]: { ...target, text: String(error) } }));
		} finally {
			locked.current.delete(chatId);
			setOperations((previous) => { const next = { ...previous }; delete next[chatId]; return next; });
			controls.refresh();
		}
	};
	const operation = chatId ? operations[chatId] : undefined;
	const failure = chatId ? failures[chatId] : undefined;
	return { run, pending: operation && operation.generation === controls.status?.generation ? operation.kind : undefined, error: failure && sameBrowser(failure, controls.status) ? failure.text : undefined };
}
export type BrowserActions = ReturnType<typeof useBrowserActions>;
