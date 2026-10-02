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
				raw pi stdout <span className="muted">{lines.length} lines</span>
			</div>
			<div className="raw-body">
				<pre>{lines.join("\n")}</pre>
				<div ref={endRef} />
			</div>
		</aside>
	);
}
