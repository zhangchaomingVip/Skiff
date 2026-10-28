import test from "node:test";
import assert from "node:assert/strict";

const extensionUrl = new URL("../src-tauri/src/pi_extensions/system_prompt.js", import.meta.url).href;
const { default: setup } = await import(extensionUrl);
const hint = "You can inspect PI_* environment variables for current model and session details.";

test("Skiff removes only the shell model-lookup hint, preserving other prompt contributions and tools", () => {
	let handler!: (event: { systemPromptOptions: typeof options }) => unknown;
	const options = {
		toolGuidelines: { bash: [hint, "Keep shell rules"], powershell: [` ${hint} `], read: ["Use read to examine files instead of cat or sed."] },
		selectedTools: ["read", "bash", "powershell", "edit", "write"],
		appendSystemPrompt: `User-authored text may mention ${hint}`,
		contextFiles: [{ path: "AGENTS.md", content: "Project instructions" }],
		skills: [{ name: "example", description: "Keep skills" }],
		sections: { custom: "Keep custom sections" },
	};
	const expected = structuredClone(options);
	expected.toolGuidelines.bash = ["Keep shell rules"];
	expected.toolGuidelines.powershell = [];
	setup({ on: (name: string, callback: typeof handler) => { assert.equal(name, "before_agent_start"); handler = callback; } });
	assert.equal(handler({ systemPromptOptions: options }), undefined, "Must not force-replace the complete prompt");
	assert.deepEqual(options, expected);
	handler({ systemPromptOptions: options });
	assert.deepEqual(options, expected, "Repeated runs must be idempotent");
});

test("sessions without shell prompt contributions remain unchanged", () => {
	let handler!: (event: object) => unknown;
	setup({ on: (_name: string, callback: typeof handler) => { handler = callback; } });
	const event = { systemPromptOptions: { toolGuidelines: { read: ["Keep read rules"] } } };
	const expected = structuredClone(event);
	assert.doesNotThrow(() => handler({}));
	handler(event);
	assert.deepEqual(event, expected);
});
