import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ImageAttachment, ModelInfo } from "../chat/types";
import { readImages } from "../chat/images";
import { appendTextFiles, readTextFiles, type TextAttachment } from "../chat/textAttachments";
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
	onSetMaxTokens,
	focusSignal,
	restoredImages,
	restoredFiles,
	editing,
	onCancelEdit,
	getCommands,
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
	onSetMaxTokens: (maxTokens: number | null) => void;
	focusSignal: number;
	restoredImages: ImageAttachment[];
	restoredFiles: TextAttachment[];
	editing: boolean;
	onCancelEdit: () => void;
	getCommands: () => Promise<{ name: string; description?: string }[]>;
}) {
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const sendingRef = useRef(false);
	const textRef = useRef(text);
	textRef.current = text;
	const fileRef = useRef<HTMLInputElement>(null);
	const [images, setImages] = useState<ImageAttachment[]>([]);
	const [files, setFiles] = useState<TextAttachment[]>([]);
	const [commands, setCommands] = useState<{ name: string; description?: string }[]>([]);
	const [commandError, setCommandError] = useState(false);
	const [menuDismissed, setMenuDismissed] = useState(false);
	const [activeOption, setActiveOption] = useState(0);
	const slash = /^\/([^\s]*)$/.exec(text);
	const mention = /(?:^|\s)@([^\n]*)$/.exec(text);
	const options = commands.filter((command) => command.name.toLowerCase().includes(slash?.[1].toLowerCase() ?? ""));
	const menuOpen = !menuDismissed && !!(slash || mention);
	useEffect(() => { setMenuDismissed(false); setActiveOption(0); }, [text]);
	useEffect(() => { setImages(restoredImages); setFiles(restoredFiles); }, [restoredImages, restoredFiles]);
	useEffect(() => { if (focusSignal) inputRef.current?.focus(); }, [focusSignal]);
	useEffect(() => {
		let cancelled = false;
		if (connected) void getCommands().then((items) => { if (!cancelled) { setCommands(items); setCommandError(false); } }).catch(() => { if (!cancelled) setCommandError(true); });
		return () => { cancelled = true; };
	}, [connected, getCommands]);
	useEffect(() => {
		const focus = (event: globalThis.KeyboardEvent) => { if (event.ctrlKey && event.key.toLowerCase() === "k") { event.preventDefault(); inputRef.current?.focus(); } };
		window.addEventListener("keydown", focus);
		return () => window.removeEventListener("keydown", focus);
	}, []);
	const [imageError, setImageError] = useState<string>();
	const [reading, setReading] = useState(false);
	const addingRef = useRef(false);
	const canUseImages = model?.input?.includes("image") ?? false;
	useEffect(() => { setImageError(undefined); }, [model?.provider, model?.id]);
	const addAttachments = async (selected: File[]) => {
		if (!selected.length || addingRef.current || sendingRef.current || streaming) return;
		addingRef.current = true; setReading(true); setImageError(undefined);
		try {
			const imageFiles = selected.filter((file) => file.type.startsWith("image/"));
			const textFiles = selected.filter((file) => !file.type.startsWith("image/"));
			const [addedImages, addedFiles] = await Promise.all([readImages(imageFiles, images.length), readTextFiles(textFiles, files.length)]);
			setImages((previous) => [...previous, ...addedImages]); setFiles((previous) => [...previous, ...addedFiles]);
		}
		catch (error) { setImageError(error instanceof Error ? error.message : String(error)); }
		finally { addingRef.current = false; setReading(false); }
	};
	useEffect(() => {
		const input = inputRef.current;
		if (!input) return;
		input.style.height = "auto";
		input.style.height = `${Math.min(200, Math.max(36, input.scrollHeight))}px`;
	}, [text]);

	const submit = async () => {
		const trimmed = text.trim();
		if ((!trimmed && !images.length && !files.length) || disabled || streaming || sendingRef.current || reading) return;
		if (images.length && !canUseImages) { setImageError("当前模型不支持图片，请切换到多模态模型。"); return; }
		sendingRef.current = true;
		const sentIds = new Set(images.map((image) => image.id));
		const sentFiles = new Set(files.map((file) => file.id));
		try { if (await onSend(appendTextFiles(trimmed, files), images)) { if (textRef.current === text) onTextChange(""); setImages((current) => current.filter((image) => !sentIds.has(image.id))); setFiles((current) => current.filter((file) => !sentFiles.has(file.id))); } } finally { sendingRef.current = false; }
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.nativeEvent.isComposing || event.keyCode === 229) return;
		if (event.key === "Escape") {
			event.preventDefault();
			if (menuOpen) setMenuDismissed(true);
			else if (streaming) onAbort();
			else if (!reading && !sendingRef.current) { if (editing) onCancelEdit(); else onTextChange(""); setImages([]); setFiles([]); setImageError(undefined); }
			return;
		}
		if (menuOpen && (event.key === "ArrowDown" || event.key === "ArrowUp") && slash) { event.preventDefault(); setActiveOption((index) => Math.max(0, Math.min(options.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))); return; }
		if (menuOpen && !event.shiftKey && (event.key === "Enter" || event.key === "Tab")) {
			if (slash && options[activeOption]) { event.preventDefault(); onTextChange(`/${options[activeOption].name} `); return; }
			if (mention && mention[1].trim()) { event.preventDefault(); onTextChange(text.slice(0, text.lastIndexOf("@")) + `\`${mention[1].trim().replace(/`/g, "")}\` `); return; }
		}
		if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
			event.preventDefault();
			void submit();
		}
	};

	return (
		<div className="composer-wrap"><div className="composer" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void addAttachments(Array.from(event.dataTransfer.files)); }}>
			{editing && <div className="editing-banner">编辑提问 · 发送后替换本轮及后续消息<button disabled={streaming || reading || sendingRef.current} onClick={() => { onCancelEdit(); setFiles([]); }} aria-label="取消编辑"><Icon name="close" size={14} /></button></div>}
			{menuOpen && <div className="composer-menu" aria-label={slash ? "命令面板" : "文件引用"}>
				{slash ? <>{options.map((command, index) => <button key={command.name} className={index === activeOption ? "focused" : ""} onClick={() => { onTextChange(`/${command.name} `); inputRef.current?.focus(); }} aria-label={`使用命令 ${command.name}`}><strong>/{command.name}</strong><span>{command.description}</span></button>)}{!options.length && <p>{commandError ? "无法读取 pi 命令，请重新连接后重试" : "暂无匹配命令"}</p>}</> : <p>输入项目相对路径，按 Enter 引用。<br />例如 @src/App.tsx · 外部文件可通过 + 附加文本内容。</p>}
			</div>}
			{files.length > 0 && <div className="text-attachments">{files.map((file) => <div key={file.id}><Icon name="code" size={14} /><span>{file.name}</span><button disabled={streaming || sendingRef.current} aria-label={`移除文本文件 ${file.name}`} onClick={() => setFiles((items) => items.filter((item) => item.id !== file.id))}><Icon name="close" size={12} /></button></div>)}</div>}
			{images.length > 0 && <div className="attachment-list">{images.map((image) => <div className="attachment" key={image.id}><img src={`data:${image.mimeType};base64,${image.data}`} alt={image.name} /><button className="attachment-remove" aria-label={`移除图片 ${image.name}`} disabled={streaming || sendingRef.current} onClick={() => setImages((previous) => previous.filter((item) => item.id !== image.id))}><Icon name="close" size={12} /></button><span title={image.name}>{image.name}</span></div>)}</div>}
			{(imageError || (images.length > 0 && !canUseImages)) && <p className="attachment-error" role="alert">{imageError ?? "当前模型不支持图片，请切换到多模态模型。"}</p>}
			<textarea
				ref={inputRef}
				className="composer-input"
				rows={1}
				value={text}
				placeholder="描述任务… / 命令 · @文件路径"
				aria-label="聊天消息"
				onChange={(event) => onTextChange(event.target.value)}
				onKeyDown={onKeyDown}
				onPaste={(event) => { const selected = Array.from(event.clipboardData.files); if (selected.length) { event.preventDefault(); void addAttachments(selected); } }}
			/>
			<div className="composer-bottom"><span className="composer-context"><button className="icon-btn" onClick={() => fileRef.current?.click()} disabled={streaming || reading || sendingRef.current} aria-label="添加图片或文本文件" title="添加图片或 UTF-8 文本文件（支持拖放或粘贴）"><Icon name="plus" size={20} /></button><span>{reading ? "读取中…" : "添加附件"}</span></span><input ref={fileRef} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif,text/*,.log,.json,.ts,.tsx,.js,.rs,.py,.yaml,.yml,.toml" onChange={(event) => { void addAttachments(Array.from(event.target.files ?? [])); event.target.value = ""; }} /><div className="composer-actions">
				<ModelMenu models={models} model={model} onModel={onSelectModel} disabled={!connected || modelDisabled} level={thinkingLevel} levels={thinkingLevels} onLevel={onThinkingLevel} onMaxTokens={onSetMaxTokens} />
				{streaming ? (
					<button className="send-btn" onClick={onAbort} aria-label="停止生成" title="停止生成">
						<Icon name="stop" size={17} />
					</button>
				) : (
					<button className="send-btn" onClick={() => void submit()} disabled={disabled || reading || (!text.trim() && !images.length && !files.length) || (images.length > 0 && !canUseImages)} aria-label="发送消息" title="发送消息（Enter）">
						<Icon name="arrow" size={19} />
					</button>
				)}
			</div></div>
		</div><p className="composer-hint">Enter 发送 · Shift + Enter 换行<span>Ctrl K 聚焦 · Esc 清空 / 停止</span></p></div>
	);
}
