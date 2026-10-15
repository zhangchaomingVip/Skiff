import type { ChatMessage } from "./types";
import type { Conversation } from "./workspace";

export interface HistoryMessage { entryId?: string; role: "user" | "assistant"; text: string; timestamp?: string | number | null }
export interface HistoryProjection { version: string; messages: HistoryMessage[]; unchanged?: boolean }
export interface MessageLocation { chatId: string; sessionFile?: string; version: string; entryId?: string; fingerprint: string; occurrence: number; occurrences: number; query: string }
export interface BodyMatch { location: MessageLocation; snippet: string }
export interface SearchProgress { matches: BodyMatch[]; scanned: number; total: number; failures: string[]; loading: boolean }
export const messageText = (message: ChatMessage) => message.blocks.filter((block) => block.kind === "text").map((block) => block.text).join("\n\n");
export const timestampMs = (value: HistoryMessage["timestamp"]) => typeof value === "string" ? Date.parse(value) : typeof value === "number" ? value > 1e12 ? value : value * 1000 : undefined;
export function fingerprint(message: HistoryMessage): string {
	const value = JSON.stringify([message.role, timestampMs(message.timestamp) ?? null, message.text]);
	// Four independent 32-bit lanes keep result identities compact, including large messages.
	const lanes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
	for (let i = 0; i < value.length; i++) for (let lane = 0; lane < lanes.length; lane++) lanes[lane] = Math.imul(lanes[lane] ^ value.charCodeAt(i), 0x01000193 + lane * 2);
	return `${value.length}:${lanes.map((lane) => (lane >>> 0).toString(16).padStart(8, "0")).join("")}`;
}
export function runtimeHistory(messages: readonly ChatMessage[]): HistoryMessage[] { return messages.filter((message) => message.role === "user" || message.role === "assistant").map((message) => ({ entryId: message.entryId, role: message.role as HistoryMessage["role"], text: messageText(message), timestamp: message.timestamp })); }
export function mergeHistory(history: readonly HistoryMessage[], runtime: readonly HistoryMessage[]): HistoryMessage[] {
	const result = [...history];
	if (!runtime.length) return result;
	const entryIds = new Set(history.map((message) => message.entryId).filter(Boolean));
	const counts = new Map<string, number>();
	for (const message of history) { const key = fingerprint(message); counts.set(key, (counts.get(key) ?? 0) + 1); }
	const seen = new Map<string, number>();
	for (const message of runtime) {
		if (message.entryId && entryIds.has(message.entryId)) continue;
		const key = fingerprint(message), occurrence = (seen.get(key) ?? 0) + 1;
		seen.set(key, occurrence);
		if (occurrence > (counts.get(key) ?? 0)) result.push(message);
	}
	return result;
}
export function bodyMatches(chat: Pick<Conversation, "id" | "sessionFile">, projection: HistoryProjection, query: string): BodyMatch[] {
	const needle = query.trim().toLocaleLowerCase();
	if (!needle) return [];
	const found = projection.messages.flatMap((message) => {
		const index = message.text.toLocaleLowerCase().indexOf(needle);
		return index < 0 ? [] : [{ message, index, key: fingerprint(message) }];
	});
	// Equal identities contain equal text, so all their occurrences also match this query.
	const counts = new Map<string, number>(), seen = new Map<string, number>();
	for (const { key } of found) counts.set(key, (counts.get(key) ?? 0) + 1);
	return found.map(({ message, index, key }) => {
		const occurrence = seen.get(key) ?? 0;
		seen.set(key, occurrence + 1);
		return { location: { chatId: chat.id, sessionFile: chat.sessionFile, version: projection.version, entryId: message.entryId, fingerprint: key, occurrence, occurrences: counts.get(key)!, query }, snippet: `${index > 48 ? "…" : ""}${message.text.slice(Math.max(0, index - 48), index + needle.length + 80)}${index + needle.length + 80 < message.text.length ? "…" : ""}` };
	});
}
export function locateMessage(messages: readonly HistoryMessage[], location: MessageLocation): number | undefined {
	if (location.entryId) {
		const entries = messages.flatMap((message, index) => message.entryId === location.entryId && fingerprint(message) === location.fingerprint ? [index] : []);
		if (entries.length === 1) return entries[0];
	}
	const matches = messages.flatMap((message, index) => fingerprint(message) === location.fingerprint ? [index] : []);
	return matches.length === location.occurrences ? matches[location.occurrence] : undefined;
}

