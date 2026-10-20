import { useEffect, useRef, useState } from "react";
import { routeBlockedReason, routeSummaryModels, type CatalogIdentity } from "../chat/settingsModels";
import { settingsTestDisplay, type SettingsTestRecord } from "../chat/settingsManagement";
import { matchPreset } from "../chat/providerPresets";
import { FAMILY_LABELS, type ModelFamily, type RelaySpec, type RouteSpec } from "../chat/useModelFamilies";
import { DisclosureButton } from "./Disclosure";
import { ProviderIcon } from "./ProviderIcon";
import { Button, IconButton, Popover } from "./ui";

type RouteAction = { label: string; accessible: string; reason?: string; run: () => void };

function RouteMenu({ name, actions, pending }: { name: string; actions: RouteAction[]; pending: boolean }) {
	const [open, setOpen] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const panel = useRef<HTMLDivElement>(null);
	useEffect(() => { if (open) panel.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus(); }, [open]);
	const close = () => { setOpen(false); trigger.current?.focus(); };
	return <>
		<IconButton ref={trigger} disabled={pending} aria-label={`更多 ${name} 的路线操作`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>⋯</IconButton>
		{open && <Popover anchor={trigger} role="menu" aria-label={`${name} 的路线操作`} onClose={close} className="settings-route-menu">
			<div ref={panel} onKeyDown={(event) => {
				if (!["ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(event.key)) return;
				if (event.key === "Tab") { close(); return; }
				event.preventDefault();
				const items = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
				const index = items.indexOf(document.activeElement as HTMLButtonElement);
				const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
				items[next]?.focus();
			}}>{actions.map((action) => <div key={action.label}><Button role="menuitem" variant="ghost" aria-label={action.accessible} disabled={!!action.reason} title={action.reason} onClick={() => { close(); action.run(); }}>{action.label}</Button>{action.reason && <small>{action.reason}</small>}</div>)}</div>
		</Popover>}
	</>;
}

export function SettingsRouteRow({ family, route, relay, catalog, visibleIds, pending, testHistory, actions, onToggle }: {
	family: ModelFamily;
	route: RouteSpec;
	relay?: RelaySpec;
	catalog: readonly CatalogIdentity[];
	visibleIds: readonly string[];
	pending: boolean;
	actions: RouteAction[];
	testHistory?: SettingsTestRecord; onToggle: (enabled: boolean) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const isAuto = family.id === "auto";
	const reason = routeBlockedReason(route, relay);
	const name = relay?.name ?? route.relayId;
	const preset = matchPreset(relay?.baseUrl ?? "");
	const summary = routeSummaryModels(route, visibleIds, catalog);
	const testDisplay = settingsTestDisplay(testHistory);
	return <div className={`settings-route-entry provider-relay-row ${reason ? "disabled" : ""}`} data-route-id={route.id}>
		<div className="provider-relay-main">
			<span className="provider-avatar"><ProviderIcon id={preset?.id ?? ""} name={name} size={28} /></span>
			<span className="provider-row-text">
				<span className="provider-row-title"><strong title={name}>{name}</strong><span className="provider-tag muted-tag route-family-tag">{FAMILY_LABELS[family.id] ?? family.displayName}</span></span>
				<div className="route-row-status-line">
					<span className={`route-status-badge ${reason ? "is-blocked" : "is-available"}`}>{reason ?? "可用"}</span>
					<small className={`settings-test-history is-${testDisplay.tone}`} title={testDisplay.title} aria-label={testDisplay.title} tabIndex={testHistory ? 0 : undefined}>{testDisplay.label}</small>
				</div>
				<div className={`route-model-summary${isAuto ? " is-auto" : ""}`}>
					{isAuto ? <span className="route-auto-description">按各家族路线顺序择优</span> : <>
						{summary.map((model) => <code className="route-model-chip" key={model.modelId} title={model.modelId}>{model.modelId}</code>)}
						{route.models.length > 0 && <DisclosureButton className="route-model-disclosure" aria-label={expanded ? "收起全部模型" : `查看全部 ${route.models.length} 个模型`} expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "收起模型" : `共 ${route.models.length} 个`}</DisclosureButton>}
					</>}
				</div>
			</span>
		</div>
		<div className="provider-row-side route-row-side">
			<div className="provider-row-actions">
				<label className="switch" title={route.enabled ? "停用路线" : "启用路线"}>
					<input type="checkbox" checked={route.enabled} disabled={pending} onChange={(event) => onToggle(event.target.checked)} aria-label={`${route.enabled ? "停用" : "启用"} ${name} 的路线`} /><span className="slider" />
				</label>
				<RouteMenu name={name} actions={actions} pending={pending} />
			</div>
		</div>
		{expanded && <div className="route-model-prices">{route.models.map((model) => <div key={model.modelId}>
			<code>{model.modelId}</code>{model.alias && <span>{model.alias}</span>}
			<small>{relay?.excludedModelIds?.includes(model.modelId) ? "模型已剔除" : reason ?? "可用"}</small>
			<span>输入 {model.inputCost} / 输出 {model.outputCost} {model.currency} / 百万 token</span>
		</div>)}</div>}
	</div>;
}
