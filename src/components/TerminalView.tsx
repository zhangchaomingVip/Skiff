import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

/**
 * xterm.js pane that renders the raw `pi --mode rpc` stdout stream. This proves
 * the spawn + stdin/stdout pipe chain end to end. Interactive terminal features
 * (panes, link clicks, selection) are deferred — they get reimplemented in GPUI
 * later, so don't over-invest here.
 */
export function TerminalView({ lines, connected }: { lines: string[]; connected: boolean }) {
	const elRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<Terminal | null>(null);
	const cursor = useRef(0);

	useEffect(() => {
		if (!elRef.current) return;
		const term = new Terminal({
			convertEol: true,
			fontSize: 12,
			theme: { background: "#0b1120", foreground: "#e2e8f0" },
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		term.open(elRef.current);
		fit.fit();
		term.writeln("Skiff RPC terminal — raw pi --mode rpc stream");
		term.writeln(connected ? "connected" : "connecting…");
		termRef.current = term;

		const onResize = () => fit.fit();
		window.addEventListener("resize", onResize);
		return () => {
			window.removeEventListener("resize", onResize);
			term.dispose();
		};
	}, []);

	useEffect(() => {
		const term = termRef.current;
		if (!term) return;
		for (; cursor.current < lines.length; cursor.current++) {
			term.writeln(lines[cursor.current]);
		}
	}, [lines]);

	return (
		<section className="pane terminal">
			<h2>RPC stream</h2>
			<div ref={elRef} className="term" />
		</section>
	);
}
