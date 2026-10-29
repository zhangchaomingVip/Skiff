import assert from "node:assert/strict";
import test from "node:test";
import { openPreviewTab, projectRelativePath, resolveBrowseProject, selectedChangeCounts, type GitEntry, type PreviewTab } from "../src/workbench/projectWorkbench";

test("tool file paths resolve to the same project-relative preview identity", () => {
	for (const path of ["src/App.tsx", ".\\src\\App.tsx", "src/../src/App.tsx", "D:\\workspace\\Skiff\\src\\App.tsx", "d:/WORKSPACE/skiff/src/App.tsx"]) {
		assert.equal(projectRelativePath("D:\\workspace\\Skiff", path), "src/App.tsx");
	}
	assert.equal(projectRelativePath("/workspace/skiff/", "/workspace/skiff/src/App.tsx"), "src/App.tsx");
	assert.equal(projectRelativePath("\\\\server\\share\\project", "\\\\SERVER\\share\\project\\demo.txt"), "demo.txt");
	for (const path of ["../outside.txt", "src/../../outside.txt", "D:/workspace/Skiff-copy/demo.txt", "C:/other/demo.txt", "D:/workspace/Skiff/../outside.txt", "D:demo.txt", "", "."]) {
		assert.equal(projectRelativePath("D:\\workspace\\Skiff", path), undefined, path);
	}
	assert.equal(projectRelativePath("/workspace/skiff", "/workspace/SKIFF/demo.txt"), undefined);
});

test("commit counts classify selected untracked files as additions and exclude disabled or stale paths", () => {
	const entries = ["modified", "added", "untracked", "deleted", "renamed", "conflict"].map((kind) => ({ path: kind, kind, selectable: kind !== "conflict" })) as GitEntry[];
	assert.deepEqual(selectedChangeCounts(entries, []), { added: 0, modified: 0, deleted: 0, renamed: 0 });
	assert.deepEqual(selectedChangeCounts(entries, ["untracked", "untracked", "modified", "stale", "conflict"]), { added: 1, modified: 1, deleted: 0, renamed: 0 });
	assert.deepEqual(selectedChangeCounts(entries, entries.map((entry) => entry.path)), { added: 2, modified: 1, deleted: 1, renamed: 1 });
});

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
