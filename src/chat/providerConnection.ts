import type { TestResult } from "./useModelFamilies";

/** A bounded worker pool; cancellation prevents queued work and late results. */
export async function testModelsConcurrently(models: string[], options: {
	concurrency: number;
	isCancelled: () => boolean;
	onStart: (model: string, requestId: string) => void;
	onResult: (model: string, result: TestResult) => void;
	test: (model: string, requestId: string) => Promise<TestResult>;
}): Promise<void> {
	let next = 0;
	const worker = async () => {
		while (!options.isCancelled() && next < models.length) {
			const model = models[next++];
			const requestId = crypto.randomUUID();
			options.onStart(model, requestId);
			const started = Date.now();
			let result: TestResult;
			try { result = await options.test(model, requestId); }
			catch (error) { result = { ok: false, latencyMs: Date.now() - started, status: null, error: String(error) }; }
			if (options.isCancelled()) return;
			options.onResult(model, result);
		}
	};
	await Promise.all(Array.from({ length: Math.min(Math.max(1, Math.floor(options.concurrency)), models.length) }, worker));
}

export function slowOrFailedModels(results: (TestResult & { modelId: string })[], thresholdMs: number): string[] {
	return results.filter((result) => !result.ok || result.latencyMs > thresholdMs).map((result) => result.modelId);
}
