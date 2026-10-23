import { Button } from "./ui";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

export function CopyButton({ text, label, iconOnly = false }: { text: string; label: string; iconOnly?: boolean }) {
	const [status, setStatus] = useState("");
	const timer = useRef<number>();
	useEffect(() => () => window.clearTimeout(timer.current), []);
	return <Button size="compact" variant="ghost" className="copy-btn" aria-label={label} title={iconOnly ? undefined : label} style={iconOnly ? { background: "transparent" } : undefined} onClick={async () => {
		try { await navigator.clipboard.writeText(text); setStatus("已复制"); }
		catch { setStatus("复制失败"); }
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => setStatus(""), 2000);
	}}><Icon name={status === "已复制" ? "check" : "copy"} size={14} /><span className={iconOnly ? "sr-only" : undefined} role="status">{status || "复制"}</span></Button>;
}
