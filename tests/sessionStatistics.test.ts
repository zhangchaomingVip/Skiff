import assert from "node:assert/strict";
import test from "node:test";
import { cacheHitRate, collectStatistics, groupStatistics, rangeStart, showCost, statisticsTargets, statisticsTrend, summarizeStatistics, totalTokens, type StatisticsProjection } from "../src/chat/sessionStatistics";
import { snapshotForOffer } from "../src/chat/routeSnapshot";
import type { RuntimeOffer } from "../src/chat/modelFamilies";
import type { Conversation, Project } from "../src/chat/workspace";

const now = new Date(2026, 10, 19, 12).getTime();
const date = (days: number) => new Date(2026, 10, 19 + days, 12).getTime();
const projects: Project[] = [{ id: "a", name: "Project A", path: "D:\\ProjectA" }, { id: "b", name: "Project B", path: "/project-b", hiddenAt: now }];
const offer: RuntimeOffer = { providerKey: "relay-family-a", relayId: "relay-a", relayName: "Relay A", familyId: "a", familyName: "A", modelId: "model-a", inputCost: 4, outputCost: 8, cacheReadCost: 1, cacheWriteCost: 5, currency: "USD", maxTokens: 1000, contextWindow: 30000 };
const modelB = { ...offer, providerKey: "relay-family-b", modelId: "model-b", currency: "CNY" as const };
const snapshot = snapshotForOffer(offer);
const chat = (id: string, projectId: string): Conversation => ({ id, projectId, title: `Chat ${id}`, sessionFile: `${id}.jsonl`, hasMessages: true, updatedAt: now });
const original = { ...chat("original", "a"), archivedAt: now, routeSnapshots: [snapshot, snapshot] };
const fork = chat("fork", "b");
const chats = [fork, original];
const use = { input: 100, output: 50, cacheRead: 400, cacheWrite: 50 };
const row = { provider: offer.providerKey, model: offer.modelId, timestamp: date(-1), usage: use, entryTimestamp: "original-entry-ts", id: "entry", assistantIndex: 0 };
const image = { id: "one", serviceId: "relay-a", serviceName: "Image Relay", modelId: "image-model", projectRoot: "d:/projecta/", createdAt: date(-40), completedAt: date(-1) };
const video = { ...image, serviceName: "Video Relay", modelId: "video-model", projectRoot: null, completedAt: null };
const data: StatisticsProjection = { skippedSessions: 0, skippedMedia: 0, images: [image, image], videos: [video], sessions: [
	{ chatId: "fork", forked: true, startedAt: new Date(now).toISOString(), requests: [row, { ...row, id: "entry-2", provider: modelB.providerKey, model: modelB.modelId }] },
	{ chatId: "original", forked: false, startedAt: new Date(date(-2)).toISOString(), requests: [row, { provider: "retired", model: "same-id-rather-than-same-provider", stopReason: "error", assistantIndex: 1, timestamp: date(-1) }, { provider: "unknown", model: "no-timestamp" }] },
] };

test("archives and hidden projects are indexed; drafts and invalid project IDs aren't", () => {
	assert.deepEqual(statisticsTargets([...chats, { ...chat("draft", "a"), sessionFile: undefined }, chat("orphan", "c")], projects), [
		{ chatId: "fork", sessionFile: "fork.jsonl", cwd: "/project-b" }, { chatId: "original", sessionFile: "original.jsonl", cwd: "D:\\ProjectA" },
	]);
});

test("preserves recorded prices, attributes shared fork entries once, and separates media from text usage", () => {
	const rows = collectStatistics(data, chats, projects, [{ ...offer, inputCost: 200 }, modelB]);
	const a = rows.find((row) => row.model.label === offer.modelId)!;
	assert.equal(a.project.label, "Project A");
	assert.equal(a.estimated, false);
	assert.ok(Math.abs(a.cost!.USD! - 0.00145) < 1e-12);
	assert.equal(rows.find((row) => row.model.label === modelB.modelId)?.estimated, true);
	assert.equal(rows.find((row) => row.provider.label === "retired")?.cost, undefined);
	const totals = summarizeStatistics(rows);
	assert.deepEqual([totals.request, totals.image, totals.video, totals.unpriced, totals.estimates], [4, 1, 1, 2, 1]);
	assert.deepEqual(totals.tokens, { input: 200, output: 100, cacheRead: 800, cacheWrite: 100 });
	assert.equal(totalTokens(totals.tokens), 1200);
	assert.equal(cacheHitRate(totals.tokens), 800 / 1100);
	assert.equal(showCost(totals.cost), "¥0.00145 + $0.00145");
	const provider = groupStatistics(rows, "provider");
	assert.equal(provider.find((group) => group.label === "Relay A")?.totals.request, 2);
	assert.equal(provider.find((group) => group.label === "Image Relay · 图片")?.totals.image, 1);
	assert.equal(provider.find((group) => group.label === "Video Relay · 视频")?.totals.video, 1);
	const project = groupStatistics(rows, "project");
	assert.equal(project.find((group) => group.label === "Project A")?.totals.image, 1);
	assert.equal(project.find((group) => group.label === "Project B")?.totals.request, 1);
	assert.equal(project.find((group) => group.label === "未归属项目")?.totals.video, 1);
});

test("groups local calendar dates with zero-filled buckets and uses media completion time when known", () => {
	const rows = collectStatistics(data, chats, projects, []);
	assert.equal(rangeStart("7", now), new Date(2026, 10, 13).getTime());
	const week = statisticsTrend(rows, "7", now);
	assert.equal(week.points.length, 7);
	assert.equal(week.points[0].totals.request, 0);
	assert.equal(week.points[5].totals.image, 1);
	assert.equal(week.points[5].totals.request, 3);
	assert.equal(week.points[5].totals.video, 0);
	const all = statisticsTrend([...rows, { ...rows[0], at: date(-150) }], "all", now);
	assert.equal(all.monthly, true);
	assert.equal(all.points.reduce((sum, point) => sum + point.totals.video, 0), 1);
});
