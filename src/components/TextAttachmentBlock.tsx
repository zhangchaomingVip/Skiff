import type { ParsedAttachment } from "../chat/textAttachments";
import { CopyButton } from "./CopyButton";
import { Icon } from "./Icon";

const formatBytes = (length: number): string => length < 1024 ? `${length} B` : `${(length / 1024).toFixed(1)} KiB`;

/** Collapsed card for a text file that was appended to a user prompt. */
export function TextAttachmentBlock({ attachment }: { attachment: ParsedAttachment }) {
	const word = /\.docx$/i.test(attachment.name);
	const lines = attachment.content ? attachment.content.split("\n").length : 0;
	return <details className="text-attachment">
		<summary><Icon name={word ? "file" : "code"} size={14} /><span className="text-attachment-name">{attachment.name}</span><span className="text-attachment-meta">{lines} 行 · {formatBytes(new TextEncoder().encode(attachment.content).byteLength)}</span></summary>
		<div className="text-attachment-head"><span>{word ? "Word 正文（不含图片与排版）" : "附件内容"}</span><CopyButton text={attachment.content} label="复制附件内容" /></div>
		<pre>{attachment.content}</pre>
	</details>;
}
