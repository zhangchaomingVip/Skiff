import { useEffect, useState } from "react";
import type { Delivery, QueueSnapshot } from "../chat/interactions";
import { Icon } from "./Icon";
import { IconButton, TextArea } from "./ui";

type QueueItem = { delivery: Delivery; index: number; text: string };

export function QueuedMessages({ queue, disabled, onChange }: {
	queue: QueueSnapshot;
	disabled?: boolean;
	onChange: (delivery: Delivery, index: number, update?: { text: string; delivery: Delivery }) => Promise<boolean>;
}) {
	const items: QueueItem[] = [
		...queue.followUp.map((text, index) => ({ delivery: "follow_up" as const, index, text })),
		...queue.steering.map((text, index) => ({ delivery: "steer" as const, index, text })),
	];
	const [editing, setEditing] = useState<QueueItem>();
	const [value, setValue] = useState("");
	const [pending, setPending] = useState(false);
	useEffect(() => {
		if (editing && queue[editing.delivery === "steer" ? "steering" : "followUp"][editing.index] !== editing.text) setEditing(undefined);
	}, [editing, queue]);
	const change = async (item: QueueItem, update?: { text: string; delivery: Delivery }) => {
		setPending(true);
		try { return await onChange(item.delivery, item.index, update); }
		finally { setPending(false); }
	};
	return <div className="queued-messages" aria-label="待发送队列">
		{items.map((item) => {
			const key = `${item.delivery}:${item.index}:${item.text}`;
			const isEditing = editing?.delivery === item.delivery && editing.index === item.index && editing.text === item.text;
			return <div className="queued-message" role="group" aria-label={`排队消息 ${item.index + 1}`} key={key}>
				<span className="queued-message-icon"><Icon name="message" size={16} /></span>
				{isEditing ? <TextArea autoFocus rows={1} aria-label="编辑排队消息" value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => {
					if (event.nativeEvent.isComposing || event.keyCode === 229) return;
					if (event.key === "Escape") { event.preventDefault(); setEditing(undefined); }
					if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); const text = value.trim(); if (text) void change(item, { text, delivery: item.delivery }).then((changed) => { if (changed) setEditing(undefined); }); }
				}} /> : <span className="queued-message-text">{item.text}</span>}
				<div className="queued-message-actions">
					{isEditing ? <>
						<IconButton size="compact" variant="ghost" disabled={disabled || pending || !value.trim()} aria-label="保存排队消息" title="保存" onClick={() => { const text = value.trim(); if (text) void change(item, { text, delivery: item.delivery }).then((changed) => { if (changed) setEditing(undefined); }); }}><Icon name="check" size={15} /></IconButton>
						<IconButton size="compact" variant="ghost" disabled={pending} aria-label="取消编辑排队消息" title="取消" onClick={() => setEditing(undefined)}><Icon name="close" size={15} /></IconButton>
					</> : <>
						<IconButton size="compact" variant="ghost" disabled={disabled || pending} aria-label="编辑排队消息" title="编辑" onClick={() => { setEditing(item); setValue(item.text); }}><Icon name="edit" size={15} /></IconButton>
						<IconButton size="compact" variant="ghost" disabled={disabled || pending} aria-label="删除排队消息" title="删除" onClick={() => void change(item)}><Icon name="trash" size={15} /></IconButton>
						<IconButton size="compact" variant="ghost" disabled={disabled || pending || item.delivery === "steer"} aria-label={item.delivery === "steer" ? "排队消息已插话" : "插话发送排队消息"} title={item.delivery === "steer" ? "已插话" : "插话"} onClick={() => void change(item, { text: item.text, delivery: "steer" })}><Icon name="arrow" size={16} /></IconButton>
					</>}
				</div>
			</div>;
		})}
	</div>;
}
