import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ImageAttachment, ModelInfo } from "../chat/types";
import { readImages } from "../chat/images";
import { ModelMenu } from "./ModelMenu";
import { Icon } from "./Icon";

/** Message composer: Enter sends, Shift+Enter inserts a newline. */
export function Composer({
	disabled,
	streaming,
	onSend,
	onAbort,
	text,
	onTextChange,
	models,
	model,
	onSelectModel,
	connected,
	modelDisabled,
	thinkingLevel,
	thinkingLevels,
	onThinkingLevel,
}: {
	disabled: boolean;
	streaming: boolean;
	onSend: (text: string, images?: ImageAttachment[]) => Promise<boolean>;
	onAbort: () => void;
	text: string;
	onTextChange: (text: string) => void;
	models: ModelInfo[];
	model?: ModelInfo;
	onSelectModel: (model: ModelInfo) => void;
	connected: boolean;
	modelDisabled: boolean;
	thinkingLevel?: string;
	thinkingLevels: string[];
	onThinkingLevel: (level: string) => void;
}) {
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const sendingRef = useRef(false);
	const textRef = useRef(text);
	textRef.current = text;
	const fileRef = useRef<HTMLInputElement>(null);
	const [images, setImages] = useState<ImageAttachment[]>([]);
	const [imageError, setImageError] = useState<string>();
	const [reading, setReading] = useState(false);
	const addingRef = useRef(false);
	const canUseImages = model?.input?.includes("image") ?? false;
	useEffect(() => { setImageError(undefined); }, [model?.provider, model?.id]);
	const addImages = async (files: File[]) => {
		if (!files.length || addingRef.current || sendingRef.current || streaming) return;
		addingRef.current = true; setReading(true); setImageError(undefined);
		try { const added = await readImages(files, images.length); setImages((previous) => [...previous, ...added]); }
		catch (error) { setImageError(error instanceof Error ? error.message : String(error)); }
		finally { addingRef.current = false; setReading(false); }
	};
	useEffect(() => {
		const input = inputRef.current;
		if (!input) return;
		input.style.height = "auto";
		input.style.height = `${Math.min(200, Math.max(68, input.scrollHeight))}px`;
	}, [text]);

	const submit = async () => {
		const trimmed = text.trim();
		if ((!trimmed && !images.length) || disabled || streaming || sendingRef.current || reading) return;
		if (images.length && !canUseImages) { setImageError("当前模型不支持图片，请切换到多模态模型。"); return; }
		sendingRef.current = true;
		const sentIds = new Set(images.map((image) => image.id));
		try { if (await onSend(trimmed, images)) { if (textRef.current === text) onTextChange(""); setImages((current) => current.filter((image) => !sentIds.has(image.id))); } } finally { sendingRef.current = false; }
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
			event.preventDefault();
			void submit();
		}
	};

	return (
		<div className="composer-wrap"><div className="composer" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void addImages(Array.from(event.dataTransfer.files)); }}>
			{images.length > 0 && <div className="attachment-list">{images.map((image) => <div className="attachment" key={image.id}><img src={`data:${image.mimeType};base64,${image.data}`} alt={image.name} /><button className="attachment-remove" aria-label={`移除图片 ${image.name}`} disabled={streaming || sendingRef.current} onClick={() => setImages((previous) => previous.filter((item) => item.id !== image.id))}><Icon name="close" size={12} /></button><span title={image.name}>{image.name}</span></div>)}</div>}
			{(imageError || (images.length > 0 && !canUseImages)) && <p className="attachment-error" role="alert">{imageError ?? "当前模型不支持图片，请切换到多模态模型。"}</p>}
			<textarea
				ref={inputRef}
				className="composer-input"
				rows={2}
				value={text}
				placeholder="描述任务，或提出一个问题…"
				aria-label="聊天消息"
				onChange={(event) => onTextChange(event.target.value)}
				onKeyDown={onKeyDown}
				onPaste={(event) => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); void addImages(files); } }}
			/>
			<div className="composer-bottom"><span className="composer-context"><button className="icon-btn" onClick={() => fileRef.current?.click()} disabled={streaming || reading || sendingRef.current} aria-label="上传图片" title="上传图片（也支持拖放或粘贴）"><Icon name="plus" size={20} /></button><span>{reading ? "读取中…" : "本地"}</span></span><input ref={fileRef} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { void addImages(Array.from(event.target.files ?? [])); event.target.value = ""; }} /><div className="composer-actions">
				<ModelMenu models={models} model={model} onModel={onSelectModel} disabled={!connected || modelDisabled} level={thinkingLevel} levels={thinkingLevels} onLevel={onThinkingLevel} />
				{streaming ? (
					<button className="send-btn" onClick={onAbort} aria-label="停止生成" title="停止生成">
						<Icon name="stop" size={17} />
					</button>
				) : (
					<button className="send-btn" onClick={() => void submit()} disabled={disabled || reading || (!text.trim() && !images.length) || (images.length > 0 && !canUseImages)} aria-label="发送消息" title="发送消息（Enter）">
						<Icon name="arrow" size={19} />
					</button>
				)}
			</div></div>
		</div><p className="composer-hint">Enter 发送 · Shift + Enter 换行<span>模型由 pi 提供</span></p></div>
	);
}
