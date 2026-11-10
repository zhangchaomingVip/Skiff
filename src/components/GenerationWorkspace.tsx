import { useEffect, useId, useRef, useState } from "react";
import { generationRatios, type GenerationAsset, type GenerationKind, type GenerationStudio } from "../workbench/useGenerationStudio";
import { Icon } from "./Icon";
import { Button, Chip, Dialog, IconButton, Input, Select, TextArea } from "./ui";
import "./generation-workspace.css";

const imageAccept = "image/png,image/jpeg,image/webp,image/gif";
const videoAccept = "video/mp4,video/webm,video/ogg,video/quicktime";
const titles = { image: "生图", video: "生成视频" };

function MediaView({ asset, playing = false }: { asset: Pick<GenerationAsset, "kind" | "url" | "name">; playing?: boolean }) {
	const [failed, setFailed] = useState(false);
	const videoRef = useRef<HTMLVideoElement>(null);
	useEffect(() => {
		if (playing && videoRef.current) {
			videoRef.current.play().catch(() => {});
		}
	}, [playing, asset.url]);
	if (failed) return <div className="generation-media-failed" role="status"><Icon name={asset.kind === "image" ? "image" : "video"} size={24} /><span>暂时无法预览这个文件</span></div>;
	return asset.kind === "image" ? <img src={asset.url} alt={asset.name} onError={() => setFailed(true)} /> : <video ref={videoRef} src={asset.url} aria-label={asset.name} controls={playing} autoPlay={playing} muted loop playsInline preload="metadata" onError={() => setFailed(true)} />;
}

