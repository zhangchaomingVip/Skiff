/** Only the Studio → project save remains; nothing mirrors Code images into Design. */
export function installMockDesignAssets() {
	const saves = [];
	return {
		saves,
		async invoke(command, args) {
			if (command === "save_design_asset_to_project") { const path = `assets/${args.name.replace(/(\.[^.]+)$/, saves.some((save) => save.root === args.root && save.name === args.name) ? "-1$1" : "$1")}`; saves.push({ ...args, path }); return path; }
		},
	};
}
