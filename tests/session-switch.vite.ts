import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";

// A separate production entry/origin; never packages the mock with the desktop app.
export default defineConfig({
	plugins: [react(), {
		name: "session-switch-observer",
		enforce: "pre",
		load(id) {
			const path = id.replaceAll("\\", "/");
			const relative = path.slice(path.indexOf("/src/") + 1);
			if (process.env.SKIFF_SWITCH_BASELINE && path.includes("/src/") && /\.(tsx?|css)$/.test(path)) {
				return execFileSync("git", ["show", `${process.env.SKIFF_SWITCH_BASELINE}:${relative}`], { encoding: "utf8" });
			}
		},
		transform(code, id) {
			const path = id.replaceAll("\\", "/");
			// The probes add no lines. Preserve line mappings for trace inspection.
			const observed = (updated: string) => ({ code: updated, map: { version: 3, sources: [id], sourcesContent: [code], names: [], mappings: code.split("\n").map((_, index) => index ? "AACA" : "AAAA").join(";") } });
			if (path.endsWith("/src/chat/parse.ts")) return observed(code.replace("const messages: ChatMessage[] = [];", "const restoreStarted = performance.now(); const messages: ChatMessage[] = [];").replace("return messages;", '(window as any).switchFixture?.timing("parseMessages", restoreStarted, raw.length); return messages;'));
			if (path.endsWith("/src/rpc/RpcClient.ts")) return observed(code.replace("data = JSON.parse(trimmed) as RpcEvent;", 'const parseStarted = performance.now(); data = JSON.parse(trimmed) as RpcEvent; (window as any).switchFixture?.timing("JSON.parse", parseStarted, trimmed.length);'));
			if (path.endsWith("/src/chat/workspace.ts")) return observed(code.replace('localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...workspace, chats: workspace.chats.filter((c) => c.hasMessages || c.id === workspace.activeId) }));', 'const serializeStarted = performance.now(); const serialized = JSON.stringify({ ...workspace, chats: workspace.chats.filter((c) => c.hasMessages || c.id === workspace.activeId) }); (window as any).switchFixture?.timing("workspace.stringify", serializeStarted, serialized.length); const persistStarted = performance.now(); localStorage.setItem(STORAGE_KEY, serialized); (window as any).switchFixture?.timing("workspace.localStorage", persistStarted, serialized.length);'));
			if (!path.endsWith("/src/App.tsx")) return;
			return observed(code.replace("const { state, connected, rawLines, actions } = session;", "const { state, connected, rawLines, actions } = session; (window as any).switchFixture?.render({ session, id: activeChat?.id, owner: session.owner, state, connected, pending: session.pending, rawLines, sessionFile: session.sessionFile, elapsedMs: session.elapsedMs });").replace("const displayState = { ...state, model: displayModel, availableModels: displayModels };", "const displayState = { ...state, model: displayModel, availableModels: displayModels }; (window as any).switchFixture?.derived({ selectModel, routeEvents, modelNotice });"));
		},
	}],
	build: {
		sourcemap: true,
		outDir: process.env.SKIFF_SWITCH_OUT ?? "dist/session-switch",
		emptyOutDir: true,
		rollupOptions: { input: "tests/session-switch.html" },
	},
	resolve: process.env.SKIFF_SWITCH_PROFILE ? { alias: { "react-dom/client": "react-dom/profiling" } } : undefined,
});
