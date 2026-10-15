import { useEffect, useState } from "react";
import { Button, Dialog, Input, Select, TextArea } from "./ui";
import { dialogExpired, type DialogReply, type ExtensionDialog as Request } from "../chat/interactions";

export function ExtensionDialog({ request, onReply, onReconnect, onDefer }: { request: Request; onReply: (id: string, reply: DialogReply) => Promise<boolean>; onReconnect: () => void; onDefer: () => void }) {
	const [value, setValue] = useState(request.method === "select" ? request.options?.[0] ?? "" : request.prefill ?? "");
	const [pending, setPending] = useState(false);
	useEffect(() => { if (dialogExpired(request)) void onReply(request.id, { cancelled: true }); }, [request.id, request.expiresAt, onReply]);
	const send = async (reply: DialogReply) => {
		if (pending || request.sending) return;
		setPending(true);
		try { await onReply(request.id, reply); } finally { setPending(false); }
	};
	return <Dialog className="extension-dialog" aria-label={request.title} pending={pending || request.sending} onClose={() => void send({ cancelled: true })} returnFocusSelector=".composer-input">
		<h2>{request.title}</h2>
		{request.message && <p>{request.message}</p>}
		{request.method === "select" && <Select aria-label="选择选项" value={value} onChange={(event) => setValue(event.target.value)} disabled={pending || request.sending}>{request.options?.map((option, index) => <option key={index} value={option}>{option}</option>)}</Select>}
		{request.method === "input" && <Input aria-label="扩展输入" placeholder={request.placeholder} value={value} onChange={(event) => setValue(event.target.value)} disabled={pending || request.sending} />}
		{request.method === "editor" && <TextArea aria-label="扩展编辑器" rows={8} placeholder={request.placeholder} value={value} onChange={(event) => setValue(event.target.value)} disabled={pending || request.sending} />}
		{request.error && <><p role="alert">{request.error}</p><Button onClick={onReconnect}>重新连接</Button></>}
		<div className="extension-actions"><Button variant="ghost" disabled={pending || request.sending} onClick={onDefer}>稍后处理</Button><Button disabled={pending || request.sending} onClick={() => void send({ cancelled: true })}>取消</Button>{request.method === "confirm" && <Button disabled={pending || request.sending} onClick={() => void send({ confirmed: false })}>否</Button>}<Button variant="primary" disabled={pending || request.sending || (request.method === "select" && !request.options?.length)} onClick={() => void send(request.method === "confirm" ? { confirmed: true } : { value })}>{request.method === "confirm" ? "是" : "提交"}</Button></div>
	</Dialog>;
}
