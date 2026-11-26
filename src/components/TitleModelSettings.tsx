import { useState } from "react";
import { useModelFamily } from "../chat/familyContext";
import { useModelFavorites } from "../chat/useModelFavorites";
import { loadTitleModelSelection, saveTitleModelSelection, type TitleModelRef } from "../chat/titleGeneration";
import { pickerModelName } from "../chat/modelPicker";
import type { ModelInfo } from "../chat/types";
import { Button, Dialog, IconButton } from "./ui";
import { Icon } from "./Icon";
import { ModelPicker } from "./ModelPicker";

const refOf = (model: ModelInfo): TitleModelRef => ({
	provider: model.provider,
	id: model.modelId ?? model.id,
	...(model.modelId ? { modelId: model.modelId } : {}),
	...(model.offerId ? { offerId: model.offerId } : {}),
});

const matchesRef = (model: ModelInfo, ref: TitleModelRef | undefined) =>
	!!ref && model.provider === ref.provider && (model.modelId ?? model.id) === (ref.modelId ?? ref.id);

/** Primary and backup models for AI conversation titles; saved per selection. */
export function TitleModelSettings({ onManage }: { onManage: () => void }) {
	const { models, familyOf } = useModelFamily();
	const { favorites, toggleFavorite } = useModelFavorites();
	const [selection, setSelection] = useState(loadTitleModelSelection);
	const [picking, setPicking] = useState<"primary" | "fallback">();
	const catalog = models ?? [];
	const choose = (slot: "primary" | "fallback", model: ModelInfo) => {
		const next = { ...selection, [slot]: refOf(model) };
		setSelection(next);
		saveTitleModelSelection(next);
		setPicking(undefined);
	};
	const clear = (slot: "primary" | "fallback") => {
		const next = { ...selection, [slot]: undefined };
		setSelection(next);
		saveTitleModelSelection(next);
	};
	const row = (slot: "primary" | "fallback", label: string, hint: string) => {
		const model = catalog.find((item) => matchesRef(item, selection[slot]));
		return <div className="settings-row">
			<div className="settings-row-text"><span className="settings-row-title">{label}</span><span className="settings-row-hint">{hint}</span></div>
			<div className={`title-model-actions${model ? " has-value" : ""}`}>
				<Button variant="ghost" className="title-model-trigger" disabled={!catalog.length} onClick={() => setPicking(slot)}>{model ? pickerModelName(model) : catalog.length ? "未设置" : "暂无可用模型"}</Button>
				{model && <IconButton variant="ghost" size="compact" className="title-model-clear" aria-label={`清除${label}`} title="不用于标题生成" onClick={() => clear(slot)}><Icon name="close" size={12} /></IconButton>}
			</div>
		</div>;
	};
	return <div className="settings-group">
		{row("primary", "主模型", "新对话首轮回复后，用它生成标题；首条消息较短时直接用作标题。")}
		{row("fallback", "备用模型", "主模型不可用或生成失败时使用。")}
		{picking && <Dialog className="model-catalog-dialog" aria-label="选择标题模型" onClose={() => setPicking(undefined)}>
			<ModelPicker
				models={catalog}
				familyOf={familyOf}
				current={catalog.find((item) => matchesRef(item, selection[picking]))}
				onManage={() => { setPicking(undefined); onManage(); }}
				onSelect={(model) => choose(picking, model)}
				onClose={() => setPicking(undefined)}
				favorites={favorites}
				onToggleFavorite={toggleFavorite}
			/>
		</Dialog>}
	</div>;
}
