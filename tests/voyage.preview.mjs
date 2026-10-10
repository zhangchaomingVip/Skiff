// Controlled clock and interval callbacks; never contacts a real pi process.
import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { useVoyageMetrics } from "../src/chat/useVoyageMetrics";
import { ContextUsage } from "../src/components/ContextUsage";
import { VoyageRail } from "../src/components/VoyageRail";
import "../src/tokens.css";
import "../src/index.css";
import "../src/voyage.css";
import "../src/components/ui.css";

let now = 1000;
Date.now = () => now;
const intervals = new Map();
let sequence = 0;
window.setInterval = (callback) => { const id = ++sequence; intervals.set(id, callback); return id; };
window.clearInterval = (id) => intervals.delete(id);
const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get("theme") ?? "light";
const root = createRoot(document.getElementById("root"));
const initial = { messages: [], isStreaming: false, model: { id: "preview", provider: "mock", contextWindow: 1000 } };
const harness = {
	metrics: undefined,
	render: undefined,
	advance(ms) { now += ms; for (const callback of intervals.values()) callback(); },
	intervalCount: () => intervals.size,
	unmount: () => root.unmount(),
};
window.voyageHarness = harness;
function Harness() {
	const [state, setState] = useState(initial);
	const [expanded, setExpanded] = useState(true);
	harness.render = setState;
	const metrics = useVoyageMetrics(state.messages, state.model, state.isStreaming, [], state.activeRun);
	harness.metrics = metrics;
	const toggle = () => setExpanded((value) => !value);
	return React.createElement("div", { className: `chat-and-rail ${expanded ? "rail-expanded" : "rail-collapsed"}`, style: { height: "100vh" } },
		React.createElement("div", { className: "chat-column" }, React.createElement("div", { style: { flex: 1 } }), React.createElement(ContextUsage, { metrics, expanded, onToggle: toggle, notice: "模型已切换，当前使用预览线路。" })),
		React.createElement(VoyageRail, { metrics, expanded, onToggle: toggle }));
}
root.render(React.createElement(StrictMode, null, React.createElement(Harness)));
