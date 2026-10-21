import type { TurnProcessGroup } from "./turnProcess";

const MAX_LENGTH = 20;
const MIN_LENGTH = 10;

/** Derive a short plain-text title without changing the source content block. */
function candidateLabel(raw: string): string | undefined {
	const firstLine = raw.split(/\r?\n/, 1)[0].trim();
	if (!firstLine || /^(?:```|~~~|[{\[]|https?:\/\/|(?:[A-Za-z]:)?[/\\]|[\w.-]+[/\\]|(?:const|let|var|function|import|export)\s|(?:npm|npx|node|pnpm|yarn|bun|cargo|rustc|python3?|pytest|git|rg|curl|bash|powershell)\s+[A-Za-z0-9./_-])/iu.test(firstLine)) return undefined;
	if (/^[\w.-]+\.(?:ts|tsx|js|jsx|json|md|py|rs|yaml|yml|toml|txt|sh|ps1)$/iu.test(firstLine)) return undefined;
	const codeMarks = (firstLine.match(/[{}[\]`=;<>\\/]/g) ?? []).length;
	if (codeMarks > Math.max(5, Array.from(firstLine).length / 5) || (firstLine.match(/[/\\]/g) ?? []).length >= 3) return undefined;

	let text = firstLine.replace(/^\s*(?:>\s*)*/, "");
	const heading = /^#{1,6}\s*/.test(text);
	text = text.replace(/^#{1,6}\s*/, "").replace(/^[-+*]\s+/, "");
	const section = /^(?:\d+(?:\.\d+)*[.)、:：]\s*|\d+(?:\.\d+)+\s+|第[0-9一二三四五六七八九十]+[章节步][.、:：\s]*)/u;
	const numbered = section.test(text);
	text = text.replace(section, "");
	if (heading || numbered) text = text.replace(/^(?:bash|write|read|edit|grep|find|web_search|subagent|tool_call)\b\s*(?:[（(][^）)]*[）)]\s*)?(?:[:：·—-]\s*)?/iu, "");
	text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
	text = text.replace(/\*\*|__|~~|`+/g, "").replace(/\s+/g, " ").trim();
	const chars = Array.from(text);
	if (chars.length < MIN_LENGTH) return undefined;
	if (/^(?:嗯|呃|好的|当然|让我(?:想想|思考)|(?:下面|接下来)(?:我会|我将)|(?:我会|我将)(?:先)?(?:进行|开始))(?:[，,。!！\s]|$)/u.test(text)) return undefined;
	if (/^(?:okay|sure|let me (?:think|consider)|i (?:will|need to|am going to)|analysis:|thinking:)(?:\b|\s)/i.test(text)) return undefined;
	if (/^(?:[{\[]|https?:\/\/|(?:[A-Za-z]:)?[/\\]|[\w.-]+[/\\])/u.test(text)) return undefined;
	if (chars.length <= MAX_LENGTH) return text;
	let end = MAX_LENGTH;
	for (let index = MIN_LENGTH - 1; index < MAX_LENGTH; index++) {
		if (/[。！？!?；;，,、]/u.test(chars[index])) end = index + 1;
	}
	return chars.slice(0, end).join("").replace(/[，,、；;]$/u, "") + "…";
}

/** Choose one useful model phrase for a collapsed process row. */
export function processStepLabel(group: Pick<TurnProcessGroup, "entries" | "narrationTexts">): string | undefined {
	for (const text of group.narrationTexts) {
		const label = candidateLabel(text);
		if (label) return label;
	}
	for (const { block } of group.entries) {
		if (block.kind !== "thinking") continue;
		const label = candidateLabel(block.text);
		if (label) return label;
	}
	return undefined;
}
