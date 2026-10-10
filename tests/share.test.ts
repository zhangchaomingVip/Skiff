import test from "node:test";
import assert from "node:assert/strict";
import { conversationToShareMarkdown, messageToShareMarkdown } from "../src/chat/share.ts";

test("share formatter includes the complete user and assistant transcript", () => {
	const text = conversationToShareMarkdown("修复登录", [
		{ id: "u", role: "user", blocks: [{ kind: "text", text: "请修复登录" }] },
		{ id: "a", role: "assistant", blocks: [{ kind: "text", text: "已经修复。" }] },
	]);
	assert.equal(text, "# 修复登录\n\n## 你\n\n请修复登录\n\n## Skiff\n\n已经修复。\n");
});

test("share formatter keeps images and tool output readable", () => {
	const text = messageToShareMarkdown({ id: "a", role: "assistant", blocks: [
		{ kind: "image", data: "abc", mimeType: "image/png" },
		{ kind: "tool", id: "1", name: "read", argsText: '{"path":"a.ts"}', done: true },
		{ kind: "toolResult", name: "read", text: "ok", isError: false },
	] });
	assert.match(text, /!\[图片\]\(data:image\/png;base64,abc\)/);
	assert.match(text, /工具调用：read/);
	assert.match(text, /工具结果：read/);
});
