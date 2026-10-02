import type { ReactNode } from "react";

type Part = { kind: "text"; text: string } | { kind: "code"; lang: string; code: string };

/** Split text into prose and fenced code blocks. */
function splitFences(text: string): Part[] {
	const parts: Part[] = [];
	let prose: string[] = [];
	let code: string[] = [];
	let lang = "";
	let inCode = false;

	for (const line of text.split("\n")) {
		const fence = /^```(\w*)\s*$/.exec(line);
		if (fence) {
			if (inCode) {
				parts.push({ kind: "code", lang, code: code.join("\n") });
				code = [];
				inCode = false;
			} else {
				if (prose.length) {
					parts.push({ kind: "text", text: prose.join("\n") });
					prose = [];
				}
				lang = fence[1] ?? "";
				inCode = true;
			}
			continue;
		}
		if (inCode) code.push(line);
		else prose.push(line);
	}

	if (inCode) parts.push({ kind: "code", lang, code: code.join("\n") });
	if (prose.length) parts.push({ kind: "text", text: prose.join("\n") });
	return parts;
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\([^)\n]+\))/g;

function renderInline(text: string): ReactNode[] {
	const nodes: ReactNode[] = [];
	let cursor = 0;
	let key = 0;
	let match: RegExpExecArray | null;

	INLINE.lastIndex = 0;
	while ((match = INLINE.exec(text)) !== null) {
		if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
		const token = match[0];
		if (token.startsWith("`")) {
			nodes.push(
				<code key={key++} className="inline-code">
					{token.slice(1, -1)}
				</code>,
			);
		} else if (token.startsWith("**")) {
			nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
		} else {
			const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(token);
			if (link) {
				nodes.push(
					<a key={key++} href={link[2]} target="_blank" rel="noreferrer">
						{link[1]}
					</a>,
				);
			} else {
				nodes.push(token);
			}
		}
		cursor = match.index + token.length;
	}
	if (cursor < text.length) nodes.push(text.slice(cursor));
	return nodes;
}

/**
 * Dependency-free Markdown: fenced code blocks, inline code, bold and links.
 * Everything else is rendered as pre-wrapped plain text — enough for chat
 * replies without pulling in a parser, and easy to swap later.
 */
export function Markdown({ text }: { text: string }) {
	return (
		<div className="md">
			{splitFences(text).map((part, index) =>
				part.kind === "code" ? (
					<pre key={index} className="code-block" data-lang={part.lang || undefined}>
						<code>{part.code}</code>
					</pre>
				) : (
					<p key={index} className="md-text">
						{renderInline(part.text)}
					</p>
				),
			)}
		</div>
	);
}
