import { assetCanvasId, ungroupedCanvasId } from "../workbench/designCanvases";
import type { GenerationStudio } from "../workbench/useGenerationStudio";
import { GenerationPicker } from "./GenerationPicker";

/** Canvas target for the next submit. It never opens the canvas page: choosing
 *  here only re-scopes the gallery under the composer. */
export function CanvasPicker({ studio, id }: { studio: GenerationStudio; id?: string }) {
	const counts = new Map<string, number>();
	for (const asset of studio.assets) {
		if (asset.job?.removed ?? asset.removed) continue;
		const canvasId = assetCanvasId(asset, studio.canvases);
		counts.set(canvasId, (counts.get(canvasId) ?? 0) + 1);
	}
	return <div className="generation-field generation-field-canvas">
		<label htmlFor={id}>画布</label>
		<GenerationPicker
			id={id}
			label="画布"
			icon="layers"
			value={studio.canvasId}
			placeholder="未分组"
			options={[
				{ value: ungroupedCanvasId, label: "未分组", hint: counts.get(ungroupedCanvasId) ? `${counts.get(ungroupedCanvasId)} 件作品` : "不属于任何画布" },
				...studio.canvases.map((canvas) => ({ value: canvas.id, label: canvas.name, hint: `${counts.get(canvas.id) ?? 0} 件作品` })),
			]}
			onChange={studio.selectCanvas}
		/>
	</div>;
}
