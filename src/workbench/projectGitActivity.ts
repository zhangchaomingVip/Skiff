import type { ChatMessage } from "../chat/types";

/** Observe every live conversation, including agents running in background chats. */
export class ProjectGitActivity {
	private previous = new Map<string, { results: Set<string>; running: boolean }>();

	update(messages: Map<string, ChatMessage[]>, runningIds: Set<string>, roots: Map<string, string>): Set<string> {
		const changed = new Set<string>();
		for (const [chatId, history] of messages) {
			const root = roots.get(chatId);
			if (!root) continue;
			const results = new Set(history.flatMap((message) => message.blocks.flatMap((block, index) => block.kind === "toolResult" && /^(write|edit|apply_patch|bash|shell|exec|execute|write_file|edit_file)$/i.test(block.name) ? [`${message.id}:${block.id ?? index}`] : [])));
			const before = this.previous.get(chatId);
			const running = runningIds.has(chatId);
			// Initial history hydration isn't a new file change. Run completion also
			// catches custom tools and commands whose side effects aren't declared.
			if (before && ((before.running && !running) || [...results].some((id) => !before.results.has(id)))) changed.add(root);
			this.previous.set(chatId, { results, running });
		}
		for (const id of this.previous.keys()) if (!roots.has(id)) this.previous.delete(id);
		return changed;
	}
}
