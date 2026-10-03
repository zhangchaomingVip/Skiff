export interface TextAttachment { id: string; name: string; text: string }

export async function readTextFiles(files: File[], currentCount: number): Promise<TextAttachment[]> {
	if (currentCount + files.length > 4) throw new Error("每条消息最多添加 4 个文本文件。");
	return Promise.all(files.map(async (file) => {
		if (!file.size || file.size > 512 * 1024) throw new Error("文本文件不能为空，且每个不能超过 512 KiB。");
		const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
		if (text.includes("\0")) throw new Error(`不支持二进制文件：${file.name}`);
		return { id: crypto.randomUUID(), name: file.name, text };
	}));
}

export interface ParsedAttachment { name: string; content: string }

/** Split a sent prompt back into prose and its appended text attachments. */
export function splitAttachments(text: string): { text: string; attachments: ParsedAttachment[] } {
	const block = /^附件：(.+)\n(`{3,})text\n([\s\S]*?)\n\2$/gm;
	const attachments: ParsedAttachment[] = [];
	let prose = "";
	let cursor = 0;
	for (const match of text.matchAll(block)) {
		prose += text.slice(cursor, match.index);
		attachments.push({ name: match[1], content: match[3] });
		cursor = (match.index ?? 0) + match[0].length;
	}
	prose += text.slice(cursor);
	return { text: prose.replace(/\n{3,}/g, "\n\n").trim(), attachments };
}

export function appendTextFiles(text: string, files: TextAttachment[]): string {
	return [text, ...files.map((file) => {
		const fence = "`".repeat(Math.max(3, ...Array.from(file.text.matchAll(/`+/g), (match) => match[0].length + 1)));
		return `附件：${file.name}\n${fence}text\n${file.text}\n${fence}`;
	})].filter(Boolean).join("\n\n");
}
