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
	const options = [{ id: "", name: "早期作品" }, ...canvases.map((canvas) => ({ id: canvas.id, name: canvas.name }))];
	return <Dialog className="project-dialog move-asset-dialog" aria-label="移到对话" onClose={onClose}>
		<div className="dialog-heading"><h2>移到对话</h2><IconButton aria-label="关闭移到对话" onClick={onClose}><Icon name="close" /></IconButton></div>
		<p>选择一个对话存放这件作品，原文件不会移动。</p>
		<div className="move-asset-options" role="radiogroup" aria-label="目标对话">
			{options.map((option) => <button key={option.id || "ungrouped"} type="button" role="radio" aria-checked={target === option.id} className="move-asset-option" onClick={() => setTarget(option.id)}>
				<Icon name={option.id ? "layers" : "archive"} size={15} />
				<span>{option.name}</span>
				{target === option.id && <Icon name="check" size={14} />}
			</button>)}
		</div>
		<div className="dialog-actions"><Button onClick={onClose}>取消</Button><Button variant="primary" aria-label="确认移到对话" onClick={() => { onMove(target); onClose(); }}>移动</Button></div>
	</Dialog>;
}
