import { useState } from "react";
import { Dialog, IconButton, Button } from "./ui";
import { Icon } from "./Icon";

/**
 * Removing a project has two very different meanings, so both are offered in
 * one dialog: hiding keeps chats and drafts for a later re-add, permanent
 * deletion also removes the pi session files from disk.
 */
export function ProjectRemoveDialog({ name, chatCount, sessionCount, onHide, onPurge, onClose }: {
	name: string;
	chatCount: number;
	sessionCount: number;
	onHide: () => void;
	onPurge: () => void;
	onClose: () => void;
}) {
	const [confirming, setConfirming] = useState(false);
	const title = confirming ? "永久删除项目" : "移除项目";
	return <Dialog onClose={onClose} className="project-dialog" aria-label={title}>
		<div className="dialog-heading"><h2>{title}</h2><IconButton aria-label="关闭移除项目" onClick={onClose}><Icon name="close" /></IconButton></div>
		{confirming
			? <p>永久删除 {name} 及其 {chatCount} 个聊天{sessionCount ? `，并删除 pi 会话目录中的 ${sessionCount} 个对话文件` : ""}，无法恢复。</p>
			: <>
				<p>隐藏 {name}：从侧栏收起，保留 {chatCount} 个聊天与会话文件；用同一路径重新添加项目即可整组恢复。</p>
				<p>永久删除：移除项目及其聊天，并删除 pi 会话目录中的对话文件，无法恢复。</p>
			</>}
		<div className="dialog-actions">
			{/* Keys keep React from reusing a button across steps, which would
			    animate a primary blue button into the red danger one. */}
			{confirming
				? <><Button key="back" onClick={() => setConfirming(false)}>返回</Button><Button key="purge" variant="danger" aria-label="确认永久删除" onClick={() => { onPurge(); onClose(); }}>确认永久删除</Button></>
				: <><Button key="cancel" aria-label="取消移除项目" onClick={onClose}>取消</Button><Button key="hide" variant="primary" aria-label="隐藏项目" onClick={() => { onHide(); onClose(); }}>隐藏</Button><Button key="delete" variant="danger" aria-label="永久删除项目" onClick={() => setConfirming(true)}>永久删除</Button></>}
		</div>
	</Dialog>;
}
