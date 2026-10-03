/**
 * Skiff appends these instructions to pi's system prompt via
 * `--append-system-prompt`. Codex-style models narrate before each tool call;
 * reasoning models like DeepSeek do not, so we ask them to.
 */
export const DEFAULT_APPEND_PROMPT = [
	"在调用工具前，先用一句简短自然的话说明你准备做什么（例如「我先读一下设计文档」），然后再调用工具；不要用列表、标题或重复调用参数。",
	"工具执行完再简要说明结果与下一步，让整个过程读起来像连续的旁白。",
].join("\n");

const STORAGE_KEY = "skiff.prompt.append";

const storage = (): Storage | undefined => {
	try {
		return globalThis.localStorage;
	} catch {
		return undefined;
	}
};

/** The user's saved instructions, falling back to Skiff's default narration hint. */
export function loadAppendPrompt(): string {
	const stored = storage()?.getItem(STORAGE_KEY);
	return stored === null || stored === undefined ? DEFAULT_APPEND_PROMPT : stored;
}

export function saveAppendPrompt(text: string): void {
	const store = storage();
	if (!store) return;
	if (text.trim() && text.trim() !== DEFAULT_APPEND_PROMPT) store.setItem(STORAGE_KEY, text);
	else store.removeItem(STORAGE_KEY);
}
