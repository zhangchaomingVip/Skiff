/** Design conversations group image and video jobs and imported works. */
export interface DesignCanvas {
	id: string;
	name: string;
	createdAt: number;
	updatedAt: number;
	archivedAt?: number;
}

export const isArchivedDesignCanvas = (canvas: DesignCanvas): canvas is DesignCanvas & { archivedAt: number } => canvas.archivedAt !== undefined;

export interface DesignCanvasState {
	version: 1;
	activeId: string;
	canvases: DesignCanvas[];
}

export const designCanvasKey = "skiff.design.canvases.v1";
/** Empty id is the virtual "ungrouped" canvas; it never appears in the index. */
export const ungroupedCanvasId = "";
export const maxDesignCanvases = 500;
export const maxCanvasNameLength = 40;

const cleanName = (name: string) => name.trim().slice(0, maxCanvasNameLength);
export const emptyCanvasState: DesignCanvasState = { version: 1, activeId: ungroupedCanvasId, canvases: [] };

/** Tolerant read: damaged entries fall back to the ungrouped canvas instead of
 *  hiding works, and an unknown active id never strands the studio. */
export function readDesignCanvases(storage: Pick<Storage, "getItem">): DesignCanvasState {
	try {
		const saved = JSON.parse(storage.getItem(designCanvasKey) ?? "null") as Partial<DesignCanvasState> | null;
		if (!saved || !Array.isArray(saved.canvases)) return emptyCanvasState;
		const seen = new Set<string>();
		const canvases: DesignCanvas[] = [];
		for (const item of saved.canvases) {
			if (!item || typeof item.id !== "string" || !item.id || typeof item.name !== "string") continue;
			const name = cleanName(item.name);
			if (!name || seen.has(item.id)) continue;
			seen.add(item.id);
			const createdAt = Number(item.createdAt) || Date.now();
			const { archivedAt } = item;
			const hasArchiveTime = typeof archivedAt === "number" && Number.isSafeInteger(archivedAt) && archivedAt > 0 && archivedAt <= 8.64e15;
			canvases.push({ id: item.id, name, createdAt, updatedAt: Number(item.updatedAt) || createdAt, ...(hasArchiveTime ? { archivedAt } : {}) });
			if (canvases.length === maxDesignCanvases) break;
		}
		const activeId = typeof saved.activeId === "string" && canvases.some((canvas) => canvas.id === saved.activeId && !isArchivedDesignCanvas(canvas)) ? saved.activeId : ungroupedCanvasId;
		return { version: 1, activeId, canvases };
	} catch {
		return emptyCanvasState;
	}
}

export function addDesignCanvas(state: DesignCanvasState, name: string, id = crypto.randomUUID()): DesignCanvasState {
	if (state.canvases.length >= maxDesignCanvases) return state;
	const canvas: DesignCanvas = { id, name: cleanName(name) || "新对话", createdAt: Date.now(), updatedAt: Date.now() };
	return { ...state, canvases: [...state.canvases, canvas], activeId: canvas.id };
}

export function archiveDesignCanvas(state: DesignCanvasState, id: string, archivedAt = Date.now()): DesignCanvasState {
	const target = state.canvases.find((canvas) => canvas.id === id);
	if (!target || isArchivedDesignCanvas(target)) return state;
	return {
		...state,
		activeId: state.activeId === id ? ungroupedCanvasId : state.activeId,
		canvases: state.canvases.map((canvas) => canvas === target ? { ...canvas, archivedAt } : canvas),
	};
}

export function restoreDesignCanvas(state: DesignCanvasState, id: string): DesignCanvasState {
	const target = state.canvases.find((canvas) => canvas.id === id);
	if (!target || !isArchivedDesignCanvas(target)) return state;
	const { archivedAt, ...restored } = target;
	return { ...state, activeId: id, canvases: state.canvases.map((canvas) => canvas === target ? restored : canvas) };
}

export function renameDesignCanvas(state: DesignCanvasState, id: string, name: string): DesignCanvasState {
	const next = cleanName(name);
	if (!next) return state;
	return { ...state, canvases: state.canvases.map((canvas) => canvas.id === id ? { ...canvas, name: next, updatedAt: Date.now() } : canvas) };
}

/** Removing a canvas never removes files: its works fall back to ungrouped. */
export function removeDesignCanvas(state: DesignCanvasState, id: string): DesignCanvasState {
	return { ...state, canvases: state.canvases.filter((canvas) => canvas.id !== id), activeId: state.activeId === id ? ungroupedCanvasId : state.activeId };
}

/** A work whose canvas was deleted lands in the ungrouped bucket, not in limbo. */
export function assetCanvasId(asset: { canvasId?: string }, canvases: readonly DesignCanvas[]): string {
	return asset.canvasId && canvases.some((canvas) => canvas.id === asset.canvasId) ? asset.canvasId : ungroupedCanvasId;
}

export function canvasLabel(canvases: readonly DesignCanvas[], id: string): string {
	return canvases.find((canvas) => canvas.id === id)?.name ?? "早期作品";
}

/** Conversations name themselves after their first prompt: the opening clause, capped short. */
export function conversationName(prompt: string): string {
	const text = prompt.replace(/\s+/g, " ").trim();
	const clause = text.split(/[，。,.!！？?；;：:\n]/)[0]?.trim() ?? "";
	const base = Array.from(clause.length >= 4 ? clause : text);
	return base.length > 16 ? `${base.slice(0, 16).join("")}…` : base.join("") || "新对话";
}

/** A new turn moves its conversation to the top of the list. */
export function touchDesignCanvas(state: DesignCanvasState, id: string): DesignCanvasState {
	return { ...state, canvases: state.canvases.map((canvas) => canvas.id === id ? { ...canvas, updatedAt: Date.now() } : canvas) };
}
