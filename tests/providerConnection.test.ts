import test from "node:test";
import assert from "node:assert/strict";
import { slowOrFailedModels, testModelsConcurrently } from "../src/chat/providerConnection.ts";

const success = { ok: true, latencyMs: 20, status: 200, error: null };

test("model speed tests keep five requests active and process every model once", async () => {
	const models = Array.from({ length: 13 }, (_, index) => `model-${index}`);
	let active = 0;
	let peak = 0;
	const results: string[] = [];
	const tokens = new Set<string>();
	await testModelsConcurrently(models, {
		concurrency: 5, isCancelled: () => false,
		onStart: (_model, id) => { assert.ok(!tokens.has(id)); tokens.add(id); },
		onResult: (model) => { results.push(model); },
		test: async (model) => {
			peak = Math.max(peak, ++active);
			await new Promise((resolve) => setTimeout(resolve, 5));
			active--;
			if (model === "model-3") throw new Error("request failed");
			return success;
		},
	});
	assert.equal(peak, 5);
	assert.deepEqual(results.sort(), [...models].sort());
});

test("stopping the pool launches no queued models and discards late results", async () => {
	let cancelled = false;
	const pending: (() => void)[] = [];
	const started: string[] = [];
	const completed: string[] = [];
	const pool = testModelsConcurrently(Array.from({ length: 20 }, (_, index) => `${index}`), {
		concurrency: 5, isCancelled: () => cancelled,
		onStart: (model) => { started.push(model); },
		onResult: (model) => { completed.push(model); },
		test: () => new Promise((resolve) => { pending.push(() => resolve(success)); }),
	});
	assert.equal(started.length, 5);
	cancelled = true;
	for (const resolve of pending) resolve();
	await pool;
	assert.equal(started.length, 5);
	assert.deepEqual(completed, []);
});

test("slow-model removal includes failures and only successes above the chosen threshold", () => {
	assert.deepEqual(slowOrFailedModels([
		{ ...success, modelId: "fast", latencyMs: 400 },
		{ ...success, modelId: "boundary", latencyMs: 10000 },
		{ ...success, modelId: "slow", latencyMs: 10001 },
		{ ...success, modelId: "failed", ok: false, latencyMs: 5, status: 401 },
	], 10000), ["slow", "failed"]);
});
