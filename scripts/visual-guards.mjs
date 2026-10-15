import ts from "typescript";

const textClass = /voyage-gauge-(?:label|number|unit|limit)/;
const textAncestor = /\.(?:voyage-gauge-(?:scene|svg|readout|label|number|unit|limit)|voyage-dashboard|voyage-rail|chat-and-rail)(?:[.:#\[]|$)/;
export function themeVariables(sheet, theme) {
	const vars = new Map();
	sheet.walkRules((rule) => {
		if (rule.selector === ":root" || theme === "light" && rule.selector === '[data-theme="light"]') {
			for (const decl of rule.nodes) if (decl.type === "decl") vars.set(decl.prop, decl.value);
		}
	});
	const resolve = (value, seen = new Set()) => {
		const match = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value ?? "");
		if (!match) return value;
		if (seen.has(match[1])) return undefined;
		return resolve(vars.get(match[1]), new Set([...seen, match[1]]));
	};
	return { vars, resolve, get: (name) => resolve(vars.get(name)) };
}

/** Static guardrails complement rendered CTM/font/opacity checks. */
export function auditVisualGuards(sheets, sources) {
	const errors = [];
	const tokenSheet = sheets.find(({ file }) => file === "src/tokens.css").sheet;
	const palettes = ["dark", "light"].map((theme) => ({ theme, ...themeVariables(tokenSheet, theme) }));
	const checkFont = (value, location) => {
		for (const palette of palettes) {
			const resolved = palette.resolve(value);
			if (!/^\d+(?:\.\d+)?px$/.test(resolved ?? "") || parseFloat(resolved) < 11) errors.push(`Gauge font below minimum or unresolved: ${location} (${palette.theme}: ${resolved})`);
		}
	};
	for (const { file, sheet } of sheets) sheet.walkDecls((decl) => {
		const selector = decl.parent.selector ?? "";
		const location = `${file}:${decl.source.start.line}`;
		if (decl.prop === "font-size" && /voyage-gauge/.test(selector)) checkFont(decl.value, location);
		if (decl.prop === "opacity" && Number(decl.value) < 1 && selector.split(",").some((part) => textAncestor.test(part.trim().split(/\s+|\s*>\s*/).at(-1)) || /(?:voyage-dashboard|voyage-gauge-svg)\s+\*$/.test(part))) errors.push(`Gauge text ancestor opacity: ${location}`);
	});
	for (const { file, source } of sources) {
		if (!file.endsWith(".tsx")) continue;
		const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
		const literal = (node) => node && (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) ? node.text : undefined;
		const attrValue = (attr) => attr.initializer && ts.isJsxExpression(attr.initializer) ? literal(attr.initializer.expression) : literal(attr.initializer);
		const visit = (node) => {
			let critical = false;
			if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
				const opening = ts.isJsxElement(node) ? node.openingElement : node;
				const attrs = opening.attributes.properties.filter(ts.isJsxAttribute);
				const tag = opening.tagName.getText(tree);
				const classes = attrs.find((attr) => attr.name.getText(tree) === "className");
				critical = file.endsWith("VoyageRail.tsx") && tag === "text" || tag === "Gauge" || textClass.test(attrValue(classes ?? {}) ?? "");
				if (ts.isJsxElement(node)) for (const child of node.children) critical = visit(child) || critical;
				const location = `${file}:${tree.getLineAndCharacterOfPosition(opening.pos).line + 1}`;
				for (const attr of attrs) {
					const name = attr.name.getText(tree);
					if (critical && name === "fontSize") checkFont(attrValue(attr), location);
					if (critical && name === "opacity" && Number(attrValue(attr)) < 1) errors.push(`Gauge text ancestor opacity: ${location}`);
					if (name === "style" && attr.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression && ts.isObjectLiteralExpression(attr.initializer.expression)) {
						for (const prop of attr.initializer.expression.properties) if (critical && ts.isPropertyAssignment(prop)) {
							const key = prop.name.getText(tree).replace(/["']/g, "");
							if (key === "fontSize") checkFont(literal(prop.initializer), location);
							if (key === "opacity" && Number(literal(prop.initializer)) < 1) errors.push(`Gauge text ancestor opacity: ${location}`);
						}
					}
				}
			} else ts.forEachChild(node, (child) => { critical = visit(child) || critical; });
			return critical;
		};
		visit(tree);
	}
	for (const name of ["--shadow-color", "--shadow-elevation-1", "--shadow-elevation-2", "--shadow-elevation-3"]) {
		for (const selector of [":root", '[data-theme="light"]']) {
			let value;
			tokenSheet.walkRules((rule) => { if (rule.selector === selector) rule.walkDecls(name, (decl) => { value = decl.value; }); });
			if (!value) errors.push(`Missing paired shadow: ${selector} ${name}`);
			if (value && selector !== ":root") {
				const alphas = [...value.matchAll(/rgba?\([^)]*?(?:,|\/)\s*(\.?\d+(?:\.\d+)?)\s*\)/g)].map((match) => Number(match[1]));
				if (!alphas.length || alphas.some((alpha) => alpha > .12)) errors.push(`Light shadow alpha exceeds .12: ${name}`);
			}
		}
	}
	return errors;
}
