export interface SearchHit {
	title: string;
	url: string;
	source: string;
	content: string;
}

export interface SearchDetails {
	intro: string;
	results: SearchHit[];
}

/** Tool links are external navigation, never executable or credential-bearing URLs. */
export function searchSource(value: string): string | undefined {
	try {
		const url = new URL(value);
		if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return undefined;
		return url.hostname;
	} catch { return undefined; }
}

/** Read the web_search extension's heading / URL / excerpt format without splitting excerpt headings. */
export function parseSearchDetails(text: string): SearchDetails {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	const intro: string[] = [];
	const results: SearchHit[] = [];
	let current: SearchHit | undefined;
	let fence: string | undefined;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
		const heading = !fence && /^###\s+(.+?)\s*$/.exec(line);
		const url = lines[i + 1]?.trim() ?? "";
		const source = heading ? searchSource(url) : undefined;
		if (heading && source) {
			current = { title: heading[1], url, source, content: "" };
			results.push(current);
			i++;
			continue;
		}
		if (marker) {
			if (!fence) fence = marker;
			else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
		}
		if (current) current.content += `${line}\n`;
		else intro.push(line);
	}
	return { intro: intro.join("\n").trim().replace(/^摘要[：:]\s*/, ""), results: results.map((hit) => ({ ...hit, content: hit.content.trim() })) };
}
