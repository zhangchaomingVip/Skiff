import test from "node:test";
import assert from "node:assert/strict";
import { trimPayload, IMAGE_PLACEHOLDER, TEXT_PLACEHOLDER } from "../src-tauri/src/pi_extensions/payload-budget.js";

const imageUrl = (chars: number) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${"x".repeat(chars)}` } });
const sourceImage = (chars: number) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "x".repeat(chars) } });

test("payload budget drops the oldest inline images first", () => {
	const payload = { messages: [
		{ role: "user", content: [imageUrl(500 * 1024)] },
		{ role: "user", content: [imageUrl(500 * 1024)] },
	] };
	trimPayload(payload, "openai-completions");
	assert.equal(payload.messages[0].content[0].type, "text");
	assert.equal(payload.messages[0].content[0].text, IMAGE_PLACEHOLDER);
	assert.equal(payload.messages[1].content[0].type, "image_url");
});

test("payload budget leaves under-budget payloads untouched", () => {
	const payload = { messages: [{ role: "user", content: [imageUrl(100 * 1024)] }] };
	const before = JSON.stringify(payload);
	trimPayload(payload, "openai-completions");
	assert.equal(JSON.stringify(payload), before);
});

test("payload budget truncates the oldest tool-result text once images cannot fit", () => {
	const longText = "x".repeat(900 * 1024);
	const payload = { messages: [{ role: "tool", content: [{ type: "text", text: longText }] }] };
	trimPayload(payload, "openai-completions");
	const text = payload.messages[0].content[0].text;
	assert.ok(text.length < longText.length);
	assert.ok(text.endsWith(TEXT_PLACEHOLDER));
});

test("payload budget handles anthropic source blocks and responses input", () => {
	const anthropic = { messages: [{ role: "user", content: [sourceImage(500 * 1024), sourceImage(500 * 1024)] }] };
	trimPayload(anthropic, "anthropic-messages");
	assert.equal(anthropic.messages[0].content[0].type, "text");
	assert.equal(anthropic.messages[0].content[1].type, "image");

	const responses = { input: [{ role: "user", content: [{ type: "input_image", image_url: `data:image/jpeg;base64,${"y".repeat(900 * 1024)}` }] }] };
	trimPayload(responses, "openai-responses");
	assert.equal(responses.input[0].content[0].type, "input_text");
	assert.equal(responses.input[0].content[0].text, IMAGE_PLACEHOLDER);
});
