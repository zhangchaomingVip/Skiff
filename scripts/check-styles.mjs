import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
export function auditStyles() {
	const files = ["src/tokens.css", "src/index.css", "src/voyage.css", "src/components/ui.css"];
	const sheets = files.map((file) => ({ file, sheet: postcss.parse(fs.readFileSync(path.join(root, file), "utf8"), { from: file }) }));
	const definitions = new Set();
	for (const { sheet } of sheets) sheet.walkDecls((decl) => { if (decl.prop.startsWith("--")) definitions.add(decl.prop); });
	// Only declared CSSProperties in our source count as runtime tokens.
	const visit = (folder) => { for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
		const name = path.join(folder, entry.name);
		if (entry.isDirectory()) visit(name);
		else if (/\.tsx?$/.test(name)) for (const match of fs.readFileSync(name, "utf8").matchAll(/["'](--[\w-]+)["']\s*:/g)) definitions.add(match[1]);
	} };
	visit(path.join(root, "src"));
	const errors = [];
	const inventory = { files, tokens: [...definitions].sort(), colors: [], fontSizes: [], radii: [], shadows: [], controlHeights: [], layers: [], duplicateSelectors: [] };
	for (const { file, sheet } of sheets) {
		for (const node of sheet.nodes) if (node.type !== "comment" && !(node.type === "atrule" && node.name === "layer")) errors.push(`Unlayered rule: ${file}:${node.source.start.line}`);
		sheet.walkAtRules("layer", (rule) => inventory.layers.push(`${file}: ${rule.params}`));
		sheet.walkDecls((decl) => {
			for (const match of decl.value.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
				// Unknown variables with a real fallback are legal. Nested var() is checked too.
				if (!definitions.has(match[1]) && match[2] !== ",") errors.push(`${file}:${decl.source.start.line}: undefined ${match[1]}`);
			}
			const location = `${file}:${decl.source.start.line} ${decl.parent.selector ?? decl.parent.name} ${decl.prop}: ${decl.value}`;
			if (/#(?:[\da-f]{3,8})\b|rgba?\(/i.test(decl.value)) { inventory.colors.push(location); if (file !== "src/tokens.css") errors.push(`Color outside tokens: ${location}`); }
			if (decl.prop === "font-size" && /\dpx/.test(decl.value)) { inventory.fontSizes.push(location); if (file !== "src/tokens.css" && !decl.parent.selector?.includes("voyage-gauge")) errors.push(`Font outside scale: ${location}`); }
			if (decl.prop.includes("border-radius") && /\d(?:px|%)/.test(decl.value)) { inventory.radii.push(location); if (file !== "src/tokens.css") errors.push(`Radius outside scale: ${location}`); }
			if (decl.prop.includes("shadow") && !decl.value.startsWith("var(") && decl.value !== "none") inventory.shadows.push(location);
			if (["height", "min-height"].includes(decl.prop) && /button|input|trigger|btn|select|control/.test(decl.parent.selector ?? "")) inventory.controlHeights.push(location);
		});
		const check = (container) => {
			const seen = new Set();
			for (const node of container.nodes ?? []) {
				if (node.type === "rule") {
					if (seen.has(node.selector)) { inventory.duplicateSelectors.push(`${file}:${node.source.start.line} ${node.selector}`); errors.push(`Duplicate selector: ${file}:${node.source.start.line} ${node.selector}`); }
					seen.add(node.selector);
				}
				if (node.type === "atrule") check(node);
			}
		};
		check(sheet);
	}
	return { errors, inventory };
}

const luminance = (hex) => {
	const rgb = hex.slice(1).match(/../g).map((v) => parseInt(v, 16) / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
	return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
};
export function contrast(a, b) { const x = luminance(a); const y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
export function auditContrast() {
	const sheet = postcss.parse(fs.readFileSync(path.join(root, "src/tokens.css"), "utf8"));
	const palette = (theme) => {
		const vars = new Map();
		sheet.walkRules((rule) => { if (rule.selector === ":root" || theme === "light" && rule.selector === '[data-theme="light"]') for (const decl of rule.nodes) if (decl.type === "decl") vars.set(decl.prop, decl.value); });
		const resolve = (name) => { const value = vars.get(name); const match = /^var\((--[\w-]+)\)$/.exec(value ?? ""); return match ? resolve(match[1]) : value; };
		return resolve;
	};
	const rows = [];
	for (const theme of ["light", "dark"]) {
		const get = palette(theme);
		for (const fg of ["--color-text-primary", "--color-text-secondary", "--color-text-tertiary", "--color-accent", "--color-success", "--color-warning", "--color-error"]) for (const bg of ["--color-bg-primary", "--color-bg-secondary", "--color-bg-tertiary", "--color-bg-hover", "--color-sidebar-bg", "--selected"]) rows.push({ theme, fg, bg, ratio: contrast(get(fg), get(bg)), minimum: 4.5 });
		rows.push({ theme, fg: "--boundary", bg: "--surface", ratio: contrast(get("--boundary"), get("--surface")), minimum: 3 });
		rows.push({ theme, fg: "--boundary", bg: "--hover", ratio: contrast(get("--boundary"), get("--hover")), minimum: 3 });
		rows.push({ theme, fg: "--danger", bg: "--error-bg", ratio: contrast(get("--danger"), get("--error-bg")), minimum: 4.5 });
		for (const fg of ["--syn-comment", "--syn-keyword", "--syn-string", "--syn-number", "--syn-title", "--syn-builtin", "--syn-attr", "--syn-meta"]) rows.push({ theme, fg, bg: "--sidebar", ratio: contrast(get(fg), get("--sidebar")), minimum: 4.5 });
		for (const bg of ["--action", "--action-hover", "--action-active"]) rows.push({ theme, fg: "--action-foreground", bg, ratio: contrast(get("--action-foreground"), get(bg)), minimum: 4.5 });
	}
	return rows;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const result = auditStyles();
	const rows = auditContrast();
	fs.writeFileSync(path.join(root, "features/009-ui-system-hardening/style-audit.json"), JSON.stringify({ ...result, contrast: rows }, null, 2) + "\n");
	const failures = rows.filter((row) => row.ratio < row.minimum);
	console.log(`Tokens: ${result.inventory.tokens.length}; style errors: ${result.errors.length}; contrast pairs: ${rows.length}; contrast failures: ${failures.length}`);
	for (const error of result.errors) console.error(error);
	for (const row of failures) console.error(`${row.theme} ${row.fg} / ${row.bg}: ${row.ratio.toFixed(2)} < ${row.minimum}`);
	if (result.errors.length || failures.length) process.exitCode = 1;
}
