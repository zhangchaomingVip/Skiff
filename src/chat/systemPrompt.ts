export interface SystemPromptSection {
	name: string;
	text: string;
}

export interface SystemPromptSnapshot {
	content: string;
	sections: SystemPromptSection[];
}

const SECTION_LABELS = new Map([
	["preamble", "角色定位"],
	["tools", "可用工具"],
	["rules", "行为规则"],
	["docs", "帮助文档"],
	["addendum", "附加说明"],
	["project_context", "项目上下文"],
	["skills", "技能清单"],
	["cwd", "工作目录"],
]);
const COLORED_SECTIONS = new Set(["project_context", "rules", "skills", "docs"]);

export function assembleSystemPrompt({ content, sections }: SystemPromptSnapshot): string {
	const visible = sections.filter(({ text }) => text.length > 0);
	const parts = visible.map(({ name, text }) => {
		const trimmed = text.trim();
		if (name === "preamble" || !/^[a-z][a-z0-9_-]*$/.test(name) || (trimmed.startsWith(`<${name}>`) && trimmed.endsWith(`</${name}>`))) return text;
		return `<${name}>\n${text}\n</${name}>`;
	});
	// Some snapshots carry the rendered prompt alongside its section breakdown.
	if (content && (parts.every((part) => content.includes(part)) || content.trim() === visible.map(({ text }) => text).join("\n\n").trim())) return content;
	return [content, ...parts].filter(Boolean).join("\n\n");
}

const denseScripts = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function measurePrompt(text: string) {
	let characters = 0;
	let dense = 0;
	for (const character of text) {
		characters++;
		if (denseScripts.test(character)) dense++;
	}
	return { characters, tokens: Math.ceil(dense + (characters - dense) / 4) };
}

export function describePromptSections(sections: SystemPromptSection[]) {
	const measured = sections.map((section) => ({
		...section,
		...measurePrompt(section.text),
		label: SECTION_LABELS.get(section.name) ?? section.name,
		tone: COLORED_SECTIONS.has(section.name) ? section.name : "neutral",
	}));
	const total = measured.reduce((sum, section) => sum + section.characters, 0);
	return measured.map((section) => ({ ...section, share: total > 0 ? section.characters / total : 0 }));
}
