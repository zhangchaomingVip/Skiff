// Provider request-body budget trimming. No pi-ai imports, so it is unit-testable.
// Images are re-sent as base64 every turn and tool-result text accumulates; relays reject
// bodies over their limit, so keep the whole serialized payload under budget by dropping the
// oldest inline images first, then truncating the oldest tool-result text.
export const PAYLOAD_BUDGET_BYTES = 800 * 1024;
export const IMAGE_PLACEHOLDER = "[图片已省略以控制请求体积]";
export const TEXT_PLACEHOLDER = "[内容已省略以控制请求体积]";
const TEXT_KEEP_CHARS = 1500;

function inlineImageChars(value) {
	if (typeof value !== "string" || !value.startsWith("data:image/")) return 0;
	const comma = value.indexOf(",");
	if (comma < 0 || !value.slice(0, comma).endsWith(";base64")) return 0;
	return value.length - comma - 1;
}
function imagePartChars(part) {
	if (!part || typeof part !== "object") return 0;
	if (part.type === "image_url" || part.type === "input_image") {
		const url = part.image_url && typeof part.image_url === "object" ? part.image_url.url : (typeof part.image_url === "string" ? part.image_url : part.url);
		return inlineImageChars(url);
	}
	if (part.type === "image" && part.source?.type === "base64" && typeof part.source.data === "string") return part.source.data.length;
	return 0;
}
function isTextPart(part) {
	return !!part && typeof part === "object" && (part.type === "text" || part.type === "input_text") && typeof part.text === "string";
}
function bytesOf(payload) {
	try { return Buffer.byteLength(JSON.stringify(payload), "utf8"); } catch { return 0; }
}

// Collect reducible parts in document order (oldest first). Each entry knows how to shrink itself.
function collectReductions(messages, api) {
	const reductions = [];
	for (const message of messages) {
		if (!Array.isArray(message?.content)) continue;
		const toolResult = message.role === "tool";
		for (let index = 0; index < message.content.length; index++) {
			const part = message.content[index];
			if (imagePartChars(part) > 0) {
				reductions.push({ content: message.content, index, kind: "image", api });
			} else if (toolResult && isTextPart(part) && part.text.length > TEXT_KEEP_CHARS) {
				reductions.push({ content: message.content, index, kind: "text", part });
			}
		}
	}
	return reductions;
}
function applyReduction(reduction) {
	if (reduction.kind === "image") {
		reduction.content[reduction.index] = { type: reduction.api === "openai-responses" ? "input_text" : "text", text: IMAGE_PLACEHOLDER };
	} else {
		reduction.content[reduction.index] = { ...reduction.part, text: `${reduction.part.text.slice(0, TEXT_KEEP_CHARS)}\n${TEXT_PLACEHOLDER}` };
	}
}

// Drop the oldest inline images and truncate the oldest tool-result text until the serialized
// payload fits the budget. Reductions are deterministic and monotonic, so prompt-cache prefixes stay stable.
export function trimPayload(payload, api) {
	const messages = Array.isArray(payload?.messages) ? payload.messages : Array.isArray(payload?.input) ? payload.input : undefined;
	if (!messages || messages.length === 0) return payload;
	if (bytesOf(payload) <= PAYLOAD_BUDGET_BYTES) return payload;
	for (const reduction of collectReductions(messages, api)) {
		applyReduction(reduction);
		if (bytesOf(payload) <= PAYLOAD_BUDGET_BYTES) break;
	}
	return payload;
}
