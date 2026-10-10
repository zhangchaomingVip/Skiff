import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";

// Analyze a profiling report independently of normal response measurements.
const reportPath = process.argv[2];
const buildPath = process.argv[3];
if (!reportPath || !buildPath) throw new Error("Usage: node tests/session-switch.analyze.mjs <report.json> <fixture-build-directory>");
const report = JSON.parse(await readFile(reportPath, "utf8"));
const events = JSON.parse(await readFile(reportPath.replace(/\.json$/, ".trace.json"), "utf8")).traceEvents;
const first = report.samples[0];
const last = report.samples.at(-1);
const samplingWindow = [first.start, last.start + Math.max(last.ready, last.paintOpportunity)];
const duringSampling = (time) => time >= samplingWindow[0] && time <= samplingWindow[1];
const maps = new Map();
async function location(frame, zeroBased = true) {
	if (!frame?.url?.includes("/assets/")) return frame;
	const name = basename(new URL(frame.url).pathname);
	if (!maps.has(name)) {
		try { maps.set(name, new TraceMap(JSON.parse(await readFile(join(buildPath, "assets", `${name}.map`), "utf8")))); }
		catch { maps.set(name, undefined); }
	}
	const map = maps.get(name);
	const source = map && originalPositionFor(map, { line: frame.lineNumber + (zeroBased ? 1 : 0), column: frame.columnNumber ?? 0 });
	return { function: frame.functionName, bundle: name, line: frame.lineNumber, column: frame.columnNumber, source };
}
const calls = events.filter((event) => event.name === "FunctionCall" && event.dur > 50000).sort((a, b) => b.dur - a.dur);
const longest = calls[0];
const profiles = new Map();
for (const event of events) {
	const key = `${event.pid}:${event.id}`;
	if (event.name === "Profile") profiles.set(key, { time: event.args.data.startTime, nodes: new Map(), samples: [] });
	if (event.name !== "ProfileChunk") continue;
	const profile = profiles.get(key);
	if (!profile) continue;
	const data = event.args.data;
	for (const node of data.cpuProfile.nodes ?? []) profile.nodes.set(node.id, node);
	for (const [index, id] of (data.cpuProfile.samples ?? []).entries()) {
		profile.time += data.timeDeltas[index];
		profile.samples.push({ id, time: profile.time, duration: data.timeDeltas[index] });
	}
}
const stacks = [];
for (const profile of profiles.values()) {
	const weights = new Map();
	for (const sample of profile.samples) {
		if (!longest || sample.time < longest.ts || sample.time > longest.ts + longest.dur) continue;
		weights.set(sample.id, (weights.get(sample.id) ?? 0) + sample.duration);
	}
	for (const [id, weight] of [...weights].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
		const stack = [];
		let node = profile.nodes.get(id);
		while (node) { stack.push(await location(node.callFrame)); node = profile.nodes.get(node.parent); }
		stacks.push({ sampledMs: weight / 1000, stack: stack.reverse() });
	}
}
const durations = (name) => events.filter((event) => event.name === name && event.dur).map((event) => event.dur / 1000);
const stats = (values) => ({ count: values.length, total: values.reduce((sum, value) => sum + value, 0), max: Math.max(0, ...values) });
const result = {
	query: report.fixtureQuery,
	samples: report.samples.length,
	sidebarRows: report.performance.sidebarRows,
	samplingWindow,
	commits: stats(report.performance.commits.filter((commit) => duringSampling(commit.time)).map((commit) => commit.duration)),
	longTasks: stats(report.performance.tasks.filter((task) => duringSampling(task.start)).map((task) => task.duration)),
	layout: stats(durations("Layout")),
	style: stats(durations("UpdateLayoutTree")),
	parseMessages: stats(report.performance.timings.filter((timing) => duringSampling(timing.start) && timing.type === "parseMessages").map((timing) => timing.duration)),
	jsonParse: stats(report.performance.timings.filter((timing) => duringSampling(timing.start) && timing.type === "JSON.parse").map((timing) => timing.duration)),
	workspaceStringify: stats(report.performance.timings.filter((timing) => duringSampling(timing.start) && timing.type === "workspace.stringify").map((timing) => timing.duration)),
	workspaceStorage: stats(report.performance.timings.filter((timing) => duringSampling(timing.start) && timing.type === "workspace.localStorage").map((timing) => timing.duration)),
	longCalls: await Promise.all(calls.map(async (call) => ({ duration: call.dur / 1000, start: call.ts, frame: await location(call.args.data, false) }))),
	longestCallStacks: stacks,
};
const destination = join(dirname(reportPath), basename(reportPath).replace(/\.json$/, ".analysis.json"));
await writeFile(destination, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ destination, commits: result.commits, longTasks: result.longTasks, layout: result.layout, style: result.style, longCalls: result.longCalls.length }));
