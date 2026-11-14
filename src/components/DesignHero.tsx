import type { ReactNode } from "react";
import type { GenerationKind } from "../workbench/useGenerationStudio";
import { Icon } from "./Icon";
import { Button, SegmentedControl } from "./ui";
import "./generation-workspace.css";

const heroCopy: Record<GenerationKind, { breadcrumb: string; kicker: string; title: string; description: string }> = {
	image: {
		breadcrumb: "Design / 图片",
		kicker: "DESIGN STUDIO",
		title: "你好，今天想创作什么？",
		description: "写下一句画面描述，参考图、比例与分辨率都在同一个输入框里。",
	},
	video: {
		breadcrumb: "Design / 视频",
		kicker: "MOTION STUDIO",
		title: "今天想拍一段什么？",
		description: "一句镜头描述，或一张首帧，交给模型让画面流动起来。",
	},
};

/** The design home above the gallery: greeting, kind switch and the composer
 *  slot. Everything scrolls with the works below it. */
export function DesignHero({ kind, composer, parametersOpen, onKind, onOpenParameters }: {
	kind: GenerationKind;
	composer?: ReactNode;
	parametersOpen: boolean;
	onKind: (kind: GenerationKind) => void;
	onOpenParameters: () => void;
}) {
	const copy = heroCopy[kind];
	return <section className="design-hero" aria-label="创作入口">
		<div className="design-hero-bar">
			<span className="design-hero-breadcrumb"><Icon name={kind === "image" ? "imageSpark" : "video"} size={15} />{copy.breadcrumb}</span>
			<Button size="compact" variant="ghost" className="design-hero-parameters" aria-pressed={parametersOpen} onClick={onOpenParameters}><Icon name="sliders" size={15} />创作参数</Button>
		</div>
		<div className="design-hero-intro">
			<p className="design-hero-kicker">{copy.kicker}</p>
			<h1 className="design-hero-title">{copy.title}</h1>
			<p className="design-hero-description">{copy.description}</p>
			<SegmentedControl label="创作类型" value={kind} onChange={onKind} options={[{ value: "image", label: "图片" }, { value: "video", label: "视频" }]} />
		</div>
		{composer ? <div className="design-composer">{composer}</div> : <button type="button" className="design-hero-start" onClick={onOpenParameters}>
			<span className="design-hero-start-icon"><Icon name="spark" size={18} /></span>
			<span className="design-hero-start-copy"><strong>开始创作</strong><small>展开输入框，选择模型、比例与分辨率</small></span>
			<Icon name="chevron" size={16} />
		</button>}
	</section>;
}
