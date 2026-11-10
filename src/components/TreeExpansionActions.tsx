import { Icon } from "./Icon";
import { IconButton } from "./ui";

export function TreeExpansionActions({ disabled, expanding, onExpand, onCollapse }: { disabled?: boolean; expanding?: boolean; onExpand: () => void; onCollapse: () => void }) {
	return <>
		<IconButton size="compact" variant="ghost" aria-label="全部展开" title="全部展开" disabled={disabled} loading={expanding} onClick={onExpand}>{!expanding && <Icon name="expandAll" />}</IconButton>
		<IconButton size="compact" variant="ghost" aria-label="全部折叠" title="全部折叠" disabled={disabled} onClick={onCollapse}><Icon name="collapseAll" /></IconButton>
	</>;
}
