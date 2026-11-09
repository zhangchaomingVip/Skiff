// Release-only CDP probe. Builds real application assets with an isolated app-data override.
// Debugging features and the relative data directory apply only to this test build, never tauri.conf.json.
import { spawn } from "node:child_process";
import { resolve } from "node:path";

async function run(binary, args, env = process.env) {
	const child = spawn(binary, args, { cwd: process.cwd(), env, stdio: "inherit", windowsHide: true });
	const code = await new Promise((done, fail) => { child.on("error", fail); child.on("exit", done); });
	if (code !== 0) throw new Error(`${binary} failed (${code})`);
}

await run(process.execPath, [resolve("node_modules/typescript/bin/tsc")]);
await run(process.execPath, [resolve("node_modules/vite/bin/vite.js"), "build"]);
await run("cargo", ["build", "--manifest-path", "src-tauri/Cargo.toml", "--release", "--features", "tauri/devtools,tauri/custom-protocol"], {
	...process.env,
	TAURI_CONFIG: JSON.stringify({ app: { appDirectoriesOverride: "./browser-cdp-data" } }),
});
await run(process.execPath, ["tests/app.cdp.mjs", process.argv.includes("--browser-lifecycle") ? "--browser-lifecycle" : process.argv.includes("--browser-tools") ? "--browser-tools" : "--browser"], {
	...process.env,
	SKIFF_CDP_BINARY: resolve("src-tauri/target/release/skiff-desktop.exe"),
	SKIFF_CDP_RELEASE: "1",
});
