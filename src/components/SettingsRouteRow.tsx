import { useEffect, useRef, useState } from "react";
import { routeBlockedReason, routeSummaryModels, type CatalogIdentity } from "../chat/settingsModels";
import type { ModelFamily, RelaySpec, RouteSpec } from "../chat/useModelFamilies";
import { DisclosureButton } from "./Disclosure";
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

export function SettingsRouteRow({ family, route, relay, catalog, visibleIds, pending, actions, onToggle }: {
	family: ModelFamily;
	route: RouteSpec;
	relay?: RelaySpec;
	catalog: readonly CatalogIdentity[];
	visibleIds: readonly string[];
	pending: boolean;
	actions: RouteAction[];
	onToggle: (enabled: boolean) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const isDefault = family.defaultRouteId === route.id;
	const reason = routeBlockedReason(route, relay);
	const name = relay?.name ?? route.relayId;
	const summary = routeSummaryModels(route, visibleIds, catalog);
	return <div className="settings-route-entry" data-route-id={route.id}>
		<div className={`provider-row ${route.enabled ? "" : "disabled"}`}>
			<div className="provider-row-main">
				<div className="provider-row-title"><strong>{isDefault && <span aria-label="家族默认路线">★ </span>}{name}</strong>{isDefault && <span className="provider-tag">默认</span>}</div>
				<small>{reason ?? "可用"} · 按模型计价</small>
				<div className="route-model-summary">{summary.map((model) => <code key={model.modelId}>{model.modelId}</code>)}</div>
				{route.models.length > 0 && <DisclosureButton expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "收起模型" : `查看全部 ${route.models.length} 个模型`}</DisclosureButton>}
			</div>
			<div className="provider-row-actions">
				<label className="switch" title={isDefault && route.enabled ? "默认路线不可停用，请先选择替代路线或清空默认值" : route.enabled ? "停用路线" : "启用路线"}>
					<input type="checkbox" checked={route.enabled} disabled={pending || isDefault && route.enabled} onChange={(event) => onToggle(event.target.checked)} aria-label={`${route.enabled ? "停用" : "启用"} ${name} 的路线`} /><span className="slider" />
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
