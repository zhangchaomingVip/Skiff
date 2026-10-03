import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

export function CopyButton({ text, label }: { text: string; label: string }) {
	const [status, setStatus] = useState("");
	const timer = useRef<number>();
	useEffect(() => () => window.clearTimeout(timer.current), []);
	return <button className="copy-btn" aria-label={label} title={label} onClick={async () => {
		try { await navigator.clipboard.writeText(text); setStatus("已复制"); }
		catch { setStatus("复制失败"); }
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => setStatus(""), 2000);
	}}><Icon name={status === "已复制" ? "check" : "copy"} size={14} /><span role="status">{status || "复制"}</span></button>;
}
