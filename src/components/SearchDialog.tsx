import { Dialog, IconButton, Input, Button } from "./ui";
import { useEffect, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "./Icon";

interface Status {
	agentDir?: string;
	configured: boolean;
	keyHint?: string;
	extensionInstalled: boolean;
}

/** Lets the user add, replace or remove their own search key (Tavily today). */
export function SearchDialog({ savedKeyHint, onSaved, onClose, search }: {
	savedKeyHint?: string;
	onSaved: () => void;
	onClose: () => void;
	search: { extensionInstalled: boolean; busy: boolean; install: () => Promise<void> };
}) {
	const [status, setStatus] = useState<Status>();
	const [apiKey, setApiKey] = useState("");
	const [error, setError] = useState<string>();
	const [pending, setPending] = useState(false);

	const load = () => {
		void invoke<Status>("get_web_search_status").then(setStatus).catch((e) => setError(String(e)));
	};
	useEffect(() => {
		load();
	}, []);

	const save = async (event: FormEvent) => {
		event.preventDefault();
		if (pending) return;
		setPending(true);
		setError(undefined);
		try {
			await invoke("save_web_search_key", { apiKey });
			setApiKey("");
			onSaved();
			setStatus(await invoke<Status>("get_web_search_status"));
		} catch (e) {
			setError(String(e));
		} finally {
			setPending(false);
		}
	};
	const clear = async () => {
		setPending(true);
		setError(undefined);
		try {
			await invoke("clear_web_search_key");
			setStatus(await invoke<Status>("get_web_search_status"));
		} catch (e) {
			setError(String(e));
		} finally {
			setPending(false);
		}
	};

	const configured = status?.configured ?? false;

	return <Dialog onClose={onClose} pending={pending}  className="project-dialog provider-dialog" aria-labelledby="search-title" >
		<form onSubmit={(event) => void save(event)}>
			<div className="dialog-heading"><h2 id="search-title">联网搜索</h2><IconButton type="button"  onClick={onClose} disabled={pending} aria-label="关闭联网搜索设置"><Icon name="close" /></IconButton></div>
			<p className="muted">密钥保存在本机 pi 配置目录，不写入聊天记录，也不会回传到界面。</p>
			<div className="provider-field">
				<label htmlFor="search-key">Tavily API Key</label>
				<Input id="search-key" type="password" autoComplete="off" required placeholder={configured ? `已保存 ${savedKeyHint ?? ""}，填写新的会替换` : "tvly-…"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} disabled={pending} />
				<small>在 tavily.com 免费注册即可获得；留空不保存。</small>
			</div>
			<p className="muted">
				{status?.extensionInstalled ? "已安装 Skiff 联网搜索扩展。" : "尚未安装 Skiff 联网搜索扩展，安装后会自动重新连接。"}
				{status?.agentDir ? ` 配置目录：${status.agentDir}` : ""}
			</p>
			{error && <p className="form-error" role="alert">{error}</p>}
			<div className="dialog-actions">
				<Button type="button" variant="ghost" size="compact" onClick={() => void search.install()} disabled={pending || search.busy}>安装 / 更新扩展</Button>
				{configured && <Button type="button" variant="ghost" onClick={() => void clear()} disabled={pending}>删除已保存的 Key</Button>}
				<Button type="submit" variant="primary" size="primary" disabled={pending || !apiKey.trim()}>{pending ? "保存中…" : "保存"}</Button>
			</div>
		</form>
	</Dialog>;
}
