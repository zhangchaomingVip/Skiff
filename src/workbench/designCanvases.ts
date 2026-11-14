/** Design canvases group image and video works under one named collection.
 *  They are deliberately not infinite boards: a canvas only scopes the gallery,
 *  so the studio keeps the same grid, previews and task history. */
export interface DesignCanvas {
	id: string;
	name: string;
	createdAt: number;
	updatedAt: number;
}

export interface DesignCanvasState {
	version: 1;
	activeId: string;
	canvases: DesignCanvas[];
}

export const designCanvasKey = "skiff.design.canvases.v1";
/** Empty id is the virtual "ungrouped" canvas; it never appears in the index. */
export const ungroupedCanvasId = "";
export const maxDesignCanvases = 50;
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
			if (!item || typeof item.id !== "string" || typeof item.name !== "string") continue;
			const name = cleanName(item.name);
			if (!name || seen.has(item.id)) continue;
			seen.add(item.id);
			const createdAt = Number(item.createdAt) || Date.now();
			canvases.push({ id: item.id, name, createdAt, updatedAt: Number(item.updatedAt) || createdAt });
		}
		const activeId = typeof saved.activeId === "string" && canvases.some((canvas) => canvas.id === saved.activeId) ? saved.activeId : ungroupedCanvasId;
		return { version: 1, activeId, canvases: canvases.slice(0, maxDesignCanvases) };
	} catch {
		return emptyCanvasState;
	}
}

export function addDesignCanvas(state: DesignCanvasState, name: string, id = crypto.randomUUID()): DesignCanvasState {
	const canvas: DesignCanvas = { id, name: cleanName(name) || "未命名画布", createdAt: Date.now(), updatedAt: Date.now() };
	return { ...state, canvases: [...state.canvases, canvas].slice(0, maxDesignCanvases), activeId: canvas.id };
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
	return canvases.find((canvas) => canvas.id === id)?.name ?? "未分组";
}
