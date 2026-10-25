import type { ContentBlock } from "./types";

type Tool = Extract<ContentBlock, { kind: "tool" }>;

/** Collapsed command rows show a deterministic action title instead of the raw command. */
export interface CommandRowTitle {
	title: string;
	/** "mapped" hit the builtin table, "program" names the main program, "fallback" could not parse. */
	source: "mapped" | "program" | "fallback";
}

const SHELL_LABELS: Record<string, string> = {
	bash: "Bash",
	sh: "Shell",
	zsh: "Zsh",
	fish: "Fish",
	powershell: "PowerShell",
	pwsh: "PowerShell",
	cmd: "CMD",
};

/** Tools whose own name names the shell use it; generic executors fall back to the host platform. */
export function shellLabel(toolName: string): string {
	const label = SHELL_LABELS[toolName.toLowerCase()];
	if (label) return label;
	const windows = typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);
	return windows ? "PowerShell" : "Bash";
}

const HIGH_RISK_PROGRAMS = new Set(["rm", "del", "remove-item", "ri", "erase", "rd", "rmdir"]);
const TEST_RUNNERS = new Set(["vitest", "jest", "mocha", "pytest", "py.test", "tox", "rspec", "phpunit", "karma", "ctest"]);
const PACKAGE_RUNNERS = new Set(["npm", "pnpm", "yarn", "bun", "npx", "pnpx", "uvx", "dlx"]);

interface ParsedCommand {
	program: string;
	args: string[];
}

/** Quoted tokens, env assignments and path suffixes are normalized away. */
function tokenize(segment: string): string[] {
	return segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
}

function basename(token: string): string {
	const unquoted = token.replace(/^["']|["']$/g, "");
	return (unquoted.split(/[\\/]/).pop() ?? "").replace(/\.(exe|cmd|bat|ps1)$/i, "");
}

function parseSegment(segment: string): ParsedCommand | undefined {
	const tokens = tokenize(segment.trim());
	while (tokens.length && /^[A-Za-z_][\w.-]*=/.test(tokens[0])) tokens.shift();
	while (tokens[0] === "sudo" || tokens[0] === "nohup") tokens.shift();
	if (!tokens.length) return undefined;
	const program = basename(tokens[0]);
	if (!program) return undefined;
	return { program, args: tokens.slice(1) };
}

/** Anything but a plain command or a leading `cd` pair makes the main command unreliable. */
function splitSegments(command: string): string[] | undefined {
	if (/[\r\n]/.test(command)) return undefined;
	// Command substitution, redirection and backgrounding make the main command unreliable.
	if (/[$<>&`]/.test(command.replace(/&&|\|\|/g, ""))) return undefined;
	const separated = /&&|\|\||[;|]/.test(command);
	if (/["']/.test(command) && separated) return undefined;
	const segments = command.split(/&&|\|\||[;|]/).map((part) => part.trim());
	return segments.every(Boolean) ? segments : undefined;
}

function isTestCommand(name: string, args: string[]): boolean {
	if (TEST_RUNNERS.has(name)) return true;
	if (name === "cargo" || name === "go" || name === "dotnet") return args[0]?.toLowerCase() === "test";
	if (name === "node") return args.some((arg) => arg === "--test");
	if (name === "python" || name === "python3") {
		const index = args.indexOf("-m");
		return index >= 0 && TEST_RUNNERS.has((args[index + 1] ?? "").toLowerCase());
	}
	if (PACKAGE_RUNNERS.has(name)) {
		const operands = args.filter((arg) => !arg.startsWith("-"));
		const first = operands[0]?.toLowerCase();
		if (!first) return false;
		if (first === "test") return true;
		if (first === "run") return (operands[1] ?? "").toLowerCase().startsWith("test");
		return TEST_RUNNERS.has(first);
	}
	if (name === "gradle" || name === "gradlew" || name === "mvn" || name === "make") return args.some((arg) => arg.toLowerCase() === "test");
	return false;
}

function mappedTitle(program: string, args: string[]): string | undefined {
	const name = program.toLowerCase();
	if (name === "cd") return "切换工作目录";
	if (name === "ls" || name === "dir") return "查看目录内容";
	if (name === "find" || name === "fd") return "查找文件";
	if (name === "rg" || name === "grep") return "搜索文件内容";
	if (name === "cat" || name === "head" || name === "tail") return "读取文件";
	if (HIGH_RISK_PROGRAMS.has(name)) return "删除文件或目录";
	if (name === "git") {
		const sub = args[0]?.toLowerCase();
		if (sub && !args[0].startsWith("-")) {
			if (sub === "status") return "查看仓库状态";
			if (sub === "diff") return "查看代码变更";
		}
		return undefined;
	}
	if (isTestCommand(name, args)) return "运行测试";
	return undefined;
}

/** `git` keeps its subcommand so risky resets stay identifiable in the collapsed row. */
function programDisplay(parsed: ParsedCommand): string {
	if (parsed.program.toLowerCase() === "git") {
		const sub = parsed.args[0] && !parsed.args[0].startsWith("-") ? parsed.args[0] : undefined;
		return sub ? `git ${sub}` : "git";
	}
	return parsed.program;
}

/** Deterministic collapsed-row title for one shell tool call; no model calls, no guessing. */
export function commandRowTitle(toolName: string, argsText: string): CommandRowTitle {
	const shell = shellLabel(toolName);
	const fallback: CommandRowTitle = { title: `执行 ${shell} 命令`, source: "fallback" };
	let command: string | undefined;
	try {
		const parsed: unknown = JSON.parse(argsText);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof (parsed as Record<string, unknown>).command === "string") command = (parsed as Record<string, unknown>).command as string;
	} catch { /* Partial JSON while streaming. */ }
	if (!command?.trim()) return fallback;
	const segments = splitSegments(command.trim());
	if (!segments) return fallback;
	if (segments.length > 2) return fallback;
	if (segments.length === 2) {
		const first = parseSegment(segments[0]);
		if (!first || first.program.toLowerCase() !== "cd") return fallback;
	}
	const parsed = parseSegment(segments[segments.length - 1]);
	if (!parsed) return fallback;
	const mapped = mappedTitle(parsed.program, parsed.args);
	if (mapped !== undefined) {
		const risk = HIGH_RISK_PROGRAMS.has(parsed.program.toLowerCase()) ? ` · ${parsed.program}` : "";
		return { title: `${mapped}${risk}`, source: "mapped" };
	}
	return { title: `执行 ${shell} · ${programDisplay(parsed)}`, source: "program" };
}

/** One collapsed title for a run of shell calls, or undefined to keep the count summary. */
export function commandRunLabel(items: { block: Tool }[]): string | undefined {
	if (!items.length || !items.every((item) => typeof item.block.argsText === "string")) return undefined;
	const titles = items.map((item) => commandRowTitle(item.block.name, item.block.argsText));
	if (titles.some((title) => title.source === "fallback")) return undefined;
	const unique = [...new Set(titles.map((title) => title.title))];
	return unique.length === 1 ? unique[0] : undefined;
}
