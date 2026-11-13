import assert from "node:assert/strict";
import { test } from "node:test";
import { readWorkspaceNavigation, selectWorkspaceTool, workspaceNavigationKey } from "../src/workbench/workspaceMode";

const storage = (values: Record<string, string>) => ({ getItem: (key: string) => values[key] ?? null });
test("workspace modes migrate legacy tools and keep independent Code and Design routes", () => {
	assert.deepEqual(readWorkspaceNavigation(storage({})), { workspaceMode: "code", codeTool: "chats", designTool: "image-generation" });
	const legacy = readWorkspaceNavigation(storage({ "skiff.workbench.v1": JSON.stringify({ tool: "video-generation" }) }));
	assert.equal(legacy.workspaceMode, "design"); assert.equal(legacy.designTool, "video-generation");
	const code = selectWorkspaceTool(legacy, "git-tree");
	const design = selectWorkspaceTool(code, "image-generation");
	assert.equal(design.codeTool, "git-tree"); assert.equal(design.workspaceMode, "design");
	assert.deepEqual(readWorkspaceNavigation(storage({ [workspaceNavigationKey]: JSON.stringify(design) })), design);
});
test("damaged mode preferences fall back without accepting unknown tools", () => {
	assert.equal(readWorkspaceNavigation(storage({ [workspaceNavigationKey]: "{" })).workspaceMode, "code");
	const value = readWorkspaceNavigation(storage({ [workspaceNavigationKey]: JSON.stringify({ workspaceMode: "design", codeTool: "invalid", designTool: "invalid" }) }));
	assert.equal(value.codeTool, "chats"); assert.equal(value.designTool, "image-generation");
});
