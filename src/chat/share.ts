import type { ChatMessage, ContentBlock } from "./types";

function indentQuote(text: string): string {
	return text.split("\n").map((line) => `> ${line}`).join("\n");
}

function blockToMarkdown(block: ContentBlock): string {
	switch (block.kind) {
		case "text":
			return block.text;
		case "image":
			return `![图片](data:${block.mimeType};base64,${block.data})`;
		case "thinking":
			return `**思考过程**\n\n${indentQuote(block.text)}`;
		case "tool":
			return `**工具调用：${block.name}**\n\n\`\`\`json\n${block.argsText || "{}"}\n\`\`\``;
		case "toolResult":
			return `**工具结果：${block.name}${block.isError ? "（失败）" : ""}**\n\n${block.diff ? `${block.text}\n\n\`\`\`diff\n${block.diff}\n\`\`\`` : block.text}`;
	}
}

/** Convert one rendered message into the Markdown used by the share action. */
export function messageToShareMarkdown(message: ChatMessage): string {
	return message.blocks.map(blockToMarkdown).filter(Boolean).join("\n\n").trim();
}

/** Create a complete, portable transcript without exposing session file paths. */
export function conversationToShareMarkdown(title: string | undefined, messages: ChatMessage[]): string {
	const heading = title?.replace(/\s+/g, " ").trim() || "Skiff 对话";
	const sections = messages.map((message) => {
		const content = messageToShareMarkdown(message);
		if (!content) return "";
		return `## ${message.role === "user" ? "你" : "Skiff"}\n\n${content}`;
	}).filter(Boolean);
	return [`# ${heading}`, ...sections].join("\n\n").trim() + "\n";
}
