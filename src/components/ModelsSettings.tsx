import { forwardRef, useMemo, useState, type FormEvent } from "react";
import { FAMILY_LABELS, type ModelFamily, type RelaySpec } from "../chat/useModelFamilies";
import { sameModelId } from "../chat/latestModels";
import { useFamilyModels } from "../chat/useFamilyModels";
import { BrandIcon, type BrandName } from "./BrandIcon";
import { Icon } from "./Icon";
import { useSettingsEditor, type SettingsEditorHandle } from "./settingsEditor";
import { Button, IconButton, Input } from "./ui";

const BRANDABLE = ["deepseek", "kimi", "glm"] as const;
const EDITABLE = [...BRANDABLE] as const;
const brand = (familyId: string): BrandName | undefined => BRANDABLE.find((name) => name === familyId);

type Draft = { kind: "family-models" };

/** Routes that can actually serve a model: enabled route on an enabled relay, not excluded. */
const availableRoutes = (family: ModelFamily, relays: RelaySpec[], modelId: string) =>
	family.routes.filter((route) => {
		const relay = relays.find((item) => item.id === route.relayId);
		if (!route.enabled || !relay?.enabled) return false;
		return route.models.some((model) => sameModelId(model.modelId, modelId) && !relay.excludedModelIds?.includes(model.modelId));
	}).length;

/** Enabled routes of the family, regardless of which models they carry. */
const familyRoutesAvailable = (family: ModelFamily, relays: RelaySpec[]) =>
	family.routes.filter((route) => route.enabled && relays.find((item) => item.id === route.relayId)?.enabled).length;

const aliasFor = (family: ModelFamily, modelId: string) =>
	family.routes.flatMap((route) => route.models).find((model) => model.modelId.trim().toLowerCase() === modelId.toLowerCase() && model.alias.trim())?.alias;

/**
 * Model families: the two newest models each family runs, from the
 * user-editable family-models config (seeded offline, refreshable online).
 * Provider wiring and prices live in `RoutesSettings`.
 */
export type ModelsSettingsProps = {
	families: ModelFamily[];
	relays: RelaySpec[];
	configError?: string;
	onOpenRoutes: (familyId?: string) => void;
	onLockChange: (locked: boolean, pending: boolean) => void;
};

