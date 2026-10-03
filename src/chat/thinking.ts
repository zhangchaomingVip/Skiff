/**
 * One-line reasoning shorter than this is filler; once its turn finishes it is
 * hidden entirely instead of adding a collapsed row that nobody expands.
 * Multi-line reasoning is structured enough to keep.
 */
export const NOTABLE_THINKING_CHARS = 100;

export function isNotableThinking(text: string): boolean {
	const trimmed = text.trim();
	return trimmed.length >= NOTABLE_THINKING_CHARS || trimmed.includes("\n");
}

/** Live reasoning always shows; settled reasoning only when it is notable. */
export function shouldShowThinking(text: string, streaming: boolean): boolean {
	return streaming || isNotableThinking(text);
}
