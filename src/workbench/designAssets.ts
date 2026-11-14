import { invoke } from "@tauri-apps/api/core";

/** Imported media persisted by the shell; the browser keeps no copy. */
export interface DesignAssetRecord {
	id: string;
	kind: "image" | "video";
	name: string;
	mime: string;
	path: string;
	size: number;
	canvasId?: string;
	removed: boolean;
	createdAt: number;
}

export const designAssetsNative = {
	list: () => invoke<DesignAssetRecord[]>("list_design_assets"),
	import: (input: { kind: "image" | "video"; name: string; mime: string; dataUrl: string; canvasId?: string }) => invoke<DesignAssetRecord>("import_design_asset", { input }),
	setRemoved: (id: string, removed: boolean) => invoke<DesignAssetRecord>("set_design_asset_removed", { id, removed }),
	setCanvas: (id: string, canvasId?: string) => invoke<DesignAssetRecord>("set_design_asset_canvas", { id, canvasId }),
};

export function fileToDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(new Error("无法读取这个文件，请重新选择"));
		reader.readAsDataURL(file);
	});
}
