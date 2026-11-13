import type { GenerationKind, GenerationStudio } from "../workbench/useGenerationStudio";
import { designTaskStats, type DesignCollection } from "../workbench/designWorkspace";
import { Icon, type IconName } from "./Icon";
import { Button } from "./ui";

/** Studio navigation. The design space owns its own works, so the rail lists only
 *  status groups: no project binding, and no column that mirrors Code output. */
export function DesignSidebar({ studio, kind, collection, onCollection, onCreate }: {
	studio: GenerationStudio; kind: GenerationKind; collection: DesignCollection; onCollection: (collection: DesignCollection) => void;
	onCreate: (kind: GenerationKind, reference?: boolean) => void;
}) {
	const stats = designTaskStats(studio, kind);
	const assets = studio.assets.filter((asset) => asset.kind === kind && !(asset.job?.removed ?? asset.removed));
	const groups: { id: DesignCollection; label: string; icon: IconName; count: number }[] = [
		{ id: "all", label: "全部作品", icon: "layers", count: assets.length },
		{ id: "tasks", label: "进行中", icon: "clock", count: stats.pending },
		{ id: "failures", label: "失败记录", icon: "alert", count: stats.failed },
		{ id: "removed", label: "已移除", icon: "archive", count: studio.assets.filter((asset) => asset.kind === kind && (asset.job?.removed ?? asset.removed)).length },
	];
	return <aside className="design-sidebar" aria-label="Design 导航">
		<header><span className="generation-eyebrow">DESIGN WORKSPACE</span><h1>Studio</h1><p>从灵感到成形的作品</p></header>
		<section className="design-quick-create" aria-label="快捷创作"><h2>创作</h2><Button variant="ghost" size="compact" onClick={() => onCreate("image")}><Icon name="imageSpark" />文生图</Button><Button variant="ghost" size="compact" onClick={() => onCreate("image", true)}><Icon name="image" />图生图</Button><Button variant="ghost" size="compact" onClick={() => onCreate("video")}><Icon name="video" />生成视频</Button></section>
		<nav className="design-collections" aria-label="设计资产分组"><h2>{kind === "image" ? "图片资产" : "视频资产"}</h2>{groups.filter((group) => kind === "image" || group.id !== "removed").map((group) => <button key={group.id} type="button" aria-current={collection === group.id ? "page" : undefined} onClick={() => onCollection(group.id)}><Icon name={group.icon} size={15} /><span>{group.label}</span><small>{group.count}</small></button>)}</nav>
		<div className="design-sidebar-footer"><div className="design-task-summary" aria-label="生成任务统计"><span>进行中 <strong>{stats.pending}</strong></span><span>成功 <strong>{stats.completed}</strong></span><span>失败 <strong>{stats.failed}</strong></span></div><small>这里只收 Design 生成或导入的作品；Code 项目的图片不会出现在设计室。</small></div>
	</aside>;
}
