const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_WORD_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_BYTES = 512 * 1024;

export function isWordFile(file: Pick<File, "name" | "type">): boolean {
	return /\.docx$/i.test(file.name) || file.type === DOCX_MIME;
}

export function validateWordFile(file: File): void {
	if (!file.size || file.size > MAX_WORD_BYTES) throw new Error(`Word 文件不能为空，且每个不能超过 10 MiB：${file.name}`);
}

/** Read document text locally; the original binary and embedded images are not sent. */
export async function readWordText(file: File): Promise<string> {
	validateWordFile(file);
	let text: string;
	try {
		// Use the browser build in both WebView and tests; load it only for Word files.
		const { default: mammoth } = await import("mammoth/mammoth.browser.js");
		const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
		text = result.value.trim();
	} catch {
		throw new Error(`无法读取 Word 文件「${file.name}」，请确认文件未损坏、未加密，且为 .docx 格式。`);
	}
	if (!text || text.includes("\0")) throw new Error(`Word 文件「${file.name}」没有可读取的正文；仅含图片的文档请改为上传图片。`);
	if (new TextEncoder().encode(text).byteLength > MAX_TEXT_BYTES) throw new Error(`Word 文件「${file.name}」提取后的正文不能超过 512 KiB，请拆分文档后上传。`);
	return text;
}
