import { offerPrice, offerAccount } from "../chat/offerDisplay";
import { Dialog, IconButton, Input } from "./ui";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { RuntimeOffer } from "../chat/modelFamilies";
import type { LauncherModel } from "../chat/launcherModels";
import { Icon } from "./Icon";

const offerKey = (offer: RuntimeOffer) => offer.offerId ?? `${offer.routeId ?? offer.relayId}/${offer.modelId}`;
const context = (tokens: number) => tokens >= 1_000_000 ? `${Math.round(tokens / 100_000) / 10}M` : `${Math.round(tokens / 1000)}K`;
const capabilities = (offer: RuntimeOffer) => [offer.tools && "工具", offer.vision && "视觉", offer.reasoning && "推理", offer.streaming && "流式"].filter((label): label is string => !!label);

export function OfferPickerDialog({ model, onSelect, onClose }: { model: LauncherModel; onSelect: (offer: RuntimeOffer) => void; onClose: () => void }) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(() => Math.max(0, model.offers.findIndex((offer) => offer.offerId === model.defaultOffer.offerId)));
	const choices = useMemo(() => {
		const needle = query.trim().toLocaleLowerCase();
		return model.offers.filter((offer) => !needle || `${offer.relayName} ${offer.modelId} ${offer.alias ?? ""} ${offer.billingAccountId ?? ""}`.toLocaleLowerCase().includes(needle));
	}, [model.offers, query]);
	useEffect(() => { setActive((index) => Math.min(index, Math.max(0, choices.length - 1))); }, [choices.length]);
	const choose = (offer: RuntimeOffer | undefined) => { if (offer) onSelect(offer); };
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(0, Math.min(choices.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))); }
		if (event.key === "Enter") { event.preventDefault(); choose(choices[active] ?? choices[0]); }
	};
	return <Dialog onClose={onClose} initialFocus={inputRef}  className="offer-dialog" aria-labelledby="offer-dialog-title" >
		<div className="offer-dialog-head"><div><h2 id="offer-dialog-title">选择线路</h2><p>{model.familyName} · {model.modelId} · 线路决定请求地址和扣费账户。</p></div><IconButton  onClick={onClose} aria-label="关闭"><Icon name="close" /></IconButton></div>
		<label className="offer-search"><Icon name="search" size={15} /><Input appearance="plain" ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} aria-label="搜索线路" placeholder="搜索线路、模型或扣费账户" /></label>
		<div className="offer-options" role="listbox" aria-label="可用线路">
			{choices.map((offer, index) => <button type="button" key={offerKey(offer)} className={`offer-option ${index === active ? "focused" : ""}`} role="option" aria-selected={offer.offerId === model.defaultOffer.offerId} onMouseMove={() => setActive(index)} onClick={() => choose(offer)}>
				<span className="offer-option-icon"><Icon name="terminal" size={16} /></span><span className="offer-option-main"><strong>{offer.relayName}</strong><small>{offer.modelId} · {capabilities(offer).join(" · ") || "基础能力"} · {context(offer.contextWindow)} 上下文</small><small>{offerAccount(offer.billingAccountId)}</small></span><span className="offer-option-price">{offerPrice(offer)}</span>
			</button>)}
			{!choices.length && <p className="menu-hint">没有匹配的线路</p>}
		</div>
		<p className="offer-dialog-hint">↑ ↓ 选择 · Enter 确认 · Esc 关闭</p>
	</Dialog>;
}
