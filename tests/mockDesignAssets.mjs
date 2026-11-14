/** Imported studio media, plus the one-way Studio → project publish. */
export function installMockDesignAssets(storage) {
	const saves = [];
	let records = JSON.parse(storage?.getItem("skiff.test.design-assets") ?? "[]");
	const persist = () => storage?.setItem("skiff.test.design-assets", JSON.stringify(records));
	return {
		saves,
		get records() { return records; },
		async invoke(command, args) {
			if (command === "save_design_asset_to_project") { const path = `assets/${args.name.replace(/(\.[^.]+)$/, saves.some((save) => save.root === args.root && save.name === args.name) ? "-1$1" : "$1")}`; saves.push({ ...args, path }); return path; }
			if (command === "list_design_assets") return structuredClone(records);
			if (command === "import_design_asset") {
				const input = args.input;
				const record = { id: crypto.randomUUID(), kind: input.kind === "video" ? "video" : "image", name: input.name, mime: input.mime, path: input.dataUrl, size: input.dataUrl.length, canvasId: input.canvasId || undefined, removed: false, createdAt: Date.now() };
				records.unshift(record); persist(); return structuredClone(record);
			}
			if (command === "set_design_asset_removed") { const record = records.find((item) => item.id === args.id); if (!record) throw new Error("导入作品不存在"); record.removed = args.removed; persist(); return structuredClone(record); }
			if (command === "set_design_asset_canvas") { const record = records.find((item) => item.id === args.id); if (!record) throw new Error("导入作品不存在"); record.canvasId = args.canvasId || undefined; persist(); return structuredClone(record); }
			throw new Error(`Unknown design asset command: ${command}`);
		},
	};
}
