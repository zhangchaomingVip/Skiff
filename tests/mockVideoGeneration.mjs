
export function installMockVideoGeneration(target, storage) {
	let config = JSON.parse(storage?.getItem("skiff.test.videos.config") ?? '{"services":[],"defaultServiceId":""}');
	let jobs = JSON.parse(storage?.getItem("skiff.test.videos.jobs") ?? "[]");
	let mode = "success";
	const calls = [];
	const persist = () => { storage?.setItem("skiff.test.videos.config", JSON.stringify(config)); storage?.setItem("skiff.test.videos.jobs", JSON.stringify(jobs)); };
	const finish = (job) => {
		if (mode === "pending") return;
		const outcome = mode;
		target.setTimeout(async () => {
			if (!["queued", "in_progress", "downloading"].includes(job.status)) return;
			if (outcome === "failure") Object.assign(job, { status: "failed", remoteStatus: "failed", message: "视频服务 HTTP 429；未重新生成。" });
			else if (outcome === "unknown") Object.assign(job, { status: "submission_unknown", remoteId: undefined, message: "提交连接中断，请核对服务记录。" });
			else if (outcome === "download-failure") Object.assign(job, { status: "download_failed", remoteStatus: "completed", message: "下载中断，可重新下载此任务" });
			else {
				const fixture = await (await fetch(new URL("./fixtures/video.mp4.b64", import.meta.url))).text();
				if (!["queued", "in_progress", "downloading"].includes(job.status)) return;
				Object.assign(job, { status: "completed", remoteStatus: "completed", progress: 100, path: `data:video/mp4;base64,${fixture.trim()}`, actualWidth: 72, actualHeight: 128, actualDuration: 5, actualFps: 24, usage: { billing_seconds: 5, cost: 0 } });
			}
			persist();
		}, 900);
	};
	return {
		calls, setMode(value) { mode = value; },
		async invoke(command, args) {
			if (command === "get_video_generation_config") return structuredClone(config);
			if (command === "list_video_generation_jobs") return structuredClone(jobs);
			if (command === "save_video_generation_service") {
				const { apiKey, makeDefault, ...fields } = args.input;
				if (!apiKey && !fields.id) throw new Error("请填写视频服务的 API Key");
				const id = fields.id ?? crypto.randomUUID();
				const old = config.services.find((s) => s.id === id);
				const service = { ...fields, id, configured: true, keyHint: apiKey ? `…${apiKey.slice(-4)}` : old?.keyHint };
				config.services = [...config.services.filter((s) => s.id !== id), service];
				if (makeDefault || !config.defaultServiceId) config.defaultServiceId = id;
				persist(); return structuredClone(config);
			}
			if (command === "delete_video_generation_service") { config.services = config.services.filter((s) => s.id !== args.id); if (config.defaultServiceId === args.id) config.defaultServiceId = config.services[0]?.id ?? ""; persist(); return structuredClone(config); }
			if (command === "start_video_generation") {
				const existing = jobs.find((j) => j.id === args.input.id); if (existing) return structuredClone(existing);
				if (jobs.some((j) => !["completed", "failed", "download_failed", "abandoned"].includes(j.status))) throw new Error("已有视频任务");
				const { reference, ...input } = args.input;
				calls.push({ ...input, hasReference: !!reference, referencePrefix: reference?.slice(0, 23) });
				const service = config.services.find((s) => s.id === input.serviceId);
				const job = { ...input, hasReference: !!reference, serviceName: service.name, baseUrl: service.baseUrl, resolution: "1080p", status: "in_progress", remoteStatus: "in_progress", progress: 10, remoteId: `muse_${input.id}`, createdAt: Date.now() };
				jobs.unshift(job); persist(); finish(job); return structuredClone(job);
			}
			if (command === "control_video_generation") {
				const job = jobs.find((j) => j.id === args.id);
				if (args.action === "pause") { job.status = job.remoteStatus === "completed" ? "download_failed" : "paused"; job.message = "已暂停；服务端可能继续生成并计费。"; }
				if (args.action === "resume") { job.status = job.remoteStatus === "completed" ? "downloading" : "in_progress"; job.message = undefined; finish(job); }
				if (args.action === "abandon") job.status = "abandoned";
				persist(); return;
			}
			if (["export_video_generation_asset", "reveal_video_generation_asset"].includes(command)) { calls.push({ command, id: args.id }); return true; }
			throw new Error(`Unknown video command: ${command}`);
		},
	};
}
