import { Button } from "./ui";
import { Icon } from "./Icon";
import type { WebSearchControls } from "../chat/webSearch";

/** Composer pill that toggles pi's `web_search` tool, or points at setup. */
export function WebSearchToggle({ search, disabled, onConfigure }: {
	search: WebSearchControls; disabled: boolean; onConfigure: () => void;
}) {
	if (!search.available) return null;
	const active = search.configured && search.enabled;
	const onClick = () => {
		if (!search.configured) { onConfigure(); return; }
		void search.toggle(!search.enabled);
	};

	return <Button
		type="button"
		className={`web-trigger${active ? " active" : ""}`}
		disabled={disabled || search.busy}
		aria-pressed={active}
		aria-label="联网搜索"
		title={search.configured ? (active ? "关闭联网搜索" : "开启联网搜索") : "尚未配置搜索服务，点击前往设置"}
		onClick={onClick}
	>
		<Icon name="search" size={14} />
		<span>{search.configured ? (active ? "联网 · 开" : "联网") : "联网未配置"}</span>
	</Button>;
}
