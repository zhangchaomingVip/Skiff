// Preview-only implementation. Production always calls Rust; secrets are never
// persisted or recorded in the preview command log.
const fixtureImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMIqLizBQAFGQJZDqNUNAAAAABJRU5ErkJggg==";
export function installMockGeneration(target, storage) {
	let config = JSON.parse(storage?.getItem("skiff.test.images.config") ?? '{"services":[],"defaultServiceId":""}');
	config.concurrencyLimit ??= 5;
	let jobs = JSON.parse(storage?.getItem("skiff.test.images.jobs") ?? "[]");
	let mode = "success";
	let deferJobs = false, deferredJobs;
	const calls = [];
	const persist = () => { storage?.setItem("skiff.test.images.config", JSON.stringify(config)); storage?.setItem("skiff.test.images.jobs", JSON.stringify(jobs)); };
	return {
		calls, setMode(value) { mode = value; },
		deferNextJobs() { deferJobs = true; },
		get hasDeferredJobs() { return !!deferredJobs; },
		releaseJobs() { deferredJobs?.(); deferredJobs = undefined; },
		finishJob(id, status = "completed") { const job = jobs.find((item) => item.id === id); if (!job || job.status !== "generating") throw new Error("Job is not generating"); Object.assign(job, status === "failed" ? { status, message: "mock failure (HTTP 429)" } : { status, path: fixtureImage, actualSize: "1x1" }); persist(); },
		async invoke(command, args) {
			if (command === "get_image_generation_config") return structuredClone(config);
			if (command === "list_image_generation_jobs") {
				const snapshot = structuredClone(jobs);
				if (deferJobs) { deferJobs = false; return new Promise((resolve) => { deferredJobs = () => resolve(snapshot); }); }
				return snapshot;
			}
			if (command === "set_image_generation_concurrency") {
				if (![0, 3, 5, 10].includes(args.limit)) throw new Error("图片并发数无效");
				config.concurrencyLimit = args.limit; persist(); return structuredClone(config);
			}
			if (command === "save_image_generation_service") {
				const input = args.input;
				if (!input.apiKey && !input.id) throw new Error("请填写图片生成服务的 API Key");
				const { apiKey, makeDefault, ...fields } = input;
				const id = input.id ?? crypto.randomUUID();
				const previous = config.services.find((service) => service.id === id);
				const service = { ...fields, id, configured: true, keyHint: apiKey ? `…${apiKey.slice(-4)}` : previous?.keyHint };
				config.services = [...config.services.filter((item) => item.id !== id), service];
				if (makeDefault || !config.defaultServiceId) config.defaultServiceId = id;
				persist(); return structuredClone(config);
			}
			if (command === "delete_image_generation_service") { config.services = config.services.filter((item) => item.id !== args.id); if (config.defaultServiceId === args.id) config.defaultServiceId = config.services[0]?.id ?? ""; persist(); return structuredClone(config); }
			if (command === "start_image_generation") {
				const existing = jobs.find((job) => job.id === args.input.id); if (existing) return structuredClone(existing);
				if (config.concurrencyLimit && jobs.filter((job) => job.status === "generating" || job.status === "saving").length >= config.concurrencyLimit) throw new Error("已达到图片并发上限");
				const { reference, ...input } = args.input;
				calls.push({ ...structuredClone(input), ...(reference ? { reference: { name: reference.name, dataPrefix: reference.dataUrl.slice(0, reference.dataUrl.indexOf(",") + 1) } } : {}) });
				let metadata;
				if (reference) {
					const blob = await (await fetch(reference.dataUrl)).blob();
					const bitmap = await createImageBitmap(blob);
					metadata = { name: reference.name, mime: blob.type, width: bitmap.width, height: bitmap.height }; bitmap.close();
				}
				const service = config.services.find((item) => item.id === args.input.serviceId);
				const job = { ...input, ...(metadata ? { reference: metadata } : {}), serviceName: service.name, createdAt: Date.now(), status: "generating" };
				jobs.unshift(job); persist();
				const outcome = mode;
				if (outcome !== "pending") target.setTimeout(() => {
					if (job.status !== "generating") return;
					Object.assign(job, outcome === "failure" ? { status: "failed", message: reference ? "图生图失败：服务不支持图片编辑（HTTP 404）；未自动改为文生图。" : "额度不足或请求过于频繁（HTTP 429）" } : { status: "completed", path: fixtureImage, actualSize: "1x1", usage: { total_tokens: 42 } }); persist();
				}, 800);
				return structuredClone(job);
			}
			if (command === "cancel_image_generation") { const job = jobs.find((item) => item.id === args.id); if (job?.status === "generating") { job.status = "cancelled"; job.message = "已停止等待；服务端可能仍在生成并计费。"; persist(); } return; }
			if (command === "set_image_generation_canvas") {
				const job = jobs.find((item) => item.id === args.id);
				if (!job) throw new Error("作品不存在");
				job.canvasId = args.canvasId || undefined; persist(); return structuredClone(job);
			}
			if (command === "set_image_generation_asset_removed") {
				const job = jobs.find((item) => item.id === args.id);
				if (!job || job.status !== "completed") throw new Error("只能移除或恢复已完成的图片作品");
				job.removed = args.removed; persist(); return structuredClone(job);
			}
			if (command === "export_image_generation_asset" || command === "reveal_image_generation_asset") { calls.push({ command, id: args.id }); return true; }
			throw new Error(`Unknown image command: ${command}`);
		},
	};
}
