import type { TurnProcessGroup } from "./turnProcess";

const MIN_LENGTH = 10;

/** Clean each prose line before joining it into the single-line preview. */
function candidateLine(raw: string): string | undefined {
	const firstLine = raw.trim();
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
	if (/^(?:嗯|呃|好的|当然|让我(?:想想|思考)|(?:下面|接下来)(?:我会|我将)|(?:我会|我将)(?:先)?(?:进行|开始))(?:[，,。!！\s]|$)/u.test(text)) return undefined;
	if (/^(?:okay|sure|let me (?:think|consider)|i (?:will|need to|am going to)|analysis:|thinking:)(?:\b|\s)/i.test(text)) return undefined;
	if (/^(?:[{\[]|https?:\/\/|(?:[A-Za-z]:)?[/\\]|[\w.-]+[/\\])/u.test(text)) return undefined;
	return text;
}

/** Fold prose across line breaks; the row handles truncation to its available width. */
function candidateLabel(raw: string): string | undefined {
	const parts: string[] = [];
	let fence: string | undefined;
	for (const line of raw.split(/\r?\n/)) {
		const marker = /^\s*(`{3,}|~{3,})/.exec(line);
		if (marker) {
			if (!fence) fence = marker[1][0];
			else if (marker[1][0] === fence) fence = undefined;
			continue;
		}
		if (fence) continue;
		const text = candidateLine(line);
		if (text) parts.push(text);
	}
	const text = parts.join(" ");
	return Array.from(text).length >= MIN_LENGTH ? text : undefined;
}

/** Summarize collapsed thinking only; narration is already visible in the reply. */
export function processStepLabel(group: Pick<TurnProcessGroup, "entries">): string | undefined {
	for (const { block } of group.entries) {
		if (block.kind !== "thinking") continue;
		const label = candidateLabel(block.text);
		if (label) return label;
	}
	return undefined;
}

/** Only the current latest block may supply a live preview, never an earlier thought. */
export function latestThinkingLabel(group: Pick<TurnProcessGroup, "entries">): string | undefined {
	const latest = group.entries[group.entries.length - 1]?.block;
	if (latest?.kind !== "thinking") return undefined;
	let fence: string | undefined;
	const prose: string[] = [];
	for (const line of latest.text.split(/\r?\n/)) {
		const marker = /^\s*(`{3,}|~{3,})/.exec(line);
		if (marker) { if (!fence) fence = marker[1][0]; else if (marker[1][0] === fence) fence = undefined; continue; }
		if (fence) continue;
		const clean = candidateLine(line);
		if (clean && Array.from(clean).length >= MIN_LENGTH) prose.push(clean);
	}
	const line = prose[prose.length - 1];
	if (!line) return undefined;
	const sentences = line.split(/(?<=[。！？])|(?<=[.!?])\s+/u).filter((part) => Array.from(part.trim()).length >= MIN_LENGTH);
	const tail = sentences[sentences.length - 1]?.trim() ?? line;
	const chars = Array.from(tail);
	return chars.length > 120 ? `…${chars.slice(-120).join("")}` : tail;
}
