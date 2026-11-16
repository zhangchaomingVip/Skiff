import { useRef, type CSSProperties } from "react";
import type { GenerationKind, GenerationStudio } from "../workbench/useGenerationStudio";
import { canvasLabel } from "../workbench/designCanvases";
import { GenerationControls } from "./GenerationWorkspace";
import { Icon } from "./Icon";
import { SegmentedControl } from "./ui";
import "./generation-workspace.css";

/** Quick suffixes keep the row one line: they extend the current sentence instead
 *  of replacing it, so a half-written prompt is never lost. */
const quickTags = ["电影感光影", "对称构图", "暖色调", "大量留白", "长曝光", "细节特写"];

/** Style starters for the inspiration shelf: a subject, a light and a palette in
 *  one line, so a click produces a prompt you can immediately edit. */
export const stylePresets = [
	{ name: "胶片氛围", tone: 24, prompt: "午后窗边的一束花，温暖的胶片颗粒，奶油色的柔光" },
	{ name: "微距摄影", tone: 16, prompt: "花蕊的微距特写，浅景深，柔和的自然光，露珠反光" },
	{ name: "赛博朋克", tone: 32, prompt: "雨夜的霓虹街角，湿润的路面反光，青紫色灯光" },
	{ name: "极简产品", tone: 12, prompt: "极简产品静物，纯色背景，柔和的投影，工作室布光" },
	{ name: "柔光人像", tone: 20, prompt: "自然光下的柔光人像，浅色背景，真实的皮肤质感" },
	{ name: "复古杂志", tone: 28, prompt: "复古杂志封面构图，纸张纹理，低饱和的暖色调" },
];

export function StudioPromptHero({ kind, studio, onKind, onConfigure, onSubmitted }: {
	kind: GenerationKind;
	studio: GenerationStudio;
	onKind: (kind: GenerationKind) => void;
	onConfigure: () => void;
	onSubmitted?: () => void;
}) {
	const host = useRef<HTMLDivElement>(null);
	const draft = studio.drafts[kind];
	const promptInput = () => host.current?.querySelector<HTMLTextAreaElement>("textarea");
	const appendTag = (tag: string) => {
		const current = draft.prompt.trim();
		studio.updateDraft(kind, { prompt: current ? `${current}，${tag}` : tag });
		requestAnimationFrame(() => promptInput()?.focus());
	};
	return <section className="studio-home" aria-label="创作首页" ref={host}>
		<div className="studio-greeting">
			<h1>你好，今天想创作什么？</h1>
			<p>写下画面，或把参考图拖进卡片；作品会自动收进「{canvasLabel(studio.canvases, studio.canvasId)}」。</p>
		</div>
		<div className="design-composer" data-variant="hero">
			<GenerationControls
				kind={kind}
				studio={studio}
				onConfigure={onConfigure}
				onSubmitted={onSubmitted}
				variant="hero"
				modeSwitch={<SegmentedControl label="创作类型" value={kind} onChange={onKind} options={[{ value: "image", label: "图片" }, { value: "video", label: "视频" }]} />}
			/>
		</div>
		<div className="studio-prompt-tags" role="group" aria-label="快捷灵感">
			{quickTags.map((tag) => <button key={tag} type="button" className="studio-prompt-tag" onClick={() => appendTag(tag)}>{`/${tag}`}</button>)}
		</div>
	</section>;
}

/** The launcher keeps no history: below the card the page only offers starting
 *  points. Applying one fills the prompt and sends the user back to the card. */
export function StudioInspiration({ onApply }: { onApply: (prompt: string) => void }) {
	return <section className="studio-inspiration" aria-label="灵感库">
		<header className="studio-inspiration-heading">
			<h2>灵感库</h2>
			<p>从一种风格开始，点一下填入提示词。</p>
		</header>
		<div className="studio-inspiration-grid">
			{stylePresets.map((preset) => <button key={preset.name} type="button" className="studio-inspiration-card" aria-label={`使用${preset.name}灵感`} style={{ "--studio-tone": `${preset.tone}%` } as CSSProperties} onClick={() => onApply(preset.prompt)}>
				<span className="studio-inspiration-cover" aria-hidden="true"><Icon name="imageSpark" size={16} /></span>
				<span className="studio-inspiration-copy"><strong>{preset.name}</strong><small>{preset.prompt}</small></span>
			</button>)}
		</div>
	</section>;
}
