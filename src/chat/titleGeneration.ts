import { invoke } from "@tauri-apps/api/core";
import { DERIVE_TITLE_MAX_LENGTH } from "./conversationDisplay";
import { resolveSelection, type RuntimeOffer } from "./modelFamilies";
import { splitAttachments } from "./textAttachments";
import type { ChatMessage } from "./types";

/** Saved title-model target; the same identity shape conversations use. */
export interface TitleModelRef {
	provider: string;
	id: string;
	modelId?: string;
	offerId?: string;
}

export interface TitleModelSelection {
	primary?: TitleModelRef;
	fallback?: TitleModelRef;
}

const STORAGE_KEY = "skiff.titleModel.v1";
const TITLE_MAX_LENGTH = 40;

const storage = (): Storage | undefined => {
	try {
		return globalThis.localStorage;
	} catch {
		return undefined;
	}
};

function normalizeRef(value: unknown): TitleModelRef | undefined {
	if (!value || typeof value !== "object") return undefined;
	const ref = value as Record<string, unknown>;
	if (typeof ref.provider !== "string" || typeof ref.id !== "string") return undefined;
	const out: TitleModelRef = { provider: ref.provider, id: ref.id };
	if (typeof ref.modelId === "string") out.modelId = ref.modelId;
	if (typeof ref.offerId === "string") out.offerId = ref.offerId;
	return out;
}

export function loadTitleModelSelection(): TitleModelSelection {
	try {
		const raw = storage()?.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		return { primary: normalizeRef(parsed.primary), fallback: normalizeRef(parsed.fallback) };
	} catch {
		return {};
	}
}

export function saveTitleModelSelection(selection: TitleModelSelection): void {
	try {
		storage()?.setItem(STORAGE_KEY, JSON.stringify({ primary: selection.primary ?? null, fallback: selection.fallback ?? null }));
	} catch { /* The next generation simply falls back to deriveTitle. */ }
}

/**
 * Saved models in priority order, resolved against the current offers.
 * A removed or disabled model no longer matches and is skipped, so the
 * fallback only ever points at a live offer.
 */
export function titleOfferCandidates(selection: TitleModelSelection, offers: readonly RuntimeOffer[]): RuntimeOffer[] {
	const candidates: RuntimeOffer[] = [];
	for (const ref of [selection.primary, selection.fallback]) {
		if (!ref) continue;
		const { offer } = resolveSelection({ provider: ref.provider, id: ref.modelId ?? ref.id }, [...offers]);
		if (offer && !candidates.some((item) => item.providerKey === offer.providerKey && item.modelId === offer.modelId)) candidates.push(offer);
	}
	return candidates;
}

const messageText = (message: ChatMessage | undefined): string => {
	if (!message) return "";
	return message.blocks.filter((block) => block.kind === "text").map((block) => splitAttachments(block.text).text).join(" ").replace(/\s+/gu, " ").trim();
};

/** The instruction anchor shared by the prompt builder and its tests. */
export const TITLE_PROMPT_MARKER = "生成一个简短的会话标题";

/** Builds the one-shot summarisation prompt; undefined when there is no user text yet. */
export function buildTitlePrompt(messages: readonly ChatMessage[]): string | undefined {
	const userText = messageText(messages.find((message) => message.role === "user")).slice(0, 1500);
	if (!userText) return undefined;
	const assistantText = messageText(messages.find((message) => message.role === "assistant")).slice(0, 1000);
	return [
		`请为下面的对话${TITLE_PROMPT_MARKER}。`,
		"要求：不超过 15 个字，概括对话主题；只输出标题本身，不要引号、书名号或解释；使用与用户相同的语言。",
		"",
		`用户：${userText}`,
		...(assistantText ? [`助手：${assistantText}`] : []),
	].join("\n");
}

/**
 * A summary title only earns its tokens when the derived title would be a
 * truncated fragment; a short first message already shows in full.
 */
export function titleSummaryNeeded(messages: readonly ChatMessage[]): boolean {
	const first = messages.find((message) => message.role === "user");
	const text = first?.blocks.filter((block) => block.kind === "text").map((block) => splitAttachments(block.text).text).join(" ").replace(/\s+/gu, " ").trim() ?? "";
	return Array.from(text).length > DERIVE_TITLE_MAX_LENGTH;
}

/** Reduces a model reply to a plain sidebar title. */
export function cleanTitleReply(text: string): string | undefined {
	const body = text.trim().replace(/^```[a-zA-Z]*\s*\n?/, "").replace(/\n?```[ \t]*$/u, "");
	const firstLine = body.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
	const plain = firstLine
		.replace(/^```[a-zA-Z]*\s*/, "")
		.replace(/\s*```$/, "")
		.replace(/\*+/g, "")
		.replace(/^[「『【《(\["']+/, "")
		.replace(/[」』》)\]"。！？!?,，:：;；、]+$/u, "")
		.trim();
	const title = Array.from(plain).slice(0, TITLE_MAX_LENGTH).join("").trim();
	return title || undefined;
}

/**
 * Generates a conversation title with one minimal HTTP request per candidate —
 * no pi process, so no agent system prompt, tools, skills or project context
 * ride along, and the relay key never leaves the Rust side. Falls back from
 * the primary model to the backup on any failure; undefined means "keep the
 * derived title".
 */
export async function generateConversationTitle(options: {
	prompt: string;
	offers: readonly RuntimeOffer[];
	selection: TitleModelSelection;
}): Promise<string | undefined> {
	for (const offer of titleOfferCandidates(options.selection, options.offers)) {
		if (!offer.relayId) continue;
		try {
			const reply = await invoke<string>("generate_chat_title", { relayId: offer.relayId, modelId: offer.modelId, prompt: options.prompt });
			const title = cleanTitleReply(reply);
			if (title) return title;
		} catch {
			// Try the next candidate, the way relay failover moves to a backup route.
		}
	}
	return undefined;
}
