// Controlled clock and interval callbacks; never contacts a real pi process.
import React, { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useVoyageMetrics } from "../src/chat/useVoyageMetrics";
import { ContextUsage } from "../src/components/ContextUsage";
import { VoyageRail } from "../src/components/VoyageRail";
import { Dialog } from "../src/components/ui";
import "../src/tokens.css";
import "../src/index.css";
import "../src/voyage.css";
import "../src/components/ui.css";

let now = 1000;
Date.now = () => now;
const intervals = new Map();
const nativeSetInterval = window.setInterval.bind(window);
const nativeClearInterval = window.clearInterval.bind(window);
let sequence = 0;
let maxIntervals = 0;
// Vite's WebSocket heartbeat must keep its native clock and is not a voyage refresher.
window.setInterval = (callback, delay, ...args) => {
	if (delay !== 100) return nativeSetInterval(callback, delay, ...args);
	const id = --sequence; intervals.set(id, callback); maxIntervals = Math.max(maxIntervals, intervals.size); return id;
};
window.clearInterval = (id) => { if (!intervals.delete(id)) nativeClearInterval(id); };
const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get("theme") ?? "light";
const root = createRoot(document.getElementById("root"));
const initial = { messages: [], isStreaming: false, model: { id: "preview", provider: "mock", contextWindow: 1000 } };
const harness = {
	metrics: undefined,
	render: undefined,
	advance(ms) { now += ms; for (const callback of intervals.values()) callback(); },
	intervalCount: () => intervals.size,
	maxIntervalCount: () => maxIntervals,
	unmount: () => root.unmount(),
};
window.voyageHarness = harness;
function Harness() {
	const [state, setState] = useState(initial);
	harness.render = setState;
	return React.createElement(MetricsView, { key: state.sessionId ?? "session", state });
}
function MetricsView({ state }) {
	const [expanded, setExpanded] = useState(true);
	const [narrow, setNarrow] = useState(() => innerWidth <= 760);
	useEffect(() => {
		const query = matchMedia("(max-width: 760px)");
		const update = () => setNarrow(query.matches);
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);
	const metrics = useVoyageMetrics(state.messages, state.model, state.isStreaming, [], state.activeRun, state.lastError, state.abortedRunKey, state.voyageTimeline);
	harness.metrics = metrics;
	const toggle = () => setExpanded((value) => !value);
	return React.createElement("div", { className: `chat-and-rail ${expanded ? "rail-expanded" : "rail-collapsed"}`, style: { height: "100vh" } },
		React.createElement("div", { className: "chat-column" }, React.createElement("div", { style: { flex: 1 } }), React.createElement(ContextUsage, { metrics, expanded, onToggle: toggle, notice: "模型已切换，当前使用预览线路。" })),
		narrow && expanded ? React.createElement(Dialog, { className: "voyage-dialog", "aria-label": "航行台详情", returnFocusSelector: ".voyage-summary", onClose: toggle }, React.createElement(VoyageRail, { metrics, expanded, onToggle: toggle })) : React.createElement(VoyageRail, { metrics, expanded, onToggle: toggle }));
}
root.render(React.createElement(StrictMode, null, React.createElement(Harness)));
