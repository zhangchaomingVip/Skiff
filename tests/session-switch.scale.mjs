import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
const baselineOrigin = process.argv[2] ?? "http://localhost:1431";
const currentOrigin = process.argv[3] ?? "http://localhost:1432";
const output = process.argv[4] ?? "dist/session-switch-scale";
await mkdir(output, { recursive: true });
const scenes = [
	...[100, 1000, 10000].flatMap((messages) => ["text", "code", "tool", "image"].map((kind) => `messages=${messages}&chats=30&kind=${kind}`)),
	...[30, 300, 3000].flatMap((chats) => [0, 1].map((expanded) => `messages=100&chats=${chats}&expanded=${expanded}`)),
];
const summary = [];
for (const [index, query] of scenes.entries()) {
	const row = { query };
	for (const [label, origin] of [["baseline", baselineOrigin], ["current", currentOrigin]]) {
		const path = `${output}/${index}-${label}.json`;
		const start = Date.now();
		const code = await new Promise((resolve) => {
			const child = spawn(process.execPath, ["tests/session-switch.browser.mjs", origin, path, "--perf-only", "--query", query, ...(label === "baseline" ? ["--baseline"] : [])], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
			// A pathological fixture is recorded explicitly, never counted as a pass.
			let timedOut = false;
			let force;
			const timer = setTimeout(() => { timedOut = true; child.send({ type: "stop" }); force = setTimeout(() => child.kill(), 10000); }, 300000);
			child.once("exit", (code) => { clearTimeout(timer); clearTimeout(force); resolve(timedOut ? "fixture exceeded 5 minutes" : code); });
		});
		try {
			const raw = await readFile(path);
			await writeFile(`${path}.gz`, gzipSync(raw));
			const report = JSON.parse(raw);
			const measured = report.performance;
			row[label] = { code, seconds: (Date.now() - start) / 1000, scale: measured?.scale ?? report.cold?.scale, samples: report.samples.length, summary: code === 0 && report.samples.length === 60 ? report.summary : undefined, longestTask: measured ? Math.max(0, ...measured.tasks.map((task) => task.duration)) : null, mountedMax: Math.max(0, ...report.samples.map((sample) => sample.mountedReady ?? 0)), oldMessagesMounted: Math.max(0, ...report.samples.map((sample) => sample.mountedAtHighlight ?? 0)), parseMax: measured ? Math.max(0, ...measured.timings.filter((timing) => timing.type === "parseMessages").map((timing) => timing.duration)) : null, jsonParseMax: measured ? Math.max(0, ...measured.timings.filter((timing) => timing.type === "JSON.parse").map((timing) => timing.duration)) : null, failure: report.failure ?? (code === 0 ? undefined : String(code)) };
		} catch (error) { row[label] = { code, error: String(error) }; }
		console.log(`${query} ${label}: ${row[label].samples ?? 0} samples, ${row[label].summary?.highlight?.p95 ?? "failed"} ms highlight P95`);
	}
	summary.push(row);
	await writeFile(`${output}/summary.json`, JSON.stringify(summary, null, 2));
}
