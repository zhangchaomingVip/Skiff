/** Classify the model basename, retaining the exact provider-prefixed API ID. */
export function discoveredFamily(modelId: string): string | undefined {
	const id = modelId.trim().split("/").pop()?.toLowerCase() ?? "";
	// These endpoints cannot serve the chat-completions requests used by Skiff.
	if (NON_CHAT_MODEL.test(id)) return undefined;
	if (/^deepseek(?:$|[-_.])/.test(id)) return "deepseek";
	if (/^(?:kimi|moonshot)(?:$|[-_.])/.test(id)) return "kimi";
	if (/^(?:glm|chatglm)(?:$|[-_.])/.test(id)) return "glm";
	// Auto-routing models with no vendor prefix (e.g. `openrouter/auto`, `auto`) go to the Auto family.
	if (/^auto(?:$|[-_.])|(?:$|[-_.])auto$/.test(id)) return "auto";
	return undefined;
}

/** Endpoints that cannot serve chat-completions requests; excluded from
 *  discovery and from family suggestions alike. */
export const NON_CHAT_MODEL = /(?:^|[-_.])(?:ocr|embedding|rerank|realtime|tts|asr)(?:$|[-_.])/;

/** Vendor casing for suggested family ids; others capitalize the id. */
const FAMILY_NAME_HINTS: Record<string, string> = {
	gpt: "GPT",
	claude: "Claude",
	qwen: "Qwen",
	gemini: "Gemini",
	grok: "Grok",
	doubao: "豆包",
	ernie: "ERNIE",
	hunyuan: "混元",
	minimax: "MiniMax",
	moonshot: "Moonshot",
	llama: "Llama",
	mistral: "Mistral",
};

/**
 * Suggests a new family for a model no existing family claims: the vendor
 * prefix before the first separator names it (`gpt-5` → `gpt`,
 * `Qwen/Qwen3-Max` → `qwen`). A trailing version number is dropped when the
 * stem still reads like a name (`qwen3` → `qwen`, but `o3` stays `o3`), so one
 * vendor's models land in one family. Returns undefined when the prefix cannot
 * name a family (numeric, non-chat endpoint, too long).
 */
export function suggestFamilyId(modelId: string): string | undefined {
	const id = modelId.trim().split("/").pop()?.toLowerCase() ?? "";
	if (!id || NON_CHAT_MODEL.test(id)) return undefined;
	let prefix = id.split(/[-._]/)[0] ?? "";
	const stem = prefix.replace(/\d+$/, "");
	if (stem.length >= 2) prefix = stem;
	// Two characters minimum keeps single-letter vendor noise out of the suggestion.
	return /^[a-z][a-z0-9_-]{1,31}$/.test(prefix) ? prefix : undefined;
}

/** Display name for a suggested family id, used as the family's displayName. */
export function suggestedFamilyLabel(id: string): string {
	return FAMILY_NAME_HINTS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}