export const ModelsSettingsContent = forwardRef<SettingsEditorHandle, ModelsSettingsProps>(function ModelsSettingsContent({ families, relays, configError, onOpenRoutes, onLockChange }, ref) {
	const { config, setFamilyModels, refreshFamily, updating, updateNotice, clearUpdateNotice } = useFamilyModels();
	const { draft, setDraft, pending, error, setError, contentRef, closeDraft } = useSettingsEditor<Draft>({ ref, onLockChange });
	const [adding, setAdding] = useState<string>();
	const [addingId, setAddingId] = useState("");
	const editing = draft?.kind === "family-models";

	const rows = useMemo(() => families.filter((family) => EDITABLE.includes(family.id as (typeof EDITABLE)[number])).map((family) => ({
		family,
		entries: config[family.id] ?? [],
	})), [families, config]);
	const autoFamily = families.find((family) => family.id === "auto");
	const autoRoutes = autoFamily ? familyRoutesAvailable(autoFamily, relays) : 0;

	const startEdit = () => { setError(undefined); clearUpdateNotice(); setDraft({ kind: "family-models" }); };
	const addManual = (familyId: string, event: FormEvent) => {
		event.preventDefault();
		const modelId = addingId.trim();
		if (!modelId) return;
		const current = config[familyId] ?? [];
		if (current.some((entry) => entry.modelId.trim().toLowerCase() === modelId.toLowerCase())) { setError("该模型已在列表中"); return; }
		setFamilyModels(familyId, [{ modelId, origin: "manual" }, ...current]);
		setAddingId("");
		setAdding(undefined);
		setError(undefined);
	};

	return <div ref={contentRef} className="settings-editor">
		{editing ? (
			<div>
				<div className="dialog-heading"><h2 id="models-title">编辑家族模型</h2><IconButton type="button" onClick={closeDraft} disabled={pending} aria-label="返回列表"><Icon name="close" /></IconButton></div>
				<p className="muted">每个家族最多保留两个自动更新的模型；手动添加的模型标为「手动」，不会被联网更新覆盖。</p>
				{rows.map(({ family, entries }) => <section className="family-card" key={family.id}>
					<div className="family-card-head">
						<span className="family-card-title">{brand(family.id) && <BrandIcon name={brand(family.id)!} size={15} />}{FAMILY_LABELS[family.id] ?? family.displayName}</span>
						<Button type="button" variant="ghost" size="compact" disabled={updating.has(family.id)} onClick={() => void refreshFamily(family.id)}>{updating.has(family.id) ? "更新中…" : "联网更新"}</Button>
					</div>
					{entries.length === 0 && <p className="family-empty">暂无模型，点「联网更新」获取，或手动添加。</p>}
					{entries.map((entry, index) => <div className="provider-row" key={`${entry.modelId}:${index}`}>
						<div className="provider-row-main">
							<div className="provider-row-title"><strong>{entry.modelId}</strong><span className="provider-tag">{entry.origin === "manual" ? "手动" : "自动"}</span></div>
						</div>
						<div className="provider-row-actions">
							<IconButton type="button" disabled={pending} onClick={() => setFamilyModels(family.id, entries.filter((_, row) => row !== index))} aria-label={`删除 ${entry.modelId}`} title="删除"><Icon name="trash" size={14} /></IconButton>
						</div>
					</div>)}
					{adding === family.id ? (
						<form className="family-add-row" onSubmit={(event) => addManual(family.id, event)}>
							<Input aria-label={`${FAMILY_LABELS[family.id] ?? family.id} 新模型 ID`} placeholder="模型 ID，如 deepseek-v4-pro" value={addingId} onChange={(event) => setAddingId(event.target.value)} disabled={pending} />
							<Button type="submit" size="compact" disabled={pending || !addingId.trim()}>添加</Button>
							<Button type="button" variant="ghost" size="compact" disabled={pending} onClick={() => { setAdding(undefined); setAddingId(""); }}>取消</Button>
						</form>
					) : (
						<Button type="button" variant="ghost" size="compact" disabled={pending} onClick={() => { setAdding(family.id); setAddingId(""); }}>添加模型</Button>
					)}
				</section>)}
				{(error || updateNotice && !updateNotice.ok) && <p className="form-error" role="alert">{error || updateNotice?.text}</p>}
				<div className="dialog-actions"><Button variant="ghost" type="button" onClick={closeDraft} disabled={pending}>返回</Button></div>
			</div>
		) : (
			<>
				<div className="dialog-heading"><h2 id="models-title">模型</h2><Button type="button" variant="ghost" size="compact" onClick={startEdit}>编辑家族模型</Button></div>
				<p className="muted">每个家族展示最新的两个模型；价格与供应商配置在「路线」中编辑。</p>
				{rows.map(({ family, entries }) => <section className="family-card" key={family.id}>
					<div className="family-card-head">
						<span className="family-card-title">{brand(family.id) && <BrandIcon name={brand(family.id)!} size={15} />}{FAMILY_LABELS[family.id] ?? family.displayName}</span>
						<Button type="button" variant="ghost" size="compact" disabled={updating.has(family.id)} title="从官方页面与模型目录更新这两个模型" onClick={() => void refreshFamily(family.id)}>{updating.has(family.id) ? "更新中…" : "联网更新"}</Button>
					</div>
					{entries.length === 0
						? <p className="family-empty">未配置模型，<button type="button" className="link-button" onClick={() => onOpenRoutes(family.id)}>去路线页添加</button>。</p>
						: entries.map((entry) => {
							const count = availableRoutes(family, relays, entry.modelId);
							const alias = aliasFor(family, entry.modelId);
							return <div className="provider-row" key={entry.modelId}>
								<div className="provider-row-main">
									<div className="provider-row-title"><strong>{alias || entry.modelId}</strong>{alias && <small>{entry.modelId}</small>}{entry.origin === "manual" && <span className="provider-tag">手动</span>}</div>
									<small>{count > 0 ? `${count} 条路线可用` : <button type="button" className="link-button" onClick={() => onOpenRoutes(family.id)}>未接路线，去配置</button>}</small>
								</div>
							</div>;
						})}
				</section>)}
				{autoFamily && <section className="family-card">
					<div className="family-card-head">
						<span className="family-card-title">Auto</span>
					</div>
					<div className="provider-row">
						<div className="provider-row-main">
							<div className="provider-row-title"><strong>Auto</strong><small>自动选择</small></div>
							<small>{autoRoutes > 0 ? `${autoRoutes} 条路线可用` : <button type="button" className="link-button" onClick={() => onOpenRoutes("auto")}>未接路线，去配置</button>}</small>
						</div>
					</div>
				</section>}
				{updateNotice && updateNotice.ok && <p className="family-added-hint" role="status">{updateNotice.text}</p>}
				{configError && <p className="form-error" role="alert">{configError}</p>}
			</>
		)}
	</div>;
});
