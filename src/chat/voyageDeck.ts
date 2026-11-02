/** Deck preferences for the navigator stage. Storage is optional so tests and
 *  private windows keep working when localStorage throws. */
export type DeckMode = "companion" | "billing" | "blank";

export const DECK_MODE_KEY = "skiff.voyage.deckMode";
export const DECK_SIZE_KEY = "skiff.voyage.deckSize";
export const COMPANION_KEY = "skiff.voyage.companion.v1";
export const COMPANION_SOUND_KEY = "skiff.voyage.sound.v1";

/** The deck may be dragged taller than its default floor, never shorter. */
export const DECK_SIZE_MIN = 306;

/** Base64 of this length keeps a custom companion inside the localStorage budget. */
export const COMPANION_LIMIT = 1_400_000;

export type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const MODES: DeckMode[] = ["companion", "billing", "blank"];

function browserStorage(): PreferenceStorage | undefined {
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}

export function readDeckMode(storage: PreferenceStorage | undefined = browserStorage()): DeckMode {
	try {
		const stored = storage?.getItem(DECK_MODE_KEY);
		return MODES.includes(stored as DeckMode) ? stored as DeckMode : "companion";
	} catch {
		return "companion";
	}
}

export function saveDeckMode(mode: DeckMode, storage: PreferenceStorage | undefined = browserStorage()): void {
	try {
		storage?.setItem(DECK_MODE_KEY, mode);
	} catch {
		/* The deck still switches for this visit. */
	}
}

/** A dragged deck height in px; absent means "just take the remaining space". */
export function readDeckSize(storage: PreferenceStorage | undefined = browserStorage()): number | undefined {
	try {
		const stored = Number(storage?.getItem(DECK_SIZE_KEY));
		return Number.isFinite(stored) && stored >= DECK_SIZE_MIN ? Math.round(stored) : undefined;
	} catch {
		return undefined;
	}
}

export function saveDeckSize(size: number | undefined, storage: PreferenceStorage | undefined = browserStorage()): void {
	try {
		if (size === undefined) storage?.removeItem(DECK_SIZE_KEY);
		else storage?.setItem(DECK_SIZE_KEY, String(Math.round(size)));
	} catch {
		/* The split still works for this visit. */
	}
}

/** Only inline image data is accepted: an object URL would die with the session. */
export function readCompanion(storage: PreferenceStorage | undefined = browserStorage()): string | undefined {
	try {
		const stored = storage?.getItem(COMPANION_KEY);
		return stored?.startsWith("data:image/") && stored.length <= COMPANION_LIMIT ? stored : undefined;
	} catch {
		return undefined;
	}
}

/** Sound is an opt-in easter egg: the deck stays silent until it is asked. */
export function readCompanionSound(storage: PreferenceStorage | undefined = browserStorage()): boolean {
	try {
		return storage?.getItem(COMPANION_SOUND_KEY) === "on";
	} catch {
		return false;
	}
}

export function saveCompanionSound(on: boolean, storage: PreferenceStorage | undefined = browserStorage()): void {
	try {
		storage?.setItem(COMPANION_SOUND_KEY, on ? "on" : "off");
	} catch {
		/* The toggle still works for this visit. */
	}
}

/** Returns false when the image is too large to store, so the caller can explain it. */
export function saveCompanion(source: string | undefined, storage: PreferenceStorage | undefined = browserStorage()): boolean {
	try {
		if (source === undefined) storage?.removeItem(COMPANION_KEY);
		else storage?.setItem(COMPANION_KEY, source);
		return true;
	} catch {
		return false;
	}
}
