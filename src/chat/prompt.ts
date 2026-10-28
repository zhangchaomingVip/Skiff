/** User-editable instructions; independent of Skiff's built-in identity. */
export const DEFAULT_APPEND_PROMPT = "";

/** Product identity stays model-independent so switches and failover cannot stale it. */
export const SKIFF_IDENTITY_PROMPT = "You are the AI assistant in Skiff, a desktop app powered by the pi coding-agent harness.";

const STORAGE_KEY = "skiff.prompt.append";

const storage = (): Storage | undefined => {
	try {
		return globalThis.localStorage;
	} catch {
		return undefined;
	}
};

/** An explicitly empty value disables only user-authored additional instructions. */
export function loadAppendPrompt(): string {
	const stored = storage()?.getItem(STORAGE_KEY);
	return stored === null || stored === undefined ? DEFAULT_APPEND_PROMPT : stored;
}

/** Compose at startup without persisting built-in instructions into the user's editor. */
export function buildAppendPrompt(): string {
	const userPrompt = loadAppendPrompt();
	return userPrompt.trim() ? `${SKIFF_IDENTITY_PROMPT}\n\n${userPrompt}` : SKIFF_IDENTITY_PROMPT;
}

export function saveAppendPrompt(text: string): void {
	const store = storage();
	if (!store) return;
	store.setItem(STORAGE_KEY, text.trim() ? text : "");
}
