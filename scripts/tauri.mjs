import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const cli = require.resolve("@tauri-apps/cli/tauri.js");
const args = process.argv.slice(2);
const command = args[0];
const env = { ...process.env };

if (command === "dev") {
	const dataRoot = process.env.LOCALAPPDATA ?? (process.platform === "darwin"
		? join(homedir(), "Library", "Application Support")
		: join(homedir(), ".local", "share"));
	env.PI_CODING_AGENT_DIR = join(dataRoot, "Skiff Dev", "pi-agent");
	if (!args.includes("--config") && !args.includes("-c")) args.push("--config", "src-tauri/tauri.dev.conf.json");
} else {
	delete env.SKIFF_PROFILE;
	delete env.SKIFF_DEV_DATA_DIR;
}

const child = spawn(process.execPath, [cli, ...args], { stdio: "inherit", env });
child.on("error", (error) => { console.error(error); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
