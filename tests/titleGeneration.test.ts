import test from "node:test";
import assert from "node:assert/strict";
import {
	buildTitlePrompt,
	cleanTitleReply,
	loadTitleModelSelection,
	saveTitleModelSelection,
	titleOfferCandidates,
	titleSummaryNeeded,
	TITLE_PROMPT_MARKER,
} from "../src/chat/titleGeneration.ts";
import type { RuntimeOffer } from "../src/chat/modelFamilies.ts";
import type { ChatMessage } from "../src/chat/types.ts";

const user = (text: string) => ({ id: "u1", role: "user", timestamp: 0, blocks: [{ kind: "text", text }], streaming: false }) as ChatMessage;
const assistant = (text: string) => ({ id: "a1", role: "assistant", timestamp: 1, blocks: [{ kind: "text", text }], streaming: false }) as ChatMessage;

const offer = (providerKey: string, modelId: string): RuntimeOffer => ({
	familyId: "kimi", familyName: "Kimi", relayId: "r1", relayName: "中转 A", providerKey, modelId,
	inputCost: 0, outputCost: 0, currency: "CNY", maxTokens: 8192, contextWindow: 128000,
});

test("title prompt carries the user turn and asks for a short title", () => {
	const prompt = buildTitlePrompt([user("帮我写一个登录页面"), assistant("好的，我来实现。")])!;
	assert.ok(prompt.includes(TITLE_PROMPT_MARKER));
	assert.ok(prompt.includes("用户：帮我写一个登录页面"));
	assert.ok(prompt.includes("助手：好的，我来实现。"));
	assert.equal(buildTitlePrompt([assistant("没有用户消息")]), undefined);
	assert.equal(buildTitlePrompt([]), undefined);
});

test("AI summary only pays off when the first message outgrows the truncated title", () => {
	const long = "你在这个项目下的每个子目录中新增一个文件，并检查所有文件的内容是否正确";
	assert.equal(Array.from(long).length > 32, true);
	assert.equal(titleSummaryNeeded([user(long)]), true);
	assert.equal(titleSummaryNeeded([user("帮我写一个登录页面")]), false);
	assert.equal(titleSummaryNeeded([user("短消息".repeat(11))]), true);
	assert.equal(titleSummaryNeeded([assistant("只有助手消息")]), false);
	assert.equal(titleSummaryNeeded([]), false);
});

test("title candidates prefer the primary and fall back when it no longer resolves", () => {
	const offers = [offer("skiff-relay-r1", "kimi-k3"), offer("skiff-relay-r2", "deepseek-chat")];
	const primary = { provider: "skiff-relay-r1", id: "kimi-k3" };
	const fallback = { provider: "skiff-relay-r2", id: "deepseek-chat" };
	assert.deepEqual(titleOfferCandidates({ primary, fallback }, offers).map((item) => item.providerKey), ["skiff-relay-r1", "skiff-relay-r2"]);
	// The saved primary is gone from the offers, so only the backup survives.
	assert.deepEqual(titleOfferCandidates({ primary: { provider: "skiff-relay-x", id: "gone" }, fallback }, offers).map((item) => item.providerKey), ["skiff-relay-r2"]);
	// Duplicate slots collapse to a single attempt.
	assert.equal(titleOfferCandidates({ primary, fallback: primary }, offers).length, 1);
	assert.deepEqual(titleOfferCandidates({}, offers), []);
});

test("cleanTitleReply strips quotes, markdown and trailing punctuation", () => {
	assert.equal(cleanTitleReply("登录页面实现"), "登录页面实现");
	assert.equal(cleanTitleReply("**登录页面实现**。"), "登录页面实现");
	assert.equal(cleanTitleReply("《登录页面实现》"), "登录页面实现");
	assert.equal(cleanTitleReply("\"登录页面实现\""), "登录页面实现");
	assert.equal(cleanTitleReply("标题：登录页面\n多余的解释"), "标题：登录页面");
	assert.equal(cleanTitleReply("   \n只有第二行"), "只有第二行");
	assert.equal(cleanTitleReply(""), undefined);
	assert.equal(cleanTitleReply("```\n代码块标题\n```"), "代码块标题");
});

test("cleanTitleReply caps the title length", () => {
	const long = "长".repeat(60);
	const title = cleanTitleReply(long)!;
	assert.equal([...title].length, 40);
});

test("title model selection persists and tolerates corrupt storage", () => {
	const map = new Map<string, string>();
	const stub = {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => void map.set(key, String(value)),
		removeItem: (key: string) => void map.delete(key),
		clear: () => map.clear(),
		key: (index: number) => [...map.keys()][index] ?? null,
		get length() { return map.size; },
	} as Storage;
	const original = (globalThis as Record<string, unknown>).localStorage;
	(globalThis as Record<string, unknown>).localStorage = stub;
	try {
		assert.deepEqual(loadTitleModelSelection(), {});
		const selection = { primary: { provider: "skiff-relay-r1", id: "kimi-k3", modelId: "kimi-k3", offerId: "route-r1/kimi-k3" }, fallback: { provider: "skiff-relay-r2", id: "deepseek-chat" } };
		saveTitleModelSelection(selection);
		assert.deepEqual(loadTitleModelSelection(), selection);
		map.set("skiff.titleModel.v1", "{broken json");
		assert.deepEqual(loadTitleModelSelection(), {});
	} finally {
		(globalThis as Record<string, unknown>).localStorage = original;
	}
});
