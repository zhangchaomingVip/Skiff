import { useCallback, useEffect, useMemo, useRef } from "react";
import type { usePiSession } from "./usePiSession";
import type { Conversation } from "./workspace";
import type { FamiliesConfig } from "./useModelFamilies";
import { useSessionRef, useSessionValue } from "./useSessionValue";
import { classifyProviderFailure, nextRoute, resolveSelection, type RuntimeOffer, type RouteRequirements } from "./modelFamilies";
import { familyFromProvider, modelBrand } from "./modelDisplay";
import { createRouteAuthorizationState, requestRouteSwitch, resolveRouteAuthorization, billingAccountLabel, type AuthorizationRoute, type RouteAuthorizationChoice } from "./routeAuthorization";
import { createRouteEvent, type RouteEvent } from "./routeAudit";
import type { ModelInfo } from "./types";

const route = (offer: RuntimeOffer): AuthorizationRoute => ({ familyId: offer.familyId, familyName: offer.familyName, modelId: offer.modelId, offerId: offer.offerId, routeId: offer.routeId, relayName: offer.relayName, billingAccountId: offer.billingAccountId });
const modelFor = (offer: RuntimeOffer): ModelInfo => ({ provider: offer.providerKey, id: offer.modelId, modelId: offer.modelId, routeId: offer.routeId, offerId: offer.offerId, familyId: offer.familyId, familyName: offer.familyName, relayId: offer.relayId });
const auditRoute = (value: AuthorizationRoute) => ({ ...value, billingAccountId: value.billingAccountId ?? undefined });

