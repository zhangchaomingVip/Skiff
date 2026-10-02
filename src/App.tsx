import { useState } from "react";
import { usePiSession } from "./chat/usePiSession";
import { ChatView } from "./components/ChatView";
import { RawDrawer } from "./components/RawDrawer";
import { StatusBar } from "./components/StatusBar";

export default function App() {
	const { state, connected, rawLines, actions } = usePiSession();
	const [rawOpen, setRawOpen] = useState(false);

	return (
		<div className="app">
			<StatusBar
				connected={connected}
				streaming={state.isStreaming}
				model={state.model}
				models={state.availableModels}
				onSelectModel={actions.setModel}
				onNewSession={actions.newSession}
				rawOpen={rawOpen}
				onToggleRaw={() => setRawOpen((open) => !open)}
			/>
			<div className="body">
				<ChatView state={state} connected={connected} actions={actions} />
				{rawOpen && <RawDrawer lines={rawLines} />}
			</div>
		</div>
	);
}
