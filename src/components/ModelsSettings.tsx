import { useEffect, useMemo, forwardRef } from "react";
import { FAMILY_LABELS, type ModelFamily } from "../chat/useModelFamilies";
import { pickVisibleIds } from "../chat/latestModels";
import { useModelCatalog } from "../chat/useModelCatalog";
import { BrandIcon, type BrandName } from "./BrandIcon";
import { Button } from "./ui";
import type { SettingsEditorHandle } from "./settingsEditor";

const BRANDABLE = ["deepseek", "kimi", "glm"] as const;
const brand = (familyId: string): BrandName | undefined => BRANDABLE.find((name) => name === familyId);

/**
 * Model families: what is runnable per family, trimmed to the two newest
 * models. Provider wiring (which relay serves them, at what price) lives in
 * `RoutesSettings`; this page is only the catalogue view.
 */
export type ModelsSettingsProps = {
	families: ModelFamily[];
	configError?: string;
	onOpenRoutes: () => void;
	onLockChange: (locked: boolean, pending: boolean) => void;
};

export const ModelsSettingsContent = forwardRef<SettingsEditorHandle, ModelsSettingsProps>(function ModelsSettingsContent({ families, configError, onOpenRoutes, onLockChange }) {
	const { catalog, latest } = useModelCatalog();
	useEffect(() => onLockChange(false, false), [onLockChange]);

	const visible = useMemo(() => families.map((family) => {
		// One model may be wired through several routes; the family view lists
		// it once, keeping the first entry's alias.
		const seen = new Set<string>();
		const models = family.routes.flatMap((route) => route.models).filter((model) => {
			const id = model.modelId.trim();
			if (!id || seen.has(id.toLowerCase())) return false;
			const visibleNow = pickVisibleIds(family.id, latest, catalog).some((visibleId) => visibleId.toLowerCase() === id.toLowerCase());
			if (!visibleNow) return false;
			seen.add(id.toLowerCase());
			return true;
		});
		return { family, models };
	}), [families, latest, catalog]);

	return <div className="settings-editor">
		<h2 id="models-title">模型</h2>
		<p className="muted">每个模型家族只展示最新的两个模型；完整的价格与供应商配置在「路线」中编辑。</p>
		{families.every((family) => family.routes.length === 0) ? (
			<section className="family-card">
				<div className="family-card-head">
					<span className="family-card-title">还没有模型</span>
					<Button type="button" variant="ghost" size="compact" onClick={onOpenRoutes}>去添加路线</Button>
				</div>
				<p className="family-empty">模型依附于路线：先到「路线」为家族接入供应商并配置模型。</p>
			</section>
		) : (
			visible.map(({ family, models }) => <section className="family-card" key={family.id}>
				<div className="family-card-head">
					<span className="family-card-title">{brand(family.id) && <BrandIcon name={brand(family.id)!} size={15} />}{FAMILY_LABELS[family.id] ?? family.displayName}</span>
				</div>
				{models.length === 0
					? <p className="family-empty">目录中暂无该家族的最新模型信息。</p>
					: models.map((model) => <div className="provider-row" key={model.modelId}>
						<div className="provider-row-main">
							<div className="provider-row-title"><strong>{model.alias || model.modelId}</strong>{model.alias && <small>{model.modelId}</small>}</div>
						</div>
					</div>)}
			</section>)
		)}
		{configError && <p className="form-error" role="alert">{configError}</p>}
	</div>;
});