/** Lives with the owner, including while another chat is visible. */
export function useRuntimeRoutes(session: ReturnType<typeof usePiSession>, chat: Conversation, offers: readonly RuntimeOffer[], configuration: { config?: FamiliesConfig; ready: boolean }, updateChat: (id: string, patch: Partial<Conversation>) => void) {
	const { state, actions, owner, isCurrent } = session;
	const [authorization, setAuthorization] = useSessionValue(owner, isCurrent, () => createRouteAuthorizationState(chat.id));
	const [notice, setNotice] = useSessionValue<string | undefined>(owner, isCurrent, () => undefined);
	const events = useSessionRef<RouteEvent[]>(owner, () => chat.routeEvents ?? []);
	const requirements = useSessionRef<RouteRequirements>(owner, () => ({}));
	const context = useSessionRef<{ requestId: string; automatic: boolean; failureKind: ReturnType<typeof classifyProviderFailure> }>(owner, () => undefined);
	const attempted = useSessionRef<{ requestId: string; attempted: boolean }>(owner, () => undefined);
	const live = useRef({ session, offers }); live.current = { session, offers };
	const record = (source: AuthorizationRoute, target: AuthorizationRoute, requestId: string, automatic: boolean, choice: RouteEvent["authorization"], result: RouteEvent["result"], failureKind = classifyProviderFailure(live.current.session.state.lastError ?? "")) => {
		if (!isCurrent()) return;
		const next = [...(events.current ?? []), createRouteEvent({ sessionId: chat.id, requestId, source: auditRoute(source), target: auditRoute(target), automatic, authorization: choice, failureKind, retried: false, result })].slice(-100);
		events.current = next; updateChat(chat.id, { routeEvents: next });
	};
	const apply = async (source: AuthorizationRoute, target: AuthorizationRoute, requestId: string, automatic: boolean, choice: "same_route" | "same_account" | "session" | "once", failureKind = classifyProviderFailure(live.current.session.state.lastError ?? "")) => {
		if (!isCurrent()) return;
		const offer = live.current.offers.find((offer) => offer.offerId === target.offerId);
		const currentSource = live.current.offers.find((offer) => offer.offerId === source.offerId);
		if (!currentSource || JSON.stringify(route(currentSource)) !== JSON.stringify(source) || !offer || JSON.stringify(route(offer)) !== JSON.stringify(target) || live.current.session.state.model?.offerId !== source.offerId || live.current.session.state.model?.id !== source.modelId) { setNotice("目标线路已失效，请重新选择可用线路。"); return; }
		const success = await actions.setModel(modelFor(offer));
		if (!isCurrent()) return;
		record(source, target, requestId, automatic, choice === "same_route" ? "none" : choice, success ? "switched" : "failed", failureKind);
		if (success) setNotice(choice === "same_account" ? `已静默切换到 ${target.relayName}（同一扣费账户：${billingAccountLabel(target)}）` : `已切换到 ${target.relayName} · ${target.modelId}（已获得线路授权）`);
	};
	const sourceOffer = offers.find((offer) => state.model && (state.model.offerId ? offer.offerId === state.model.offerId : offer.providerKey === state.model.provider && offer.modelId === state.model.id));
	const failoverOffer = state.lastError && state.model && classifyProviderFailure(state.lastError) !== "non_retryable" ? nextRoute(state.model, [...offers], requirements.current) : undefined;
	const authorize = (offer: RuntimeOffer, automatic: boolean) => {
		if (!isCurrent() || !sourceOffer) return;
		const source = route(sourceOffer), target = route(offer);
		const transition = requestRouteSwitch(authorization, source, target);
		setAuthorization(transition.state);
		if (transition.effect.kind === "allow") void apply(source, target, `${chat.id}:${Date.now()}`, automatic, transition.effect.authorization);
		else if (transition.effect.kind === "prompt") context.current = { requestId: transition.effect.prompt.request.requestId, automatic, failureKind: classifyProviderFailure(state.lastError ?? "") };
	};
	const resolve = (requestId: string, choice: RouteAuthorizationChoice) => {
		if (!isCurrent()) return;
		const transition = resolveRouteAuthorization(authorization, requestId, choice);
		setAuthorization(transition.state);
		const effect = transition.effect, automatic = context.current?.requestId === requestId && context.current.automatic;
		const failureKind = context.current?.requestId === requestId ? context.current.failureKind : classifyProviderFailure(state.lastError ?? "");
		if (effect.kind === "allow") void apply(effect.source, effect.target, requestId, automatic, effect.authorization, failureKind);
		else if (effect.kind === "deny") { record(effect.source, effect.target, requestId, automatic, "keep_failed", "denied", failureKind); setNotice(effect.systemMessage); }
		else if (effect.kind === "stale") setNotice(effect.systemMessage);
		context.current = undefined;
	};
	useEffect(() => {
		const pending = authorization.pending;
		if (pending && (!state.lastError || !offers.some((offer) => offer.offerId === pending.target.offerId && JSON.stringify(route(offer)) === JSON.stringify(pending.target)) || !sourceOffer || JSON.stringify(route(sourceOffer)) !== JSON.stringify(pending.source))) setAuthorization((value) => ({ ...value, pending: undefined }));
	}, [authorization.pending, state.lastError, offers, sourceOffer?.offerId]);
	useEffect(() => {
		const user = [...state.messages].reverse().find((message) => message.role === "user");
		const requestId = user?.id ?? `messages-${state.messages.length}`;
		if (attempted.current?.requestId !== requestId) attempted.current = { requestId, attempted: false };
		if (!state.lastError || !configuration.config?.autoFailover || !failoverOffer || !session.connected || session.pending || state.isStreaming || state.activeRun || attempted.current!.attempted) return;
		attempted.current!.attempted = true; authorize(failoverOffer, true);
	}, [state.lastError, state.messages, state.isStreaming, state.activeRun, configuration.config?.autoFailover, failoverOffer, session.connected, session.pending]);
	useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(undefined), 8000); return () => clearTimeout(timer); }, [notice]);
	const applied = useRef<FamiliesConfig>();
	useEffect(() => {
		const config = configuration.config;
		if (!session.connected || session.pending || state.isStreaming || state.activeRun || !config || !configuration.ready || applied.current === config) return;
		applied.current = config;
		// The pi process may start on its own global default (for example an
		// Anthropic model) after a saved managed selection was rejected. Resolve
		// the route from the chat metadata in that case, otherwise the fallback
		// family would be inferred from the unrelated default and could issue a
		// second, invalid set_model request.
		const snapshot = [...(chat.routeSnapshots ?? [])].reverse().find((item) => item !== null);
		const snapshotModel = snapshot ? { provider: snapshot.providerKey, id: snapshot.modelId, modelId: snapshot.modelId, routeId: snapshot.routeId, offerId: snapshot.offerId } : undefined;
		const requested = snapshotModel ?? chat.selectedModel ?? state.model;
		const family = familyFromProvider(requested?.provider)?.id ?? modelBrand(requested?.id, requested?.provider);
		// Managed offers are supplied by Skiff's runtime projection and may not
		// be included in pi's generic available-model response (extensions load
		// after that response is assembled), so keep the projection as the source
		// of truth for route reconciliation.
		const resolved = resolveSelection(requested, [...offers], family, config.families);
		if (resolved.invalidated) setNotice(resolved.offer ? `当前模型已失效，已切换到 ${resolved.offer.familyName} · ${resolved.offer.relayName} · ${resolved.offer.modelId}` : "当前模型已失效，请先在中转上配置线路");
		const model = resolved.offer ? modelFor(resolved.offer) : state.model && !familyFromProvider(state.model.provider) ? state.model : undefined;
		if (session.loadedConfig !== config) session.reconnect(model);
		else if (resolved.offer && model && (state.model?.provider !== model.provider || state.model.id !== model.id || state.model.routeId !== model.routeId || state.model.offerId !== model.offerId)) void actions.setModel(model);
	}, [configuration.config, configuration.ready, session.connected, session.pending, session.loadedConfig, state.isStreaming, state.activeRun, state.model, state.availableModels, offers, chat.selectedModel]);
	const selectModel = useCallback(async (model: ModelInfo) => {
		if (!isCurrent()) return false;
		setAuthorization((value) => ({ ...value, pending: undefined }));
		const source = live.current.offers.find((offer) => offer.providerKey === live.current.session.state.model?.provider && offer.modelId === live.current.session.state.model?.id);
		const target = live.current.offers.find((offer) => model.offerId ? offer.offerId === model.offerId : offer.providerKey === model.provider && offer.modelId === model.id);
		const success = await actions.setModel(model);
		if (success && isCurrent() && source && target && source.offerId !== target.offerId) record(route(source), route(target), `manual:${Date.now()}`, false, "none", "switched");
		return success && isCurrent();
	}, [actions, isCurrent]);
	const prompt = useCallback<typeof actions.prompt>(async (text, images, delivery) => {
		requirements.current = { streaming: true, tools: live.current.session.state.model?.tools === true, reasoning: live.current.session.state.model?.reasoning === true, vision: !!images?.length || live.current.session.state.model?.vision === true };
		const accepted = await actions.prompt(text, images, delivery);
		if (!accepted && isCurrent()) requirements.current = {};
		return accepted;
	}, [actions, isCurrent]);
	const wrappedActions = useMemo(() => ({ ...actions, setModel: selectModel, prompt }), [actions, selectModel, prompt]);
	return useMemo(() => ({ actions: wrappedActions, modelNotice: notice, setModelNotice: setNotice, routeEvents: events.current ?? [], needsConfirmation: !!authorization.pending || !!state.dialogs?.length,
		failover: failoverOffer ? { label: `${failoverOffer.relayName} · ${failoverOffer.modelId}`, switch: (automatic = false) => authorize(failoverOffer, automatic) } : undefined,
		routeAuthorization: authorization.pending ? { request: authorization.pending, onChoice: (choice: RouteAuthorizationChoice) => resolve(authorization.pending!.requestId, choice) } : undefined }), [wrappedActions, notice, authorization, failoverOffer, state.lastError, state.model, state.dialogs, offers, session.owner, chat.routeEvents]);
}