/** Cache only parsed history; hits retain a bounded snippet and stable identity. */
export class HistorySearch {
	private generation = 0;
	private active = 0;
	private queue: Array<() => void> = [];
	private valid?: Set<string>;
	private issued = new Map<string, number>();
	private cache = new Map<string, { projection: HistoryProjection; bytes: number }>();
	private load: (chat: Conversation, knownVersion?: string) => Promise<HistoryProjection>;
	private maxEntries: number;
	private maxBytes: number;
	constructor(load: (chat: Conversation, knownVersion?: string) => Promise<HistoryProjection>, maxEntries = 50, maxBytes = 20 * 1024 * 1024) { this.load = load; this.maxEntries = maxEntries; this.maxBytes = maxBytes; }
	cancel() { this.generation++; }
	prune(chats: readonly Conversation[]) { const valid = this.valid = new Set(chats.map((chat) => `${chat.id}:${chat.sessionFile ?? ""}`)); for (const key of this.cache.keys()) if (!valid.has(key)) this.cache.delete(key); for (const key of this.issued.keys()) if (!valid.has(key)) this.issued.set(key, this.issued.get(key)! + 1); this.cancel(); }
	get cacheSize() { return this.cache.size; }
	async history(chat: Conversation, fresh = false): Promise<HistoryProjection> {
		const key = `${chat.id}:${chat.sessionFile ?? ""}`, cached = this.cache.get(key);
		const issued = (this.issued.get(key) ?? 0) + 1; this.issued.set(key, issued);
		if (this.active >= 2) await new Promise<void>((resolve) => this.queue.push(resolve));
		else this.active++;
		let loaded: HistoryProjection;
		try { loaded = await this.load(chat, fresh ? undefined : cached?.projection.version); }
		finally { const next = this.queue.shift(); if (next) next(); else this.active--; }
		const projection = loaded.unchanged && cached ? cached.projection : loaded;
		if ((this.valid && !this.valid.has(key)) || this.issued.get(key) !== issued) return projection;
		this.cache.delete(key);
		const bytes = new TextEncoder().encode(JSON.stringify(projection)).byteLength;
		if (bytes <= this.maxBytes) this.cache.set(key, { projection, bytes });
		let total = [...this.cache.values()].reduce((sum, entry) => sum + entry.bytes, 0);
		while (this.cache.size > this.maxEntries || total > this.maxBytes) { const first = this.cache.keys().next().value!; total -= this.cache.get(first)!.bytes; this.cache.delete(first); }
		return projection;
	}
	async search(chats: readonly Conversation[], query: string, runtime: ReadonlyMap<string, readonly ChatMessage[]>, progress: (value: SearchProgress) => void): Promise<void> {
		const generation = ++this.generation;
		const result: SearchProgress = { matches: [], scanned: 0, total: chats.length, failures: [], loading: true };
		const ordered = [...chats].sort((a, b) => Number(this.cache.has(`${b.id}:${b.sessionFile ?? ""}`)) - Number(this.cache.has(`${a.id}:${a.sessionFile ?? ""}`)));
		let cursor = 0;
		let publishedAt = -Infinity;
		const publish = (force = false) => { const now = performance.now(); if (generation === this.generation && (force || now - publishedAt >= 50)) { publishedAt = now; progress({ ...result, matches: [...result.matches], failures: [...result.failures] }); } };
		publish(true);
		const worker = async () => {
			while (generation === this.generation && cursor < chats.length) {
				const chat = ordered[cursor++];
				let history: HistoryProjection = { version: "runtime", messages: [] };
				try { if (chat.sessionFile) history = await this.history(chat); }
				catch { result.failures.push(chat.id); }
				if (generation !== this.generation) return;
				history = { ...history, messages: mergeHistory(history.messages, runtimeHistory(runtime.get(chat.id) ?? [])) };
				result.matches.push(...bodyMatches(chat, history, query));
				result.scanned++;
				publish();
				// Yield between files so scanning never monopolizes the input event loop.
				await new Promise<void>((resolve) => { const channel = new MessageChannel(); channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); }; channel.port2.postMessage(null); });
			}
		};
		await Promise.all([worker(), worker()]);
		result.loading = false; publish(true);
	}
}
