import type { Parent, Root, RootContent, Text } from "mdast";
import type { VFile } from "vfile";

/** Recover model-written bold spans rejected for trailing spaces or CJK punctuation. */
export function remarkLooseStrong() {
	return (tree: Root, file: VFile) => {
		const source = String(file.value);
		const repair = (node: Text): RootContent[] => {
			const start = node.position?.start.offset;
			const end = node.position?.end.offset;
			// Escapes/entities have already been decoded. Keep those nodes literal rather
			// than mistaking explicitly escaped asterisks for formatting instructions.
			if (start === undefined || end === undefined || source.slice(start, end) !== node.value) return [node];
			const parts: RootContent[] = [];
			const pattern = /(?<!\*)\*\*(?![\s*])([^*\r\n]+?)\*\*(?!\*)/gu;
			let offset = 0;
			for (const match of node.value.matchAll(pattern)) {
				if (match.index > offset) parts.push({ type: "text", value: node.value.slice(offset, match.index) });
				parts.push({ type: "strong", children: [{ type: "text", value: match[1].trimEnd() }] });
				offset = match.index + match[0].length;
			}
			if (!parts.length) return [node];
			if (offset < node.value.length) parts.push({ type: "text", value: node.value.slice(offset) });
			return parts;
		};
		const visit = (node: Parent) => {
			node.children = node.children.flatMap((child) => {
				if (child.type === "text") return repair(child);
				if ("children" in child && child.type !== "strong") visit(child);
				return [child];
			});
		};
		visit(tree);
	};
}
