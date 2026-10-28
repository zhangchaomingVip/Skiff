import assert from "node:assert/strict";
import test from "node:test";
import { openPreviewTab, resolveBrowseProject, type PreviewTab } from "../src/workbench/projectWorkbench";

const incoming = (path: string, projectId = "one") => ({ projectId, projectName: projectId, root: `C:\\${projectId}`, path, name: path, mode: "file" as const });

test("preview tabs use global FIFO without promoting an existing tab", () => {
	let tabs: PreviewTab[] = [];
	for (const path of ["A.ts", "B.ts", "C.ts"]) tabs = openPreviewTab(tabs, incoming(path)).tabs;
	const reopened = openPreviewTab(tabs, { ...incoming("A.ts"), mode: "diff" });
	assert.deepEqual(reopened.tabs.map((tab) => tab.path), ["A.ts", "B.ts", "C.ts"]);
	assert.equal(reopened.tabs[0].mode, "diff");
	tabs = openPreviewTab(reopened.tabs, incoming("D.ts", "two")).tabs;
	assert.deepEqual(tabs.map((tab) => tab.path), ["B.ts", "C.ts", "D.ts"]);
});

test("same file names in different projects get distinct preview identities", () => {
	const first = openPreviewTab([], incoming("README.md", "one"));
	const second = openPreviewTab(first.tabs, incoming("README.md", "two"));
	assert.equal(second.tabs.length, 2);
	assert.notEqual(second.tabs[0].id, second.tabs[1].id);
});

test("manual browse selection survives chat changes and invalid selection falls back", () => {
	const projects = [{ id: "one", name: "One", path: "C:\\one" }, { id: "two", name: "Two", path: "C:\\two" }];
	assert.equal(resolveBrowseProject(projects, "two", "one").project?.id, "one");
	const invalid = resolveBrowseProject(projects, "two", "missing");
	assert.equal(invalid.project?.id, "two");
	assert.equal(invalid.manualProjectId, undefined);
});
