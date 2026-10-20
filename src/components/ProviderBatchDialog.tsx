import { useEffect, useRef, useState } from "react";
import type { BatchOperation, RelayBatchPreview } from "../chat/settingsManagement";
import { Button, Dialog } from "./ui";

export function ProviderBatchDialog({ operation, ids, initialImpact, onPreview, onCommit, pending, error, onClose }: {
	operation: BatchOperation; ids: string[]; initialImpact: Omit<RelayBatchPreview, "token">;
	onPreview: (ids: string[]) => Promise<RelayBatchPreview>;
	onCommit: (ids: string[], operation: BatchOperation, token: string) => Promise<boolean>;
	pending: boolean; error?: string; onClose: () => void;
}) {
	const [preview, setPreview] = useState<RelayBatchPreview>();
	const [previewError, setPreviewError] = useState<string>();
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const inFlight = useRef(false);
	const cancel = useRef<HTMLButtonElement>(null);
	const [revision, setRevision] = useState(0);
	useEffect(() => {
		let disposed = false; setLoading(true); setPreview(undefined); setPreviewError(undefined);
		void onPreview(ids).then((value) => { if (!disposed) setPreview(value); }).catch((cause) => { if (!disposed) setPreviewError(String(cause)); }).finally(() => { if (!disposed) setLoading(false); });
		return () => { disposed = true; };
	}, [ids, revision]);
	const impact = preview ?? initialImpact;
	const title = operation === "delete" ? "批量删除供应商" : operation === "enable" ? "批量启用供应商" : "批量停用供应商";
	const locked = busy || pending;
	return <Dialog aria-label={title} className="project-dialog" initialFocus={cancel} pending={locked} onClose={() => { if (!locked) onClose(); }}>
		<h2>{title}</h2>
		<p>所选 {ids.length} 个供应商：{impact.names.join("、")}。</p>
		{operation !== "enable" && <p>影响 {impact.routeCount} 条关联路线{operation === "delete" ? "，将一并删除路线与密钥，无法撤销" : "的可用性；路线自身开关和模型剔除配置保持原值"}。</p>}
		{loading && <p role="status">正在读取最新影响预览…</p>}
		{(previewError || error) && <p className="form-error" role="alert">{previewError || error}</p>}
		<div className="dialog-actions">
			<Button ref={cancel} disabled={locked} onClick={onClose}>取消</Button>
			{previewError && <Button disabled={locked || loading} onClick={() => setRevision((value) => value + 1)}>重新加载预览</Button>}
			<Button variant={operation === "delete" ? "danger" : "primary"} disabled={locked || loading || !preview} onClick={() => {
				if (inFlight.current || !preview) return; inFlight.current = true; setBusy(true);
				void onCommit(ids, operation, preview.token).then((success) => { if (!success) setRevision((value) => value + 1); }).finally(() => { inFlight.current = false; setBusy(false); });
			}}>{locked ? "提交中…" : "确认操作"}</Button>
		</div>
	</Dialog>;
}
