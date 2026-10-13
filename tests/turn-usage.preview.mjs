import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MessageList } from "../src/components/MessageList";
import { ModelFamilyContext } from "../src/chat/familyContext";
import { parseMessages } from "../src/chat/parse";
import "../src/tokens.css";
import "../src/index.css";
import "../src/components/ui.css";

const root = createRoot(document.getElementById("root"));
const noop = () => {};
const model = { provider: "mock", id: "mock", currency: "CNY", cost: { input: 1, output: 2 } };
window.turnUsageHarness = {
	render({ messages, ...props }) {
		root.render(React.createElement(StrictMode, null,
			React.createElement(ModelFamilyContext.Provider, { value: { models: [model], familyOf: noop, manage: noop } },
				React.createElement(MessageList, {
					messages: parseMessages(messages), running: false, models: [model], model,
					onSuggestion: noop, followSignal: 0, disabled: false, onContinue: noop,
					onEdit: noop, onRegenerate: noop, onDelete: noop, ...props,
				}))),
		);
	},
};
