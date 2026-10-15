import type { RpcEvent } from "../rpc/RpcClient";

export type Delivery = "steer" | "follow_up";
export interface QueueSnapshot { steering: string[]; followUp: string[] }
export interface ExtensionDialog {
	id: string;
	method: "select" | "confirm" | "input" | "editor";
	title: string;
	message?: string;
	options?: string[];
	placeholder?: string;
	prefill?: string;
	receivedAt: number;
	expiresAt?: number;
	sending?: boolean;
	error?: string;
}
export type DialogReply = { cancelled: true } | { confirmed: boolean } | { value: string };
export const emptyQueue = (): QueueSnapshot => ({ steering: [], followUp: [] });
export const queueSize = (queue?: QueueSnapshot) => (queue?.steering.length ?? 0) + (queue?.followUp.length ?? 0);
export function queueSnapshot(event: Record<string, unknown>): QueueSnapshot {
	const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
	return { steering: strings(event.steering), followUp: strings(event.followUp) };
}
export function extensionDialog(event: RpcEvent, now: number): ExtensionDialog | undefined {
	if (event.type !== "extension_ui_request" || typeof event.id !== "string" || !["select", "confirm", "input", "editor"].includes(String(event.method))) return;
	return { id: event.id, method: event.method as ExtensionDialog["method"], title: String(event.title ?? "扩展请求"), receivedAt: now,
		...(typeof event.timeout === "number" && Number.isFinite(event.timeout) && event.timeout > 0 ? { expiresAt: now + event.timeout } : {}),
		...(typeof event.message === "string" ? { message: event.message } : {}), ...(typeof event.placeholder === "string" ? { placeholder: event.placeholder } : {}),
		...(typeof event.prefill === "string" ? { prefill: event.prefill } : {}), ...(Array.isArray(event.options) ? { options: event.options.filter((item): item is string => typeof item === "string") } : {}),
	};
}
export const dialogExpired = (dialog: ExtensionDialog, now = Date.now()) => dialog.expiresAt !== undefined && now >= dialog.expiresAt;

/** Owned by the RPC generation, so timers survive hiding a view or changing chats. */
export class DialogRuntime {
	private pending = new Map<string, ExtensionDialog>();
	private seen = new Set<string>();
	private timers = new Map<string, ReturnType<typeof setTimeout>>();
	private live = true;
	private send: (event: Record<string, unknown> & { type: string }) => Promise<void>;
	private emit: (event: RpcEvent) => void;
	constructor(send: DialogRuntime["send"], emit: DialogRuntime["emit"]) { this.send = send; this.emit = emit; }
	add(event: RpcEvent) {
		const dialog = extensionDialog(event, Date.now());
		if (!this.live || !dialog || this.seen.has(dialog.id)) return false;
		this.seen.add(dialog.id);
		this.pending.set(dialog.id, dialog);
		if (dialog.expiresAt !== undefined) this.timers.set(dialog.id, setTimeout(() => this.expire(dialog.id), Math.max(0, dialog.expiresAt - Date.now())));
		return true;
	}
	private remove(id: string) { clearTimeout(this.timers.get(id)); this.timers.delete(id); this.pending.delete(id); }
	private expire(id: string) { if (!this.pending.has(id)) return; this.remove(id); if (this.live) this.emit({ type: "dialog_expired", id }); }
	async reply(id: string, reply: DialogReply): Promise<boolean> {
		const dialog = this.pending.get(id);
		if (!this.live || !dialog || dialog.sending) return false;
		if (dialogExpired(dialog)) { this.expire(id); return false; }
		dialog.sending = true;
		this.emit({ type: "dialog_sending", id });
		try {
			await this.send({ type: "extension_ui_response", id, ...reply });
			this.remove(id);
			if (this.live) this.emit({ type: "dialog_replied", id });
			return true;
		} catch {
			// Native write errors do not prove that zero bytes reached pi. Never retry
			// an uncertain write or turn a duplicate click into a second response.
			if (this.live && this.pending.has(id)) this.emit({ type: "dialog_uncertain", id });
			return false;
		}
	}
	async cancelAll() { await Promise.all([...this.pending.keys()].map((id) => this.reply(id, { cancelled: true }))); }
	recheck() { for (const dialog of this.pending.values()) if (dialogExpired(dialog)) this.expire(dialog.id); }
	dispose() { this.live = false; for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); this.pending.clear(); this.seen.clear(); }
}

export const outcomeLabel = (reason?: string) => reason === "length" ? "输出已达长度上限" : reason === "manual" ? "已手动停止" : reason === "aborted" ? "已中止" : reason === "error" ? "运行失败" : reason === "stop" ? "已完成" : undefined;
