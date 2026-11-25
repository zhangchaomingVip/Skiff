import type { Link, Parent, Root, RootContent } from "mdast";
import type { VFile } from "vfile";

export const hostOf = (url: string) => {
	try { return new URL(url).hostname.replace(/^www\./i, ""); } catch { return ""; }
};

const plainText = (node: RootContent): string => {
	if ("value" in node && typeof node.value === "string") return node.value;
	if ("children" in node) return (node.children as RootContent[]).map(plainText).join("");
	return "";
};

/** The words just before a bare link are how the reply named that source. */
function sourceTitle(text: string) {
	const title = text.replace(/\s+/g, " ").trim()
		.replace(/[：:]\s*$/, "").trim()
		.replace(/[（(][^（()）]*[）)]?\s*$/, "").trim()
		.replace(/^[;；,，、。.·•|\-–—=>⇒→\s]+/, "")
		.replace(/[;；,，、·•|\-–—=>⇒→\s]+$/, "");
	if (title.length < 2) return "";
	return title.length > 64 ? `${title.slice(0, 63)}…` : title;
}

const sourceElement = (tag: string, properties: Record<string, string>, children: RootContent[] = []): RootContent => ({
	type: "paragraph",
	data: { hName: tag, hProperties: properties },
	children,
} as RootContent);

const CITATION_TAIL = /(?:[A-Za-z0-9_.\-]{1,24}|[^\s])[)）\]】」』”’"'.,，。;；:：!！?？]*$/u;

/**
 * A badge must never start a line on its own. A no-break space is not enough
 * next to an inline-flex box, so the last word and the badge share one nowrap span.
 */
function glueCitations(parent: Parent) {
	const next: RootContent[] = [];
	for (const child of parent.children as RootContent[]) {
		if ("children" in child) glueCitations(child as Parent);
		const isBadge = child.type === "link" && ((child as Link).data as { hProperties?: { className?: string[] } } | undefined)?.hProperties?.className?.includes("citation-badge");
		const previous = next[next.length - 1];
		if (isBadge && previous?.type === "text") {
			const text = previous.value.replace(/[\s\u00a0]+$/, "");
			const tail = text.match(CITATION_TAIL)?.[0];
			if (tail) {
				const head = text.slice(0, text.length - tail.length);
				if (head) previous.value = head; else next.pop();
				next.push({ type: "emphasis", data: { hName: "span", hProperties: { className: ["citation-nowrap"] } }, children: [{ type: "text", value: `${tail}\u00a0` }, child] } as RootContent);
				continue;
			}
		}
		next.push(child);
	}
	parent.children = next as Parent["children"];
}

/**
 * A stream cuts a labelled link in half — `[报告](https://finance.` — and GFM
 * then parses the tail as a bare URL. That fragment is not a source: collecting
 * it makes the pill and its badge flash in, then vanish once `)` arrives.
 */
function insideLink(source: string, offset: number | undefined, blockStart: number) {
	if (offset === undefined) return false;
	let depth = 0;
	for (let index = offset - 1; index >= blockStart; index--) {
		const char = source[index];
		if (char === ")") depth += 1;
		else if (char === "(") {
			if (depth > 0) depth -= 1;
			else return source[index - 1] === "]";
		}
	}
	return false;
}

/** Turn GFM autolinks into compact references and append one deduplicated source list. */
export function remarkSources({ enabled }: { enabled: boolean }) {
	return (tree: Root, file: VFile) => {
		if (!enabled) return;
		const source = String(file.value);
		const sources: { url: string; title: string }[] = [];
		const indices = new Map<string, number>();
		const visit = (parent: Parent) => {
			const blockStart = parent.position?.start.offset ?? 0;
			let segmentStart = 0;
			for (const [position, child] of parent.children.entries()) {
				if (child.type === "link") {
					const link = child as Link;
					const label = link.children.map((part) => part.type === "text" ? part.value : "").join("").trim();
					if (/^https?:\/\//i.test(link.url) && label === link.url && !insideLink(source, link.position?.start.offset, blockStart)) {
						const title = sourceTitle(parent.children.slice(segmentStart, position).map(plainText).join(""));
						let index = indices.get(link.url);
						if (index === undefined) {
							index = sources.push({ url: link.url, title });
							indices.set(link.url, index);
						} else {
							const known = sources[index - 1];
							if (known && !known.title && title) known.title = title;
						}
						// A no-break space keeps the badge on the line of the words it cites.
						const previous = parent.children[position - 1];
						if (previous?.type === "text") previous.value = previous.value.replace(/[：:]?\s*$/, "\u00a0");
						link.children = [{ type: "text", value: String(index) }];
						link.data = { ...link.data, hName: "a", hProperties: { className: ["citation-badge"], href: link.url } };
					}
					segmentStart = position + 1;
				}
				if ("children" in child) visit(child);
			}
		};
		visit(tree);
		if (!sources.length) return;
		// Badges see the title even when it was found on a later mention of the same URL.
		const decorate = (parent: Parent) => {
			for (const child of parent.children) {
				if (child.type === "link" && indices.has((child as Link).url)) {
					const source = sources[(indices.get((child as Link).url) ?? 0) - 1];
					const data = (child as Link).data as { hProperties?: Record<string, unknown> } | undefined;
					if (source && data?.hProperties) Object.assign(data.hProperties, { dataTitle: source.title, dataHost: hostOf(source.url) });
				}
				if ("children" in child) decorate(child);
			}
		};
		decorate(tree);
		glueCitations(tree);

		tree.children.push(sourceElement("div", { className: "sources-bento" }, sources.map(({ url, title }, offset) => sourceElement("a", {
			className: "source-card",
			href: url,
			title: url,
			dataTitle: title,
		}, [{ type: "text", value: String(offset + 1) }]))));
	};
}
