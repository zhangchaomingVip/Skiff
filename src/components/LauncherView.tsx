import { offerPriceCompact, offerAccount } from "../chat/offerDisplay";
import { Input, Button, ListRow, Chip, SegmentedControl, Popover } from "./ui";
import { useMemo, useRef, useState } from "react";
import type { Conversation, Project } from "../chat/workspace";
import type { RuntimeOffer } from "../chat/modelFamilies";
import { groupLauncherOffers, groupLauncherFamilies, recentLauncherOfferIds, type LauncherFamilyDefault, type LauncherModel } from "../chat/launcherModels";
import { OfferPickerDialog } from "./OfferPickerDialog";
import { BrandIcon, type BrandName } from "./BrandIcon";
import { Icon } from "./Icon";

const brand = (familyId: string): BrandName | undefined => ["deepseek", "kimi", "glm"].find((name) => name === familyId) as BrandName | undefined;
const context = (tokens: number) => tokens >= 1_000_000 ? `${Math.round(tokens / 100_000) / 10}M` : `${Math.round(tokens / 1000)}K`;
const capabilityLabels = (offer: RuntimeOffer) => [offer.tools && "工具", offer.vision && "视觉", offer.reasoning && "推理", offer.streaming && "流式"].filter((label): label is string => !!label);
const relativeTime = (timestamp: number) => {
	const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
	if (minutes < 1) return "刚刚";
	if (minutes < 60) return `${minutes} 分钟前`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} 小时前`;
	const days = Math.floor(hours / 24);
	return days < 30 ? `${days} 天前` : new Date(timestamp).toLocaleDateString("zh-CN");
};

const COLLAPSE_KEY = "skiff.launcher-collapsed-families.v1";
const loadCollapsedFamilies = (): Set<string> => {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "[]");
		return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : []);
	} catch { return new Set(); }
};
const saveCollapsedFamilies = (collapsed: ReadonlySet<string>) => {
	try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed])); } catch { /* Optional preference; grouping still works. */ }
};

export function LauncherView({ activeChat, activeProject, projects, chats, offers, recentOfferIds, familyDefaults, loading, disabled = false, error, onResume, onSelectProject, onAddProject, onManageProviders, onRetryModels, onStartChat, onOpenChat }: {
	activeChat?: Conversation;
	activeProject?: Project;
	projects: Project[];
	chats: Conversation[];
	offers: RuntimeOffer[];
	recentOfferIds: string[];
	familyDefaults: LauncherFamilyDefault[];
	loading: boolean;
	disabled?: boolean;
	error?: string;
	onResume: () => void;
	onSelectProject: (id: string) => void;
	onAddProject: () => void;
	onManageProviders: () => void;
	onRetryModels: () => void;
	onStartChat: (offer: RuntimeOffer) => void;
	onOpenChat: (id: string) => void;
}) {
	const models = useMemo(() => groupLauncherOffers(offers, familyDefaults), [offers, familyDefaults]);
	const [scope, setScope] = useState<"recent" | "all">(recentOfferIds.length ? "recent" : "all");
	const [query, setQuery] = useState("");
	const [routeModel, setRouteModel] = useState<LauncherModel>();
	const [workspaceOpen, setWorkspaceOpen] = useState(false);
	const workspaceAnchor = useRef<HTMLButtonElement>(null);
	const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsedFamilies);
	const recentChats = useMemo(() => chats.filter((chat) => chat.hasMessages).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8), [chats]);
	const recentIds = useMemo(() => new Set([...recentOfferIds, ...recentLauncherOfferIds(recentChats, offers)]), [offers, recentChats, recentOfferIds]);
	const searching = !!query.trim();
	const visibleFamilies = useMemo(() => {
		const needle = query.trim().toLocaleLowerCase();
		const filtered = models.filter((model) => {
			if (scope === "recent" && !model.offers.some((offer) => offer.offerId && recentIds.has(offer.offerId))) return false;
			return !needle || `${model.familyName} ${model.modelId} ${model.offers.map((offer) => `${offer.relayName} ${offer.alias ?? ""}`).join(" ")}`.toLocaleLowerCase().includes(needle);
		});
		return groupLauncherFamilies(filtered, recentIds);
	}, [models, query, recentIds, scope]);
	const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
	const blocked = !activeProject || disabled;
	const toggleFamily = (familyId: string, open: boolean) => setCollapsed((previous) => {
		const next = new Set(previous);
		if (open) next.delete(familyId); else next.add(familyId);
		saveCollapsedFamilies(next);
		return next;
	});
	const renderRow = (model: LauncherModel, solo: boolean) => {
		const offer = model.defaultOffer;
		const mark = brand(model.familyId);
		const labels = capabilityLabels(offer);
		const selected = !!activeChat?.selectedModel && !!((activeChat.selectedModel.offerId && activeChat.selectedModel.offerId === offer.offerId) || (activeChat.selectedModel.routeId && activeChat.selectedModel.routeId === offer.routeId && activeChat.selectedModel.id === offer.modelId));
		const start = () => { if (blocked) return; if (model.offers.length > 1) setRouteModel(model); else onStartChat(offer); };
		return <div className={`launcher-row${selected ? " selected" : ""}`} key={`${model.familyId}/${model.modelId}`} role="listitem">
			{solo && (mark ? <span className="launcher-group-icon" aria-hidden="true"><BrandIcon name={mark} size={20} /></span> : <span className="launcher-group-icon" aria-hidden="true"><Icon name="spark" size={19} /></span>)}
			<div className="launcher-row-main">
				<span className="launcher-row-name">{model.modelId}</span>
				{solo && <span className="launcher-row-family">{model.familyName}</span>}
				{selected && <Chip tone="success">当前选择</Chip>}
			</div>
			<div className="launcher-row-chips">{labels.map((label) => <Chip key={label}>{label}</Chip>)}<Chip>{context(offer.contextWindow)} 上下文</Chip></div>
			<span className="launcher-row-line">默认线路 <strong>{offer.relayName}</strong> · {model.offers.length} 条线路 · {offerAccount(offer.billingAccountId)}</span>
			<span className="launcher-row-price">{offerPriceCompact(offer)}</span>
			<Button variant={selected ? "primary" : "secondary"} disabled={blocked} onClick={start} title={blocked ? activeProject ? "当前不可用" : "请先选择项目" : model.offers.length > 1 ? "先选择具体线路与扣费账户" : "使用此线路开始聊天"}>{model.offers.length > 1 ? "选择线路" : "开始聊天"}</Button>
		</div>;
	};
	return <section className="launcher" aria-labelledby="launcher-title">
		<div className="launcher-inner">
			<div className="launcher-hero">
				<div className="launcher-hero-top">
					<div>
						<p className="launcher-eyebrow">START A TASK</p>
						<h1 id="launcher-title">选择一个模型，开始工作</h1>
						<p className="launcher-description">模型负责执行，项目负责上下文，会话保留完整历史。</p>
					</div>
					<button ref={workspaceAnchor} type="button" className={`launcher-ws-chip${activeProject ? "" : " missing"}`} onClick={() => setWorkspaceOpen((open) => !open)} aria-haspopup="dialog" aria-expanded={workspaceOpen} aria-label="当前工作区">
						<Icon name="folder" size={14} />
						<span className="launcher-ws-name">{activeProject?.name ?? "请选择项目"}</span>
						{activeProject && <span className="launcher-ws-path" title={activeProject.path}>{activeProject.path}</span>}
						<span className="launcher-ws-chevron" aria-hidden="true"><Icon name="chevron" size={12} /></span>
					</button>
				</div>
				{workspaceOpen && <Popover anchor={workspaceAnchor} onClose={() => setWorkspaceOpen(false)} className="launcher-ws-pop" aria-label="切换工作区">
					{projects.map((project) => <ListRow key={project.id} className="launcher-ws-item" onClick={() => { onSelectProject(project.id); setWorkspaceOpen(false); }}>
						<Icon name="folder" size={14} />
						<span className="launcher-ws-item-name">{project.name}</span>
						<span className="launcher-ws-item-path" title={project.path}>{project.path}</span>
						{project.id === activeProject?.id && <Icon name="check" size={14} />}
					</ListRow>)}
					<Button variant="ghost" className="launcher-ws-add" onClick={() => { setWorkspaceOpen(false); onAddProject(); }}><Icon name="plus" size={14} />添加项目</Button>
				</Popover>}
			</div>
			<div className="launcher-section" aria-busy={loading}>
				<div className="launcher-section-heading"><div><h2>可用模型</h2><p>按提供商分组，线路与扣费账户保留在模型行。</p></div><div className="launcher-model-tools"><SegmentedControl value={scope} onChange={setScope} label="模型范围" options={[{ value: "recent", label: "最近使用" }, { value: "all", label: "全部模型" }]} /><label className="launcher-search"><Icon name="search" size={14} /><Input appearance="plain" aria-label="搜索模型" placeholder="搜索模型或线路" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div></div>
				{loading ? <div className="launcher-groups" role="status" aria-label="正在加载模型和线路信息">{[0, 1, 2].map((item) => <div className="launcher-group launcher-group-loading" key={item} aria-hidden="true"><span className="launcher-skeleton launcher-skeleton-icon" /><span className="launcher-skeleton launcher-skeleton-title" /><span className="launcher-skeleton launcher-skeleton-line" /></div>)}</div> : error ? <div className="launcher-empty launcher-error" role="alert"><strong>模型目录读取失败</strong><span>{error}</span><div><Button  onClick={onRetryModels}>重试</Button><Button variant="ghost" onClick={onManageProviders}>管理提供商</Button></div></div> : !models.length ? <div className="launcher-empty" role="status"><strong>还没有可用线路</strong><span>请先配置并启用一个提供商线路。</span><Button  onClick={onManageProviders}>管理提供商</Button></div> : !visibleFamilies.length ? <div className="launcher-empty" role="status">没有匹配的模型</div> : <div className="launcher-groups" role="list">
					{visibleFamilies.map((family) => {
						const mark = brand(family.familyId);
						const status = blocked ? activeProject ? "暂不可用" : "先选项目" : `可用 · ${family.models.length} 个模型`;
						if (family.models.length === 1 && !searching) return <div className="launcher-group launcher-solo" key={family.familyId}>{renderRow(family.models[0], true)}</div>;
						return <details className="launcher-group" key={`${family.familyId}${searching ? ":search" : ""}`} role="listitem" open={searching || !collapsed.has(family.familyId)} onToggle={(event) => { if (!searching) toggleFamily(family.familyId, event.currentTarget.open); }}>
							<summary className="launcher-group-head">
								{mark ? <span className="launcher-group-icon" aria-hidden="true"><BrandIcon name={mark} size={20} /></span> : <span className="launcher-group-icon" aria-hidden="true"><Icon name="spark" size={19} /></span>}
								<span className="launcher-group-name">{family.familyName}</span>
								<span className="launcher-group-badges">{family.recent && <Chip>最近使用</Chip>}<Chip tone={blocked ? "neutral" : "success"}>{status}</Chip></span>
								{family.priceRange && <span className="launcher-group-range">{family.priceRange}</span>}
								<span className="launcher-group-chevron" aria-hidden="true"><Icon name="chevron" size={14} /></span>
							</summary>
							<div className="launcher-rows">{family.models.map((model) => renderRow(model, false))}</div>
						</details>;
					})}
				</div>}
			</div>
			<div className="launcher-section launcher-recent-section">
				<div className="launcher-section-heading"><div><h2>最近会话</h2><p>显示最后一次完成回复的实际线路。</p></div></div>
				{recentChats.length ? <div className="launcher-recent-list">{recentChats.map((chat) => { const snapshot = [...(chat.routeSnapshots ?? [])].reverse().find((item) => !!item); const modelText = snapshot ? `${snapshot.familyName} · ${snapshot.modelId}` : chat.selectedModel?.modelId ?? chat.selectedModel?.id; return <ListRow className="launcher-recent-row" key={chat.id} onClick={() => onOpenChat(chat.id)}><span className="launcher-recent-main"><strong>{chat.title}</strong><span>{projectNames.get(chat.projectId) ?? "项目已移除"} · {relativeTime(chat.updatedAt)}</span><span>{modelText ?? "尚无模型记录"}{snapshot ? ` · ${snapshot.relayName}` : " · 尚无完成回复线路"}</span></span><span className="launcher-recent-arrow">继续 →</span></ListRow>; })}</div> : <div className="launcher-empty launcher-recent-empty" role="status">还没有可恢复的历史会话</div>}
			</div>
			{activeChat && <div className="launcher-resume">
				<div><h2>当前会话</h2><p>{activeChat.title}</p></div>
				<Button  onClick={onResume}><Icon name="message" size={16} />返回聊天</Button>
			</div>}
		</div>
		{routeModel && <OfferPickerDialog model={routeModel} onSelect={(offer) => { setRouteModel(undefined); onStartChat(offer); }} onClose={() => setRouteModel(undefined)} />}
	</section>;
}
