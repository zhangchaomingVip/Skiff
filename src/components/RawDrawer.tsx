import { useEffect, useRef } from "react";

/** Debug drawer showing the raw `pi --mode rpc` stdout lines. */
export function RawDrawer({ lines }: { lines: string[] }) {
	const endRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		endRef.current?.scrollIntoView({ block: "end" });
	}, [lines]);

	return (
		<aside className="raw">
			<div className="raw-head">
				诊断日志 <span className="muted">· {lines.length} 行</span>
			</div>
			<div className="raw-body">
				<pre>{lines.join("\n")}</pre>
				<div ref={endRef} />
			</div>
		</aside>
	);
}
