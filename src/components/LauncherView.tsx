import { offerPrice, offerAccount } from "../chat/offerDisplay";
import { Select, IconButton, Input, Button, Card, ListRow, Chip, SegmentedControl } from "./ui";
import { useMemo, useState } from "react";
import type { Conversation, Project } from "../chat/workspace";
import type { RuntimeOffer } from "../chat/modelFamilies";
import { groupLauncherOffers, recentLauncherOfferIds, type LauncherFamilyDefault } from "../chat/launcherModels";
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
	const [routeModel, setRouteModel] = useState<ReturnType<typeof groupLauncherOffers>[number]>();
	const recentChats = useMemo(() => chats.filter((chat) => chat.hasMessages).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8), [chats]);
	const recentIds = useMemo(() => new Set([...recentOfferIds, ...recentLauncherOfferIds(recentChats, offers)]), [offers, recentChats, recentOfferIds]);
	const visibleModels = useMemo(() => {
		const needle = query.trim().toLocaleLowerCase();
		return models.filter((model) => {
			if (scope === "recent" && !model.offers.some((offer) => offer.offerId && recentIds.has(offer.offerId))) return false;
			return !needle || `${model.familyName} ${model.modelId} ${model.offers.map((offer) => `${offer.relayName} ${offer.alias ?? ""}`).join(" ")}`.toLocaleLowerCase().includes(needle);
		});
	}, [models, query, recentIds, scope]);
	const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
	return <section className="launcher" aria-labelledby="launcher-title">
		<div className="launcher-inner">
			<div className="launcher-hero">
				<p className="launcher-eyebrow">START A TASK</p>
				<h1 id="launcher-title">选择一个模型，开始工作</h1>
				<p className="launcher-description">模型负责执行，项目负责上下文，会话保留完整历史。</p>
				<div className={`launcher-workspace ${activeProject ? "" : "missing"}`} aria-label="当前工作区">
					<Icon name="folder" size={16} />
					<label htmlFor="launcher-project-select"><span>当前工作区</span><Select id="launcher-project-select" value={activeProject?.id ?? ""} onChange={(event) => { if (event.target.value) onSelectProject(event.target.value); }} disabled={!projects.length} aria-label="当前工作区">
						{!activeProject && <option value="">请选择项目</option>}
						{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
					</Select></label>
					{activeProject ? <span className="launcher-project-path" title={activeProject.path}>{activeProject.path}</span> : <span className="launcher-project-path">请选择一个项目后开始聊天</span>}
					<IconButton type="button"  onClick={onAddProject} aria-label="添加项目" title="添加项目"><Icon name="plus" size={16} /></IconButton>
				</div>
			</div>
			<div className="launcher-section" aria-busy={loading}>
				<div className="launcher-section-heading"><div><h2>可用模型</h2><p>按模型聚合，线路保留在卡片内。</p></div><div className="launcher-model-tools"><SegmentedControl value={scope} onChange={setScope} label="模型范围" options={[{ value: "recent", label: "最近使用" }, { value: "all", label: "全部模型" }]} /><label className="launcher-search"><Icon name="search" size={14} /><Input appearance="plain" aria-label="搜索模型" placeholder="搜索模型或线路" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div></div>
				{loading ? <div className="launcher-model-grid launcher-model-grid-loading" role="status" aria-label="正在加载模型和线路信息">{[0, 1, 2].map((item) => <div className="launcher-model-card launcher-model-card-loading" key={item} aria-hidden="true"><span className="launcher-skeleton launcher-skeleton-icon" /><span className="launcher-skeleton launcher-skeleton-title" /><span className="launcher-skeleton launcher-skeleton-line" /><span className="launcher-skeleton launcher-skeleton-line short" /><span className="launcher-skeleton launcher-skeleton-actions" /></div>)}</div> : error ? <div className="launcher-empty launcher-error" role="alert"><strong>模型目录读取失败</strong><span>{error}</span><div><Button  onClick={onRetryModels}>重试</Button><Button variant="ghost" onClick={onManageProviders}>管理提供商</Button></div></div> : !models.length ? <div className="launcher-empty" role="status"><strong>还没有可用线路</strong><span>请先配置并启用一个提供商线路。</span><Button  onClick={onManageProviders}>管理提供商</Button></div> : !visibleModels.length ? <div className="launcher-empty" role="status">没有匹配的模型</div> : <div className="launcher-model-grid" role="list">
					{visibleModels.map((model, index) => { const offer = model.defaultOffer; const mark = brand(model.familyId); const labels = capabilityLabels(offer); const selected = !!activeChat?.selectedModel && !!((activeChat.selectedModel.offerId && activeChat.selectedModel.offerId === offer.offerId) || (activeChat.selectedModel.routeId && activeChat.selectedModel.routeId === offer.routeId && activeChat.selectedModel.id === offer.modelId)); const blocked = !activeProject || disabled; const start = () => { if (blocked) return; if (model.offers.length > 1) setRouteModel(model); else onStartChat(offer); }; return <Card selected={selected} className={`launcher-model-card${selected ? " selected" : ""}${blocked ? " blocked" : ""}`} key={`${model.familyId}/${model.modelId}`} role="listitem" tabIndex={0} aria-current={selected ? "true" : undefined} onKeyDown={(event) => { if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return; event.preventDefault(); start(); }}>
						<div className="launcher-model-top">{mark ? <div className="launcher-model-icon" aria-hidden="true"><BrandIcon name={mark} size={20} /></div> : <div className="launcher-model-icon" aria-hidden="true"><Icon name="spark" size={19} /> </div>}<div className="launcher-model-title"><h3>{model.modelId}</h3><span>{model.familyName}</span></div><Chip tone={blocked ? "neutral" : "success"}>{selected ? "当前选择" : blocked ? activeProject ? "暂不可用" : "先选项目" : "可用"}</Chip></div>
						<div className="launcher-model-chips">{labels.map((label) => <Chip key={label}>{label}</Chip>)}<Chip>{context(offer.contextWindow)} 上下文</Chip></div>
						<div className="launcher-model-route"><span>默认线路</span><strong>{offer.relayName}</strong><span>· {model.offers.length} 条线路</span></div>
						<div className="launcher-model-price">{offerPrice(offer)}</div><div className="launcher-model-account">{offerAccount(offer.billingAccountId)}</div>
						<div className="launcher-model-actions"><Button variant={selected || (!activeChat?.selectedModel && index === 0) ? "primary" : "secondary"} size="primary" disabled={blocked} onClick={start} title={activeProject ? model.offers.length > 1 ? "先选择具体线路与扣费账户" : "使用此线路开始聊天" : "请先选择项目"}>{model.offers.length > 1 ? "选择线路" : "开始聊天"}</Button><details className="launcher-details"><summary>模型详情</summary><p>{model.modelId}</p><p>{labels.join(" · ")} · {context(offer.contextWindow)} 上下文</p>{model.offers.map((item) => <p key={item.offerId ?? item.relayId}>{item.relayName} · {offerAccount(item.billingAccountId)}<br />{offerPrice(item)}</p>)}</details></div>
					</Card>; })}
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
