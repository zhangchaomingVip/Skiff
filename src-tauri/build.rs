fn main() {
	// The Windows resource icon (icons/icon.ico) and the codegen-embedded default
	// window icon (icons/32x32.png) are baked in at compile time, so icon edits
	// must force a rebuild. `tauri.conf.json` changes (e.g. window decorations)
	// are not always re-detected, so watch it explicitly.
	println!("cargo:rerun-if-changed=icons");
	println!("cargo:rerun-if-changed=tauri.conf.json");
	tauri_build::build();
}
