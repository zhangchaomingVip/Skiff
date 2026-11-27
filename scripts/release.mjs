// 归档式发布脚本：构建一个完全独立的 exe，并按版本+时间戳留档。
// 每次运行产出的 exe 都是构建那一刻源码的快照，之后的源码改动不影响它。
// 用法：npm run release [-- --no-archive]（仅构建，不归档）
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const version = conf.version ?? "0.0.0";

console.log(`\n=== Skiff release v${version} ===\n`);
console.log("正在构建（release 编译较慢，首次可能需要几分钟）…\n");
const buildEnv = { ...process.env };
delete buildEnv.SKIFF_PROFILE;
delete buildEnv.SKIFF_DEV_DATA_DIR;
execSync("npm run tauri:cli -- build", { stdio: "inherit", cwd: root, env: buildEnv });

const bundleDir = join(root, "src-tauri", "target", "release", "bundle", "nsis");
const installers = existsSync(bundleDir) ? readdirSync(bundleDir).filter((name) => name.toLowerCase().endsWith(".exe")) : [];
if (installers.length !== 1) {
	console.error(`构建完成，但在 ${bundleDir} 下预期找到一个 NSIS 安装器，实际找到 ${installers.length} 个。`);
	process.exit(1);
}
const built = join(bundleDir, installers[0]);

if (process.argv.includes("--no-archive")) {
	console.log(`\n完成：${built}`);
} else {
	const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
	const archiveDir = join(root, "releases");
	mkdirSync(archiveDir, { recursive: true });
	const archived = join(archiveDir, `Skiff-Setup-v${version}-${stamp}.exe`);
	copyFileSync(built, archived);
	const sizeMb = (statSync(archived).size / 1024 / 1024).toFixed(1);
	console.log(`\n已归档：${archived}（${sizeMb} MB）`);
	const history = readdirSync(archiveDir).filter((name) => name.endsWith(".exe")).sort();
	console.log(`releases 目录现有 ${history.length} 个历史版本。`);
}
