import { useState } from "react";
import type { DesignCanvas } from "../workbench/designCanvases";
import type { GenerationAsset } from "../workbench/useGenerationStudio";
import { Icon } from "./Icon";
import { Button, Dialog, IconButton } from "./ui";

/** Re-groups one work without touching its file. Empty target is ungrouped. */
export function MoveAssetDialog({ asset, canvases, onMove, onClose }: {
	asset: GenerationAsset;
	canvases: DesignCanvas[];
	onMove: (canvasId: string) => void;
	onClose: () => void;
}) {
	const [target, setTarget] = useState(asset.canvasId ?? "");
	const options = [{ id: "", name: "未分组" }, ...canvases.map((canvas) => ({ id: canvas.id, name: canvas.name }))];
	return <Dialog className="project-dialog move-asset-dialog" aria-label="移到画布" onClose={onClose}>
		<div className="dialog-heading"><h2>移到画布</h2><IconButton aria-label="关闭移到画布" onClick={onClose}><Icon name="close" /></IconButton></div>
		<p>选择一个画布存放这件作品，原文件不会移动。</p>
		<div className="move-asset-options" role="radiogroup" aria-label="目标画布">
			{options.map((option) => <button key={option.id || "ungrouped"} type="button" role="radio" aria-checked={target === option.id} className="move-asset-option" onClick={() => setTarget(option.id)}>
				<Icon name={option.id ? "layers" : "archive"} size={15} />
				<span>{option.name}</span>
				{target === option.id && <Icon name="check" size={14} />}
			</button>)}
		</div>
		<div className="dialog-actions"><Button onClick={onClose}>取消</Button><Button variant="primary" aria-label="确认移到画布" onClick={() => { onMove(target); onClose(); }}>移动</Button></div>
	</Dialog>;
}
