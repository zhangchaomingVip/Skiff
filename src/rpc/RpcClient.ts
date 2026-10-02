import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface RpcStartOptions {
	piPath?: string;
	cwd?: string;
	env?: Record<string, string>;
}

/** A single JSON line emitted by `pi --mode rpc` on stdout. */
export type RpcEvent = Record<string, unknown> & { type?: string };

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: number;
}

const DEFAULT_TIMEOUT_MS = 35_000;

/**
 * Thin, typed client over the Rust `rpc_*` commands.
 *
 * Rust spawns `pi --mode rpc`, forwards its stdout lines as the Tauri event
 * `rpc://<id>`, and writes our JSON lines to the child's stdin. This class:
 *  - correlates command/response pairs via the `id` pi echoes back, and
 *  - re-emits every non-response line (streaming events) to subscribers.
 *
 * No protocol semantics live here, so this file ports cleanly to a future GPUI
 * rewrite; only the transport (invoke/listen) is Tauri specific.
 */
export class PiRpc {
	readonly instanceId: string;
	private unlisten: UnlistenFn | null = null;
	private seq = 0;
	private readonly pending = new Map<string, PendingRequest>();
	private readonly eventHandlers = new Set<(event: RpcEvent) => void>();
	private readonly lineHandlers = new Set<(line: string) => void>();

	constructor(instanceId = "main") {
		this.instanceId = instanceId;
	}

	async start(opts: RpcStartOptions = {}): Promise<void> {
		this.unlisten = await listen<string>(`rpc://${this.instanceId}`, (e) => this.handleLine(e.payload));
		try {
			await invoke("rpc_start", {
				options: {
					instanceId: this.instanceId,
					piPath: opts.piPath ?? null,
					cwd: opts.cwd ?? null,
					env: opts.env ?? null,
				},
			});
		} catch (error) {
			this.unlisten?.();
			this.unlisten = null;
			throw error;
		}
	}

	/** Subscribe to streaming events (everything that is not a response). */
	onEvent(handler: (event: RpcEvent) => void): () => void {
		this.eventHandlers.add(handler);
		return () => this.eventHandlers.delete(handler);
	}

	/** Subscribe to every raw stdout line (debug console). */
	onLine(handler: (line: string) => void): () => void {
		this.lineHandlers.add(handler);
		return () => this.lineHandlers.delete(handler);
	}

	/**
	 * Send a command and resolve with its response `data` (or the whole
	 * response for commands that return no data).
	 */
	async request<T = unknown>(command: Record<string, unknown> & { type: string }, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
		const id = `req_${++this.seq}`;
		const promise = new Promise<unknown>((resolve, reject) => {
			const timer = window.setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`RPC timeout: ${command.type}`));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
		});
		// The timeout must still work if the native write itself stalls.
		void invoke("rpc_send", {
			instanceId: this.instanceId,
			message: JSON.stringify({ ...command, id }),
		}).catch((error: unknown) => {
			const pending = this.pending.get(id);
			if (pending) {
				window.clearTimeout(pending.timer);
				this.pending.delete(id);
				pending.reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
		return promise as Promise<T>;
	}

	async stop(): Promise<void> {
		this.unlisten?.();
		this.unlisten = null;
		for (const [, pending] of this.pending) {
			window.clearTimeout(pending.timer);
			pending.reject(new Error("RPC stopped"));
		}
		this.pending.clear();
		await invoke("rpc_stop", { instanceId: this.instanceId });
	}

	private handleLine(line: string): void {
		const trimmed = line.trim();
		if (!trimmed) return;
		this.lineHandlers.forEach((h) => h(trimmed));

		let data: RpcEvent;
		try {
			data = JSON.parse(trimmed) as RpcEvent;
		} catch {
			return;
		}

		if (data.type === "response" && typeof data.id === "string" && this.pending.has(data.id)) {
			const pending = this.pending.get(data.id)!;
			this.pending.delete(data.id);
			window.clearTimeout(pending.timer);
			if (data.success === false) {
				pending.reject(new Error(typeof data.error === "string" ? data.error : "RPC error"));
			} else {
				pending.resolve(data.data ?? data);
			}
			return;
		}
		if (data.type === "bridge_exit") {
			for (const pending of this.pending.values()) {
				window.clearTimeout(pending.timer);
				pending.reject(new Error(String(data.message ?? "pi process exited")));
			}
			this.pending.clear();
		}

		this.eventHandlers.forEach((h) => h(data));
	}
}
