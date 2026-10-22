import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { drafts, DraftStore, type DraftRecord } from "../src/chat/drafts";
import { useDraft, type DraftTarget } from "../src/chat/useDraft";
import { Composer } from "../src/components/Composer";
import "../src/tokens.css";
import "../src/index.css";
import "../src/components/ui.css";

const ids = ["first", "second", "empty", "missing", "incompatible", "attachment", "stale", "removed", "send", "clear"];
const records: DraftRecord[] = ids.map((chatId) => ({ chatId, cwd: "project", revision: 1, text: ["empty", "missing", "attachment"].includes(chatId) ? "" : `${chatId} restored`, attachments: chatId === "missing" ? [{ id: "file", name: "missing.txt", kind: "text", bytes: 10, needsReattach: true }] : chatId === "attachment" ? [{ id: "file", name: "saved.txt", kind: "text", body: "saved contents", bytes: 14 }] : [] }));
const database = await new Promise<IDBDatabase>((resolve, reject) => {
	const request = indexedDB.open("skiff-drafts", 1);
	request.onupgradeneeded = () => request.result.createObjectStore("drafts", { keyPath: "chatId" });
	request.onsuccess = () => resolve(request.result);
	request.onerror = () => reject(request.error);
});
await new Promise<void>((resolve) => { const transaction = database.transaction("drafts", "readwrite"); const store = transaction.objectStore("drafts"); store.clear(); records.forEach((record) => store.put(record)); transaction.oncomplete = () => resolve(); });
database.close();
if (new URLSearchParams(location.search).has("load-failure")) Object.defineProperty(window, "indexedDB", { value: undefined });
await drafts.hydrate(ids);
const model = { provider: "mock", id: "mock", name: "Mock", input: ["text", "image"] };
const noop = () => {};
const commands = async () => [];
function DraftPreview() {
	const [target, setTarget] = useState<DraftTarget>({ chatId: "first", cwd: "project" });
	const [mounted, setMounted] = useState(true);
	(window as any).draftRecovery = { drafts, DraftStore, target: (chatId: string, cwd = "project") => setTarget({ chatId, cwd }), unmount: () => setMounted(false), mount: () => setMounted(true) };
	return <main className="chat"><nav>{ids.map((id) => <button key={id} onClick={() => setTarget({ chatId: id, cwd: id === "incompatible" ? "other-project" : "project" })}>{id}</button>)}</nav>{mounted && <DraftComposer target={target} />}</main>;
}
function DraftComposer({ target }: { target: DraftTarget }) {
	const draft = useDraft(target);
	return <>{draft.notice && <p className="draft-notice" role="status">{draft.notice}</p>}{draft.attachments.filter((item) => item.body === undefined).map((item) => <p key={item.id}>需要重新添加 {item.name}<button onClick={() => draft.removeMissing(item.id)}>移除</button></p>)}<Composer disabled={draft.attachments.some((item) => item.body === undefined)} streaming={false} onSend={async () => true} onAbort={noop} text={draft.text} onTextChange={draft.onText} models={[model]} model={model} onSelectModel={noop} connected modelDisabled={false} thinkingLevels={[]} onThinkingLevel={noop} focusSignal={0} restoredImages={draft.restored.images} restoredFiles={draft.restored.files} editing={false} onCancelEdit={noop} getCommands={commands} onAttachmentsChange={draft.onAttachments} recoveryNotice={draft.recoveryNotice} /></>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><DraftPreview /></StrictMode>);
