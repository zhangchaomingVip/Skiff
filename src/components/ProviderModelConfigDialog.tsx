import { useId, useRef } from "react";
import { formatContextWindow } from "../chat/modelFamilies";
import { DEFAULT_THINKING_LEVELS, THINKING_LEVELS, type ModelFamily, type ModelSpec, type ProviderModel } from "../chat/useModelFamilies";
import { Icon } from "./Icon";
import { Button, Dialog, IconButton, Input, Select } from "./ui";

type ProviderModelConfigDialogProps = {
	model: ModelSpec & Partial<ProviderModel>;
	familyId?: string;
	families: ModelFamily[];
	providerEnabled: boolean;
	disabled: boolean;
	onPatch: (value: Partial<ProviderModel>) => void;
	onFamilyChange: (familyId: string) => void;
	onClose: () => void;
};

export function ProviderModelConfigDialog({ model, familyId, families, providerEnabled, disabled, onPatch, onFamilyChange, onClose }: ProviderModelConfigDialogProps) {
	const id = useId();
	const familySelect = useRef<HTMLSelectElement>(null);
	const reasoning = model.reasoning !== false;
	const thinkingLevels = model.thinkingLevels ?? DEFAULT_THINKING_LEVELS;
	const alias = model.alias.trim();
	return <Dialog className="provider-model-config-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-model-id`} initialFocus={familySelect} onClose={onClose}>
		<header className="provider-model-config-header">
			<div><h2 id={`${id}-title`}>配置模型{alias ? ` · ${alias}` : ""}</h2><p id={`${id}-model-id`}>{model.modelId || "未设置模型 ID"}</p></div>
			<IconButton variant="ghost" aria-label="关闭模型配置" onClick={onClose}><Icon name="close" /></IconButton>
		</header>
		<form onSubmit={(event) => { event.preventDefault(); onClose(); }}>
			<div className="provider-model-config-body">
				{!providerEnabled && <p className="provider-model-config-notice" role="status">供应商已停用；启用供应商后模型才可用。</p>}
				<section className="provider-model-config-section" aria-labelledby={`${id}-basic`}>
					<h3 id={`${id}-basic`}>基本属性</h3>
					<div className="provider-model-config-grid">
						<label className="provider-model-config-field">模型家族<Select ref={familySelect} value={familyId ?? ""} disabled={disabled} onChange={(event) => onFamilyChange(event.target.value)}><option value="">未分组</option>{families.map((family) => <option key={family.id} value={family.id}>{family.displayName}</option>)}</Select></label>
						<label className="provider-model-config-field">最大输出 Token<Input type="number" required min={1} max={model.contextWindow} step={1} value={model.maxTokens || ""} disabled={disabled} aria-describedby={`${id}-output-hint`} onChange={(event) => onPatch({ maxTokens: Number(event.target.value) })} /><small id={`${id}-output-hint`}>单次回复的最大生成上限</small></label>
					</div>
					<div className="provider-model-config-context"><span>上下文窗口 <strong>{formatContextWindow(model.contextWindow)}</strong></span><small>在模型列表中编辑</small></div>
				</section>
				<section className="provider-model-config-section" aria-labelledby={`${id}-capabilities`}>
					<h3 id={`${id}-capabilities`}>能力特性</h3>
					<div className="provider-model-config-grid">
						{([["reasoning", "推理支持"], ["vision", "图片输入"], ["tools", "工具调用"], ["streaming", "流式输出"]] as const).map(([key, label]) => <label className="provider-model-config-capability" data-disabled={disabled || undefined} key={key}><span>{label}</span><span className="switch"><input type="checkbox" role="switch" checked={model[key] ?? key !== "vision"} disabled={disabled} onChange={(event) => onPatch({ [key]: event.target.checked })} /><span className="slider" /></span></label>)}
					</div>
					{reasoning && <div className="provider-model-config-thinking" role="group" aria-labelledby={`${id}-thinking`}>
						<span id={`${id}-thinking`}>可用推理等级（在聊天中可调）</span>
						<div className="provider-model-config-levels">{THINKING_LEVELS.map((level) => <label key={level}><input type="checkbox" checked={thinkingLevels.includes(level)} disabled={disabled} onChange={(event) => onPatch({ thinkingLevels: THINKING_LEVELS.filter((item) => item === level ? event.target.checked : thinkingLevels.includes(item)) })} /><span>{thinkingLevels.includes(level) && <Icon name="check" size={12} />}{level}</span></label>)}</div>
					</div>}
				</section>
				<section className="provider-model-config-section" aria-labelledby={`${id}-pricing`}>
					<h3 id={`${id}-pricing`}>独立计费与定价</h3>
					<p className="provider-model-config-hint" id={`${id}-pricing-hint`}>留空或为 0 则遵循供应商全局倍率与默认定价。</p>
					<label className="provider-model-config-field provider-model-config-currency">币种<Select value={model.currency} disabled={disabled} onChange={(event) => onPatch({ currency: event.target.value as "CNY" | "USD" })}><option value="CNY">CNY</option><option value="USD">USD</option></Select></label>
					<div className="provider-model-config-grid">
						{([["inputCost", "输入单价"], ["outputCost", "输出单价"], ["cacheReadCost", "缓存读取单价"], ["cacheWriteCost", "缓存写入单价"]] as const).map(([key, label]) => <label className="provider-model-config-field" key={key}>{label} / 百万 token<Input type="number" min={0} step="any" placeholder="0" value={model[key] || ""} disabled={disabled} aria-describedby={`${id}-pricing-hint`} onChange={(event) => onPatch({ [key]: Number(event.target.value) })} /></label>)}
					</div>
				</section>
			</div>
			<footer className="provider-model-config-footer"><small>更改将在保存供应商后生效</small><Button type="submit" variant="primary">完成</Button></footer>
		</form>
	</Dialog>;
}
