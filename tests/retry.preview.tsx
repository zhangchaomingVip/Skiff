import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { usePiSession } from "../src/chat/usePiSession";
import { VoyageWorkspace } from "../src/components/VoyageWorkspace";
import { installMockPi } from "./mockPi.mjs";
import "../src/tokens.css";
import "../src/index.css";
import "../src/voyage.css";
import "../src/components/ui.css";

document.documentElement.dataset.theme = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
const fixture = { mock: installMockPi(window), currentSession: undefined as ReturnType<typeof usePiSession> | undefined };
(window as any).retryFixture = fixture;
function Harness() {
	const session = usePiSession({ id: "retry", cwd: "D:\\workspace\\demo" });
	fixture.currentSession = session;
	return <VoyageWorkspace state={session.state} connected={session.connected} pending={session.pending} actions={session.actions} onSend={session.actions.prompt} onReconnect={session.reconnect} />;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>);
