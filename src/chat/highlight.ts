import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

// A curated set keeps the bundle small; unknown languages fall back to plain text.
const languages = { bash, c, cpp, csharp, css, diff, go, ini, java, javascript, json, markdown, python, rust, sql, typescript, xml, yaml };
for (const [name, language] of Object.entries(languages)) hljs.registerLanguage(name, language);

const aliases: Record<string, string> = {
	js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
	ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
	py: "python", rs: "rust", sh: "bash", shell: "bash", zsh: "bash", console: "bash",
	html: "xml", htm: "xml", svg: "xml", vue: "xml", md: "markdown", yml: "yaml", toml: "ini",
	h: "c", hpp: "cpp", cc: "cpp", cs: "csharp", golang: "go",
	text: "", txt: "", plaintext: "", plain: "",
};

/** Highlight a fenced code block; returns escaped HTML, or undefined to render plain. */
export function highlightCode(code: string, language: string): string | undefined {
	const name = aliases[language.toLowerCase()] ?? language.toLowerCase();
	if (!name || !hljs.getLanguage(name)) return undefined;
	try {
		return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
	} catch {
		return undefined;
	}
}
