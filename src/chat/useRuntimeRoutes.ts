import { useCallback, useEffect, useMemo, useRef } from "react";
import type { usePiSession } from "./usePiSession";
import type { Conversation } from "./workspace";
import type { FamiliesConfig } from "./useModelFamilies";
import { useSessionValue } from "./useSessionValue";
import { modelsFromOffers, resolveSelection, type RuntimeOffer } from "./modelFamilies";
import type { ModelInfo } from "./types";

/** Exact provider/model reconciliation. Legacy route IDs only resolve migration aliases. */
export function useRuntimeRoutes(session: ReturnType<typeof usePiSession>, chat: Conversation, offers: readonly RuntimeOffer[], configuration: { config?: FamiliesConfig; ready: boolean; deferReload?: boolean }, updateChat: (id: string, patch: Partial<Conversation>) => void) {
	const { state, actions, owner, isCurrent } = session;
	const [notice, setNotice] = useSessionValue<string | undefined>(owner, isCurrent, () => undefined);
	const applied = useRef<FamiliesConfig>();
	const requested = chat.selectedModel;
	const resolved = resolveSelection(requested, [...offers]);
	const model = useMemo(() => resolved.offer ? modelsFromOffers([resolved.offer])[0] : undefined, [resolved.offer]);
	const relay = configuration.config?.relays.find((item) => item.id === requested?.provider.replace(/^skiff-relay-/, "") || item.models?.some((entry) => entry.modelId === requested?.id && entry.legacyProviderKeys?.includes(requested?.provider ?? "")));
	const entry = relay?.models?.find((item) => item.modelId === (requested?.modelId ?? requested?.id));
	const blocked = !configuration.ready ? "正在加载模型配置" : !configuration.config ? "模型配置加载失败，请重新读取配置" : !requested ? "请先选择供应商和模型" : !model ? !relay ? "所选供应商或模型已删除，请重新选择" : !relay.enabled ? "供应商已停用，请启用或重新选择" : entry && !entry.enabled ? "模型已停用，请启用或重新选择" : "所选模型不可用，请检查模型配置或重新选择" : state.model?.provider !== model.provider || state.model.id !== model.id ? "模型尚未就绪，请重新选择或重新连接" : undefined;
	useEffect(() => {
		// Save settings immediately, but coalesce pi restarts until the dialog
		// closes. Reconnecting here would lock and reflow the settings being used.
		if (configuration.deferReload) return;
		if (!model || session.pending || state.isStreaming || state.activeRun || !configuration.config || applied.current === configuration.config || (!session.connected && session.phase !== "error")) return;
		applied.current = configuration.config;
		if (requested && (requested.provider !== model.provider || requested.routeId || requested.offerId)) updateChat(chat.id, { selectedModel: { provider: model.provider, id: model.id, modelId: model.id } });
		if (!session.connected || session.loadedConfig !== configuration.config) session.reconnect(model);
		else if (state.model?.provider !== model.provider || state.model.id !== model.id) void actions.setModel(model);
	}, [configuration.config, configuration.deferReload, session.connected, session.phase, session.pending, state.isStreaming, state.activeRun, state.model, model?.provider, model?.id]);
	const selectModel = useCallback(async (selected: ModelInfo) => {
		const offer = resolveSelection(selected, [...offers]).offer;
		if (!offer || !isCurrent() || !configuration.ready || !configuration.config) return false;
		const next = modelsFromOffers([offer])[0];
		if (!session.connected) {
			if (session.loading || session.pending || state.isStreaming || state.activeRun) return false;
			updateChat(chat.id, { selectedModel: { provider: next.provider, id: next.id, modelId: next.id } });
			setNotice(undefined);
			session.reconnect(next);
			return true;
		}
		const ok = await actions.setModel(next);
		if (ok && isCurrent()) {
			updateChat(chat.id, { selectedModel: { provider: next.provider, id: next.id, modelId: next.id } });
			setNotice(undefined);
		}
		return ok && isCurrent();
	}, [actions, offers, configuration.ready, configuration.config, isCurrent, chat.id, updateChat, session.connected, session.loading, session.pending, session.reconnect, state.isStreaming, state.activeRun]);
	const prompt = useCallback<typeof actions.prompt>(async (text, images, delivery) => {
		if (blocked || !model || state.model?.provider !== model.provider || state.model.id !== model.id) { setNotice(blocked ?? "模型正在同步，请稍后发送"); return false; }
		if (images?.length && !model.vision) { setNotice("当前模型不支持图片输入，请重新选择模型"); return false; }
		return actions.prompt(text, images, delivery);
	}, [actions, blocked, model, state.model]);
	const wrappedActions = useMemo(() => ({ ...actions, setModel: selectModel, prompt }), [actions, selectModel, prompt]);
	return useMemo(() => ({ actions: wrappedActions, modelNotice: blocked ?? notice, setModelNotice: setNotice, needsConfirmation: !!state.dialogs?.length, modelBlocked: blocked }), [wrappedActions, blocked, notice, setNotice, state.dialogs]);
}
