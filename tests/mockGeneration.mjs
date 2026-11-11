// Preview-only implementation. Production always calls Rust; secrets are never
// persisted or recorded in the preview command log.
const fixtureImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
export function installMockGeneration(target, storage) {
	let config = JSON.parse(storage?.getItem("skiff.test.images.config") ?? '{"services":[],"defaultServiceId":""}');
	let jobs = JSON.parse(storage?.getItem("skiff.test.images.jobs") ?? "[]");
	let mode = "success";
	const calls = [];
	const persist = () => { storage?.setItem("skiff.test.images.config", JSON.stringify(config)); storage?.setItem("skiff.test.images.jobs", JSON.stringify(jobs)); };
	return {
		calls, setMode(value) { mode = value; },
		async invoke(command, args) {
			if (command === "get_image_generation_config") return structuredClone(config);
			if (command === "list_image_generation_jobs") return structuredClone(jobs);
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
				calls.push(structuredClone(args.input));
				const existing = jobs.find((job) => job.id === args.input.id); if (existing) return structuredClone(existing);
				if (jobs.some((job) => job.status === "generating" || job.status === "saving")) throw new Error("已有图片正在生成");
				const service = config.services.find((item) => item.id === args.input.serviceId);
				const job = { ...args.input, serviceName: service.name, createdAt: Date.now(), status: "generating" };
				jobs.unshift(job); persist();
				const outcome = mode;
				if (outcome !== "pending") target.setTimeout(() => {
					if (job.status !== "generating") return;
					Object.assign(job, outcome === "failure" ? { status: "failed", message: "额度不足或请求过于频繁（HTTP 429）" } : { status: "completed", path: fixtureImage, actualSize: "1x1", usage: { total_tokens: 42 } }); persist();
				}, 800);
				return structuredClone(job);
			}
			if (command === "cancel_image_generation") { const job = jobs.find((item) => item.id === args.id); if (job?.status === "generating") { job.status = "cancelled"; job.message = "已停止等待；服务端可能仍在生成并计费。"; persist(); } return; }
			if (command === "export_image_generation_asset" || command === "reveal_image_generation_asset") { calls.push({ command, id: args.id }); return true; }
			throw new Error(`Unknown image command: ${command}`);
		},
	};
}