export function GenerationControls({ kind, studio }: { kind: GenerationKind; studio: GenerationStudio }) {
	const id = useId();
	const referenceInput = useRef<HTMLInputElement>(null);
	const [dragging, setDragging] = useState(false);
	const draft = studio.drafts[kind];
	const video = kind === "video";
	const update = (patch: Partial<typeof draft>) => studio.updateDraft(kind, patch);
	return <aside className="generation-controls" aria-label={`${titles[kind]}参数`}>
		<header className="generation-controls-header"><span className="generation-mode-icon"><Icon name={video ? "video" : "imageSpark"} size={20} /></span><div><h1>{titles[kind]}</h1><p>{video ? "让画面，多一点故事" : "让想象，慢慢成形"}</p></div></header>
		<form className="generation-form" onSubmit={(event) => event.preventDefault()}>
			<div className="generation-fields">
				<div className="generation-field">
					<label htmlFor={`${id}-prompt`}>提示词 <span>Prompt</span></label>
					<TextArea id={`${id}-prompt`} rows={6} value={draft.prompt} placeholder={video ? "描述画面如何动起来：镜头缓缓推进，微风拂过窗边的花…" : "描述你想看到的画面：窗边的一束花、午后的柔光、温暖的胶片质感…"} onChange={(event) => update({ prompt: event.target.value })} />
					<p className="generation-field-hint">{video ? "试着写下主体动作、镜头运动和氛围。" : "试着写下主体、光线、色彩和你喜欢的风格。"}</p>
				</div>
				<div className="generation-field"><label htmlFor={`${id}-model`}>模型</label><Select id={`${id}-model`} value={draft.modelId} disabled aria-describedby={`${id}-service`}><option value="">连接生成服务后选择模型</option></Select></div>
				<fieldset className="generation-field generation-ratios"><legend>画面比例</legend><div role="group" aria-label="画面比例">{generationRatios.map((ratio) => <Button key={ratio} size="compact" variant="ghost" aria-pressed={draft.ratio === ratio} onClick={() => update({ ratio })}><span className="generation-ratio-shape" style={{ aspectRatio: ratio.replace(":", "/") }} aria-hidden="true" />{ratio}</Button>)}</div></fieldset>
				{video && <>
					<div className="generation-field"><label htmlFor={`${id}-motion`}>运动幅度 <output htmlFor={`${id}-motion`}>{draft.motion < 34 ? "轻柔" : draft.motion < 67 ? "适中" : "灵动"} · {draft.motion}%</output></label><Input id={`${id}-motion`} className="generation-range" type="range" min={0} max={100} step={1} value={draft.motion} onChange={(event) => update({ motion: Number(event.target.value) })} /><div className="generation-range-ends"><span>轻柔</span><span>灵动</span></div></div>
					<div className="generation-field"><label htmlFor={`${id}-duration`}>时长 <output htmlFor={`${id}-duration`}>{draft.duration} 秒</output></label><Input id={`${id}-duration`} className="generation-range" type="range" min={2} max={15} step={1} value={draft.duration} onChange={(event) => update({ duration: Number(event.target.value) })} /><div className="generation-range-ends"><span>2 秒</span><span>15 秒</span></div></div>
					<div className="generation-field"><label htmlFor={`${id}-fps`}>帧率 <output htmlFor={`${id}-fps`}>{draft.fps} fps</output></label><Input id={`${id}-fps`} className="generation-range" type="range" min={12} max={60} step={1} value={draft.fps} onChange={(event) => update({ fps: Number(event.target.value) })} /><div className="generation-range-ends"><span>12 fps</span><span>60 fps</span></div></div>
					<div className="generation-field">
						<span className="generation-field-label">首帧参考图 <small>可选</small></span>
						<Input ref={referenceInput} className="generation-file-input" type="file" accept={imageAccept} aria-label="上传首帧参考图" onChange={(event) => { const file = event.target.files?.[0]; if (file) studio.uploadReference(file); event.target.value = ""; }} />
						<div className={`generation-reference ${dragging ? "is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) studio.uploadReference(file); }}>
							{studio.reference ? <><div className="generation-reference-image"><MediaView key={studio.reference.url} asset={{ ...studio.reference, kind: "image" }} /></div><div className="generation-reference-caption"><span title={studio.reference.name}>{studio.reference.name}</span><IconButton size="compact" variant="ghost" aria-label="移除首帧参考图" onClick={studio.removeReference}><Icon name="close" /></IconButton></div><Button size="compact" variant="ghost" onClick={() => referenceInput.current?.click()}>替换图片</Button></> : <button type="button" className="generation-reference-upload" onClick={() => referenceInput.current?.click()}><Icon name="image" size={24} /><strong>添加一张起始画面</strong><span>点击上传，或将图片拖到这里</span></button>}
						</div>
						<p className="generation-field-hint">PNG、JPG、WebP、GIF · 最大 20 MB</p>
					</div>
				</>}
				{video && studio.referenceError && <div className="generation-error" role="alert"><span>{studio.referenceError}</span><IconButton size="compact" variant="ghost" aria-label="关闭文件提示" onClick={studio.clearReferenceError}><Icon name="close" /></IconButton></div>}
			</div>
			<footer className="generation-submit"><p id={`${id}-service`}><span className="generation-connection-dot" />尚未连接{video ? "视频" : "图片"}生成服务</p><Button type="submit" variant="primary" size="primary" disabled aria-describedby={`${id}-service`}><Icon name={video ? "video" : "spark"} />{video ? "生成视频" : "生成图片"}</Button><small>先收好灵感，连接服务后就能开始创作。</small></footer>
		</form>
	</aside>;
}

function GenerationEmpty({ kind, onImport }: { kind: GenerationKind; onImport: () => void }) {
	const video = kind === "video";
	return <div className="generation-empty">
		<div className="generation-empty-art" aria-hidden="true"><span className="generation-empty-back" /><span className="generation-empty-frame"><Icon name={video ? "video" : "image"} size={24} /></span><span className="generation-empty-spark"><Icon name="spark" size={16} /></span></div>
		<h2>{video ? "让灵感动起来" : "从一个画面开始"}</h2>
		<p>{video ? "一阵风、一个回眸、一段光影。\n把想象写下来，留给下一段故事。" : "一束光、一种颜色、一个小小的念头。\n写下你的灵感，让它有机会成为画面。"}</p>
		<Button variant="ghost" size="compact" onClick={onImport}><Icon name="plus" />{video ? "导入一段视频" : "导入一张图片"}</Button>
		<small>生成的作品会出现在这里，也可以先看看已有的作品。</small>
	</div>;
}

export function GenerationGallery({ kind, studio, onParameters, onBack, onImageToVideo }: { kind: GenerationKind; studio: GenerationStudio; onParameters: () => void; onBack: () => void; onImageToVideo: (asset: GenerationAsset) => void }) {
	const fileInput = useRef<HTMLInputElement>(null);
	const [selected, setSelected] = useState<GenerationAsset>();
	const assets = studio.assets.filter((asset) => asset.kind === kind);
	const video = kind === "video";
	const importMedia = () => fileInput.current?.click();
	return <section className="generation-gallery" aria-label={video ? "视频画廊" : "图片画廊"}>
		<header className="generation-workspace-header"><Button size="compact" variant="ghost" onClick={onBack}><Icon name="message" />返回对话</Button><span /><Button size="compact" variant="ghost" onClick={onParameters}><Icon name="sliders" />创作参数</Button></header>
		<div className="generation-gallery-scroll">
			<div className="generation-gallery-heading"><div><span className="generation-eyebrow">{video ? "MOTION STUDIO" : "IMAGE STUDIO"}</span><h2>{video ? "光影成片" : "灵感画廊"}<span>{assets.length.toString().padStart(2, "0")}</span></h2><p>{video ? "把静止的瞬间，接成流动的故事。" : "把脑海里的风景，留在这里。"}</p></div><Button size="compact" onClick={importMedia}><Icon name="plus" />导入作品</Button></div>
			<Input ref={fileInput} className="generation-file-input" type="file" multiple accept={video ? videoAccept : imageAccept} aria-label={video ? "导入视频作品" : "导入图片作品"} onChange={(event) => { studio.importAssets(kind, Array.from(event.target.files ?? [])); event.target.value = ""; }} />
			{studio.errors[kind] && <p className="generation-gallery-error" role="alert">{studio.errors[kind]}</p>}
			{assets.length ? <><div className="generation-gallery-grid">{assets.map((asset) => <article className="generation-card" key={asset.id}>
				<button className="generation-card-preview" aria-label={`预览${video ? "视频" : "图片"}：${asset.name}`} onClick={() => setSelected(asset)}><MediaView asset={asset} />{video && <span className="generation-card-play"><Icon name="video" size={24} /></span>}</button>
				<div className="generation-card-caption"><strong title={asset.name}>{asset.name}</strong><Chip>本地导入</Chip></div>
				{!video && <div className="generation-card-actions"><Button size="compact" onClick={() => onImageToVideo(asset)}><Icon name="video" />以此图生成视频</Button></div>}
			</article>)}</div><p className="generation-session-note">本次打开的作品 · 本地导入内容仅在当前会话中保留</p></> : <GenerationEmpty kind={kind} onImport={importMedia} />}
		</div>
		{selected && <Dialog className="generation-preview-dialog" aria-label={video ? "视频预览" : "图片预览"} onClose={() => setSelected(undefined)}><header><div><strong>{selected.name}</strong><small>{video ? "循环播放" : "图片预览"}</small></div><IconButton size="compact" variant="ghost" aria-label="关闭作品预览" onClick={() => setSelected(undefined)}><Icon name="close" /></IconButton></header><div className="generation-preview-media"><MediaView key={selected.id} asset={selected} playing /></div>{!video && <footer><Button size="compact" onClick={() => { setSelected(undefined); onImageToVideo(selected); }}><Icon name="video" />以此图生成视频</Button></footer>}</Dialog>}
	</section>;
}
