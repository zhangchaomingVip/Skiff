import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePiSession, type SessionTarget } from "./usePiSession";
import type { RuntimeOffer } from "./modelFamilies";
import type { FamiliesConfig } from "./useModelFamilies";
import { snapshotsForMessages } from "./routeSnapshot";
import { isArchived, type Conversation, type Project } from "./workspace";

type PiSession = ReturnType<typeof usePiSession>;
type Configuration = { config?: FamiliesConfig; ready: boolean };
const sessionKey = (target: SessionTarget) => JSON.stringify([target.id, target.cwd]);

/** Runs independently of the visible transcript, including metadata persistence. */
function SessionRuntime({ target, chat, offers, configuration, report, updateChat }: {
	target: SessionTarget;
	chat: Conversation;
	offers: readonly RuntimeOffer[];
	configuration: Configuration;
	report: (key: string, session: PiSession) => void;
	updateChat: (id: string, patch: Partial<Conversation>) => void;
}) {
	const session = usePiSession(target, offers, configuration);
	useEffect(() => { report(sessionKey(target), session); }, [target.id, target.cwd, session, report]);
	const latest = useRef({ chat, offers, updateChat });
	latest.current = { chat, offers, updateChat };
	useEffect(() => {
		if (!session.isCurrent() || session.loadedId !== target.id) return;
		const { chat, offers, updateChat } = latest.current;
		const { state } = session;
		const firstUser = state.messages.find((message) => message.role === "user");
		const title = firstUser?.blocks.filter((block) => block.kind === "text").map((block) => block.text).join(" ").replace(/\s+/g, " ").trim() || (firstUser ? "图片聊天" : "");
		const patch: Partial<Conversation> = {
			...(session.sessionFile ? { sessionFile: session.sessionFile } : {}),
			hasMessages: !!firstUser,
			...(!chat.customTitle ? { title: title ? title.slice(0, 48) : "新聊天" } : {}),
			elapsedMs: session.elapsedMs,
		};
		if (state.model) {
			const model = state.model;
			const offer = offers.find((item) => (model.routeId && item.routeId === model.routeId && item.modelId === model.id) || (item.providerKey === model.provider && item.modelId === model.id));
			const selectedModel = { provider: model.provider, id: model.id, modelId: model.modelId ?? model.id, routeId: offer?.routeId ?? model.routeId, offerId: offer?.offerId ?? model.offerId };
			if (JSON.stringify(chat.selectedModel) !== JSON.stringify(selectedModel)) patch.selectedModel = selectedModel;
		}
		const routeSnapshots = snapshotsForMessages(state.messages);
		if (JSON.stringify(chat.routeSnapshots) !== JSON.stringify(routeSnapshots)) patch.routeSnapshots = routeSnapshots;
		updateChat(target.id, patch);
	}, [session.isCurrent, session.loadedId, session.sessionFile, session.elapsedMs, session.state.messages, session.state.model, target.id]);
	return null;
}

/** Open conversations own separate hooks/processes; navigation only selects a projection. */
export function usePiSessions(activeId: string | undefined, chats: Conversation[], projects: Project[], offers: readonly RuntimeOffer[], configuration: Configuration, updateChat: (id: string, patch: Partial<Conversation>) => void) {
	const empty = usePiSession();
	const [sessions, setSessions] = useState<Map<string, PiSession>>(() => new Map());
	const visited = useRef(new Set<string>());
	const targets = chats.flatMap((chat) => {
		const project = projects.find((item) => item.id === chat.projectId);
		return project && !isArchived(chat) ? [{ chat, target: { id: chat.id, cwd: project.path, sessionFile: chat.hasMessages ? chat.sessionFile : undefined, elapsedMs: chat.elapsedMs, model: chat.selectedModel, routeSnapshots: chat.routeSnapshots } satisfies SessionTarget }] : [];
	});
	const activeTarget = targets.find(({ chat }) => chat.id === activeId)?.target;
	const activeKey = activeTarget ? sessionKey(activeTarget) : undefined;
	const selection = useRef(activeKey);
	selection.current = activeKey;
	if (activeKey) visited.current.add(activeKey);
	const validKeys = new Set(targets.map(({ target }) => sessionKey(target)));
	for (const key of visited.current) if (!validKeys.has(key)) visited.current.delete(key);
	useEffect(() => {
		setSessions((previous) => {
			if ([...previous.keys()].every((key) => validKeys.has(key))) return previous;
			return new Map([...previous].filter(([key]) => validKeys.has(key)));
		});
	}, [chats, projects]);
	const report = useCallback((key: string, session: PiSession) => {
		setSessions((previous) => {
			if (previous.get(key) === session) return previous;
			return new Map(previous).set(key, session);
		});
	}, []);
	const candidate = activeKey ? sessions.get(activeKey) : undefined;
	const selected = candidate?.isCurrent() ? candidate : undefined;
	const placeholder = useMemo(() => ({ ...empty, owner: { id: activeTarget?.id, cwd: activeTarget?.cwd, generation: empty.owner.generation }, loading: !!activeKey }), [empty, activeKey]);
	const current = selected ?? placeholder;
	// App callbacks are scoped to the selection, while runtime callbacks continue in the background.
	const isCurrent = useCallback(() => selection.current === activeKey && current.isCurrent(), [activeKey, current.isCurrent]);
	const session = useMemo(() => ({ ...current, isCurrent }), [current, isCurrent]);
	const opened = targets.filter(({ target }) => visited.current.has(sessionKey(target)));
	const runningIds = new Set(opened.filter(({ target }) => {
		const runtime = sessions.get(sessionKey(target));
		return runtime && (runtime.pending || runtime.state.isStreaming || !!runtime.state.activeRun);
	}).map(({ target }) => target.id));
	const canClose = (id: string) => {
		const target = targets.find((item) => item.target.id === id)?.target;
		const runtime = target ? sessions.get(sessionKey(target)) : undefined;
		return !runtime || (!runtime.loading && runtime.canNavigate());
	};
	const runtimes = opened.map(({ chat, target }) => <SessionRuntime key={sessionKey(target)} target={target} chat={chat} offers={offers} configuration={configuration} report={report} updateChat={updateChat} />);
	return { session, runtimes, runningIds, canClose };
}
