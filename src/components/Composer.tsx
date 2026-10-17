import type { Delivery } from "../chat/interactions";
import { TextArea, IconButton, Button, Select } from "./ui";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ImageAttachment, ModelInfo } from "../chat/types";
import { readImages } from "../chat/images";
import { appendTextFiles, readTextFiles, type TextAttachment } from "../chat/textAttachments";
import { isWordFile } from "../chat/wordAttachments";
import { ModelMenu } from "./ModelMenu";
import { ReasoningChip } from "./ReasoningChip";
import { WebSearchToggle } from "./WebSearchToggle";
import { Icon } from "./Icon";
import type { PiCommand } from "../chat/usePiSession";
import type { WebSearchControls } from "../chat/webSearch";

const IMAGE_CAPABILITY_ERROR = "当前模型未启用图片输入，请在模型配置中确认视觉能力或切换模型。";

/** Message composer: Enter sends, Shift+Enter inserts a newline. */
export function Composer({
	disabled,
	streaming,
	stopping = false,
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
	focusSignal,
	restoredImages,
	restoredFiles,
	editing,
	onCancelEdit,
	getCommands,
	search,
	onConfigureSearch,
	onAttachmentsChange,
}: {
	disabled: boolean;
	streaming: boolean;
	stopping?: boolean;
	onSend: (text: string, images?: ImageAttachment[], delivery?: Delivery) => Promise<boolean>;
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
	focusSignal: number;
	restoredImages: ImageAttachment[];
	restoredFiles: TextAttachment[];
	editing: boolean;
	onCancelEdit: () => void;
	getCommands: () => Promise<PiCommand[]>;
	search: WebSearchControls;
	onConfigureSearch: () => void;
	onAttachmentsChange?: (images: ImageAttachment[], files: TextAttachment[]) => void;
}) {
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const sendingRef = useRef(false);
	const [delivery, setDelivery] = useState<Delivery>("steer");
	const textRef = useRef(text);
	textRef.current = text;
	const fileRef = useRef<HTMLInputElement>(null);
	const [images, setImages] = useState<ImageAttachment[]>([]);
	const [files, setFiles] = useState<TextAttachment[]>([]);
	const attachmentsRef = useRef({ images, files }); attachmentsRef.current = { images, files };
	const updateAttachments = (nextImages: ImageAttachment[], nextFiles: TextAttachment[]) => {
		attachmentsRef.current = { images: nextImages, files: nextFiles };
		setImages(nextImages); setFiles(nextFiles); onAttachmentsChange?.(nextImages, nextFiles);
	};
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
		const focus = (event: globalThis.KeyboardEvent) => { if (!event.isComposing && event.keyCode !== 229 && !document.querySelector("dialog[open]") && event.ctrlKey && event.key.toLowerCase() === "k") { event.preventDefault(); inputRef.current?.focus(); } };
		window.addEventListener("keydown", focus);
		return () => window.removeEventListener("keydown", focus);
	}, []);
	const [imageError, setImageError] = useState<string>();
	const [reading, setReading] = useState(false);
	const addingRef = useRef(false);
	const canUseImages = model?.input?.includes("image") ?? false;
	useEffect(() => { setImageError(undefined); }, [model?.provider, model?.id, canUseImages]);
	const addAttachments = async (selected: File[]) => {
		if (!selected.length || addingRef.current || sendingRef.current ) return;
		addingRef.current = true; setReading(true); setImageError(undefined);
		try {
			const imageFiles = selected.filter((file) => !isWordFile(file) && file.type.startsWith("image/"));
			const textFiles = selected.filter((file) => isWordFile(file) || !file.type.startsWith("image/"));
			const [addedImages, addedFiles] = await Promise.all([readImages(imageFiles, images.length), readTextFiles(textFiles, files.length)]);
			updateAttachments([...attachmentsRef.current.images, ...addedImages], [...attachmentsRef.current.files, ...addedFiles]);
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
		if ((!trimmed && !images.length && !files.length) || disabled || sendingRef.current || reading) return;
		if (images.length && !canUseImages) { setImageError(IMAGE_CAPABILITY_ERROR); return; }
		sendingRef.current = true;
		const sentIds = new Set(images.map((image) => image.id));
		const sentFiles = new Set(files.map((file) => file.id));
		try { if (await onSend(appendTextFiles(trimmed, files), images, delivery)) { if (textRef.current === text) onTextChange(""); updateAttachments(attachmentsRef.current.images.filter((image) => !sentIds.has(image.id)), attachmentsRef.current.files.filter((file) => !sentFiles.has(file.id))); } } finally { sendingRef.current = false; }
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.nativeEvent.isComposing || event.keyCode === 229 || document.querySelector("dialog[open]")) return;
		if (event.ctrlKey && event.shiftKey && event.key === "Backspace" && streaming) { event.preventDefault(); onAbort(); return; }
		if (event.key === "Escape") {
			event.preventDefault();
			if (menuOpen) setMenuDismissed(true);
			else if (!reading && !sendingRef.current) { if (editing) onCancelEdit(); else { onTextChange(""); updateAttachments([], []); } setImageError(undefined); }
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
		<div className="composer-wrap">{streaming && <div className="delivery-control"><Select aria-label="投递时机" value={delivery} onChange={(event) => setDelivery(event.target.value as Delivery)}><option value="steer">插话</option><option value="follow_up">等本轮做完</option></Select><span>{delivery === "steer" ? "当前工具调用结束后、下一次模型请求前插入" : "本轮没有更多待处理工作时送达"}</span></div>}<div className="composer" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void addAttachments(Array.from(event.dataTransfer.files)); }}>
			{editing && <div className="editing-banner">编辑提问 · 发送后替换本轮及后续消息<button disabled={disabled || reading || sendingRef.current} onClick={onCancelEdit} aria-label="取消编辑"><Icon name="close" size={14} /></button></div>}
			{menuOpen && <div className="composer-menu" aria-label={slash ? "命令面板" : "文件引用"}>
				{slash ? <>{options.map((command, index) => <button key={command.name} className={index === activeOption ? "focused" : ""} onClick={() => { onTextChange(`/${command.name} `); inputRef.current?.focus(); }} aria-label={`使用命令 ${command.name}`}><strong>/{command.name}</strong><span>{command.description}</span></button>)}{!options.length && <p>{commandError ? "无法读取 pi 命令，请重新连接后重试" : "暂无匹配命令"}</p>}</> : <p>输入项目相对路径，按 Enter 引用。<br />例如 @src/App.tsx · 外部文件可通过 + 添加文本或 Word 文件。</p>}
			</div>}
			{files.length > 0 && <div className="text-attachments">{files.map((file) => <div key={file.id}><Icon name={/\.docx$/i.test(file.name) ? "file" : "code"} size={14} /><span>{file.name}</span><button disabled={disabled || sendingRef.current} aria-label={`移除文件 ${file.name}`} onClick={() => updateAttachments(images, files.filter((item) => item.id !== file.id))}><Icon name="close" size={12} /></button></div>)}</div>}
			{images.length > 0 && <div className="attachment-list">{images.map((image) => <div className="attachment" key={image.id}><img src={`data:${image.mimeType};base64,${image.data}`} alt={image.name} /><button className="attachment-remove" aria-label={`移除图片 ${image.name}`} disabled={disabled || sendingRef.current} onClick={() => updateAttachments(images.filter((item) => item.id !== image.id), files)}><Icon name="close" size={12} /></button><span title={image.name}>{image.name}</span></div>)}</div>}
			{(imageError || (images.length > 0 && !canUseImages)) && <p className="attachment-error" role="alert">{imageError ?? IMAGE_CAPABILITY_ERROR}</p>}
			<TextArea
				appearance="plain"
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
			<div className="composer-bottom"><span className="composer-context"><IconButton  onClick={() => fileRef.current?.click()} disabled={disabled || reading || sendingRef.current} aria-label="添加图片、文本或 Word 文件" title="添加图片、UTF-8 文本或 Word（.docx）文件（支持拖放或粘贴）；Word 提取正文，单个最大 10 MiB"><Icon name="plus" size={20} /></IconButton><ModelMenu models={models} model={model} onModel={onSelectModel} disabled={!connected || modelDisabled} /><WebSearchToggle search={search} disabled={disabled} onConfigure={onConfigureSearch} /><ReasoningChip level={thinkingLevel} levels={thinkingLevels} disabled={!connected || modelDisabled} onLevel={onThinkingLevel} />{reading && <span>读取中…</span>}</span><input ref={fileRef} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif,text/*,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,.log,.json,.ts,.tsx,.js,.rs,.py,.yaml,.yml,.toml" onChange={(event) => { void addAttachments(Array.from(event.target.files ?? [])); event.target.value = ""; }} /><div className="composer-actions">
				{streaming && <><Button variant="primary" disabled={disabled || reading || (!text.trim() && !images.length && !files.length)} onClick={() => void submit()}>{delivery === "steer" ? "插话" : "排队发送"}</Button></>}
				{streaming ? (
					<IconButton className="send-btn" variant="primary" size="primary" onClick={onAbort} disabled={stopping || !connected} aria-label="停止生成" title="停止生成（Ctrl+Shift+Backspace）">
						<Icon name="stop" size={17} />
					</IconButton>
				) : (
					<IconButton className="send-btn" variant="primary" size="primary" onClick={() => void submit()} disabled={disabled || reading || (!text.trim() && !images.length && !files.length) || (images.length > 0 && !canUseImages)} aria-label="发送消息" title="发送消息（Enter）">
						<Icon name="arrow" size={19} />
					</IconButton>
				)}
			</div></div>
		</div><p className="composer-hint"><span><kbd>Enter</kbd> 发送 · <kbd>Shift</kbd>+<kbd>Enter</kbd> 换行</span><span><kbd>Ctrl K</kbd> 聚焦 · <kbd>Esc</kbd> 清空 · <kbd>Ctrl Shift Backspace</kbd> 停止</span></p></div>
	);
}
