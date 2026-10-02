import type { ModelInfo } from "../chat/types";

const keyOf = (model: ModelInfo): string => `${model.provider}/${model.id}`;

/** Native grouped `<select>` of pi's available models, grouped by provider. */
export function ModelPicker({
	models,
	current,
	onSelect,
	disabled = false,
}: {
	models: ModelInfo[];
	current?: ModelInfo;
	onSelect: (model: ModelInfo) => void;
	disabled?: boolean;
}) {
	const groups = new Map<string, ModelInfo[]>();
	for (const model of models) {
		const list = groups.get(model.provider) ?? [];
		list.push(model);
		groups.set(model.provider, list);
	}

	const currentKey = current ? keyOf(current) : "";
	const currentListed = current ? models.some((m) => keyOf(m) === currentKey) : true;

	return (
		<select
			className="model-picker"
			disabled={disabled || !models.length}
			value={currentKey}
			onChange={(event) => {
				const found = models.find((m) => keyOf(m) === event.target.value);
				if (found) onSelect(found);
			}}
			title="使用 pi 中已配置的模型"
			aria-label="选择模型"
		>
			{!current && <option value="">{models.length ? "选择模型" : "暂无可用模型"}</option>}
			{current && !currentListed && <option value={currentKey}>{current.name ?? current.id}</option>}
			{[...groups.entries()].map(([provider, list]) => (
				<optgroup key={provider} label={provider}>
					{list.map((model) => (
						<option key={keyOf(model)} value={keyOf(model)}>
							{model.name ?? model.id}
						</option>
					))}
				</optgroup>
			))}
		</select>
	);
}
