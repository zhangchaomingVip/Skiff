/** Extra instructions passed to pi via `--append-system-prompt`; empty by default. */
export const DEFAULT_APPEND_PROMPT = "";

const STORAGE_KEY = "skiff.prompt.append";

const storage = (): Storage | undefined => {
	try {
		return globalThis.localStorage;
	} catch {
		return undefined;
	}
};

/** An explicitly empty value disables additional instructions. */
export function loadAppendPrompt(): string {
	const stored = storage()?.getItem(STORAGE_KEY);
	return stored === null || stored === undefined ? DEFAULT_APPEND_PROMPT : stored;
}

export function saveAppendPrompt(text: string): void {
	const store = storage();
	if (!store) return;
	store.setItem(STORAGE_KEY, text.trim() ? text : "");
}
