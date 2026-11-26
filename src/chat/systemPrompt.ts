export interface SystemPromptSection {
	name: string;
	text: string;
}

export interface SystemPromptSnapshot {
	content: string;
	sections: SystemPromptSection[];
}

const SECTION_LABELS = new Map([
	["preamble", { label: "角色定位", shortLabel: "角色" }],
	["tools", { label: "可用工具", shortLabel: "工具" }],
	["rules", { label: "行为规则", shortLabel: "规则" }],
	["docs", { label: "帮助文档", shortLabel: "文档" }],
	["addendum", { label: "附加说明", shortLabel: "附加" }],
	["project_context", { label: "项目上下文", shortLabel: "项目" }],
	["skills", { label: "技能清单", shortLabel: "技能" }],
	["cwd", { label: "工作目录", shortLabel: "目录" }],
]);

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
	const measured = sections.map((section) => {
		const labels = SECTION_LABELS.get(section.name);
		return { ...section, ...measurePrompt(section.text), label: labels?.label ?? section.name, shortLabel: labels?.shortLabel, tone: labels ? section.name : "neutral" };
	});
	const total = measured.reduce((sum, section) => sum + section.characters, 0);
	return measured.map((section) => ({ ...section, share: total > 0 ? section.characters / total : 0 }));
}

interface TreemapRect { x: number; y: number; width: number; height: number }

/** Groups descending weights into strips while adding a tile improves their aspect ratios. */
export function layoutPromptTreemap<T extends { characters: number }>(sections: T[], width: number, height: number) {
	const tiles: { section: T; rect: TreemapRect }[] = [];
	const sorted = sections.filter(({ characters }) => characters > 0).sort((a, b) => b.characters - a.characters);
	const total = sorted.reduce((sum, { characters }) => sum + characters, 0);
	if (width <= 0 || height <= 0 || total === 0) return tiles;

	const areaPerCharacter = width * height / total;
	const remaining = { x: 0, y: 0, width, height };
	for (let start = 0; start < sorted.length;) {
		const column = remaining.width >= remaining.height;
		const side = column ? remaining.height : remaining.width;
		const largest = sorted[start].characters * areaPerCharacter;
		let area = largest;
		let worst = Math.max(largest / side ** 2, side ** 2 / largest);
		let end = start + 1;
		for (; end < sorted.length; end++) {
			const smallest = sorted[end].characters * areaPerCharacter;
			const nextArea = area + smallest;
			const nextWorst = Math.max(side ** 2 * largest / nextArea ** 2, nextArea ** 2 / (side ** 2 * smallest));
			if (nextWorst > worst) break;
			area = nextArea;
			worst = nextWorst;
		}

		const breadth = area / side;
		let offset = 0;
		for (const section of sorted.slice(start, end)) {
			const length = section.characters * areaPerCharacter / breadth;
			const rect = column
				? { x: remaining.x, y: remaining.y + offset, width: breadth, height: length }
				: { x: remaining.x + offset, y: remaining.y, width: length, height: breadth };
			tiles.push({ section, rect });
			offset += length;
		}
		if (column) { remaining.x += breadth; remaining.width -= breadth; }
		else { remaining.y += breadth; remaining.height -= breadth; }
		start = end;
	}
	return tiles;
}
