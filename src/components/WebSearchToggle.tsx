import { Button } from "./ui";
import { Icon } from "./Icon";
import type { WebSearchControls } from "../chat/webSearch";

/** Composer pill that toggles pi's `web_search` tool, or points at setup. */
export function WebSearchToggle({ search, disabled, onConfigure }: {
	search: WebSearchControls; disabled: boolean; onConfigure: () => void;
}) {
	const active = search.available && search.configured && search.validated !== false && search.enabled;
	const label = !search.statusLoaded
		? "联网状态加载中"
		: !search.available
			? "联网不可用"
			: !search.configured
				? "联网未配置"
				: search.validating
					? "联网验证中"
					: search.validated === false
						? "联网验证失败"
						: active ? "联网 · 开" : "联网";
	const title = !search.statusLoaded
		? "正在读取联网搜索状态"
		: !search.available
		? search.extensionInstalled ? "扩展已安装但当前 pi 会话未加载，点击设置以重新加载" : "联网搜索扩展尚未安装，点击前往设置"
		: !search.configured
			? "尚未配置 Tavily API Key，点击前往设置"
			: search.validated === false
				? search.validationMessage ?? "Tavily API Key 验证失败，点击前往设置"
				: active ? "关闭联网搜索" : "开启联网搜索";
	const onClick = () => {
		if (!search.statusLoaded || !search.available || !search.configured || search.validated === false) { onConfigure(); return; }
		void search.toggle(!search.enabled);
	};

	return <Button
		type="button"
		className={`web-trigger${active ? " active" : ""}${!search.available || !search.configured || search.validated === false ? " unavailable" : ""}`}
		disabled={disabled || search.busy || search.validating}
		aria-pressed={active}
		aria-label="联网搜索"
		title={title}
		onClick={onClick}
	>
		<Icon name="search" size={14} />
		<span>{label}</span>
	</Button>;
}
