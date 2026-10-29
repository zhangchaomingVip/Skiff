import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { revealFile } from "../workbench/projectWorkbench";
import { Icon } from "./Icon";

type FileMenu = { x: number; y: number; path: string; trigger: HTMLElement };
const FileContext = createContext<(event: MouseEvent<HTMLElement>, path: string) => void>(() => {});
export const useFileContextMenu = () => useContext(FileContext);

export function FileContextMenuProvider({ root, scope, children }: { root?: string; scope: string; children: ReactNode }) {
	const [menu, setMenu] = useState<FileMenu>();
	const [error, setError] = useState<string>();
	const menuRef = useRef<HTMLDivElement>(null);
	const generation = useRef(0);
	useEffect(() => { generation.current++; setMenu(undefined); setError(undefined); }, [root, scope]);
	useLayoutEffect(() => {
		if (!menu || !menuRef.current) return;
		const node = menuRef.current;
		const bounds = node.getBoundingClientRect();
		node.style.left = `${Math.max(4, Math.min(menu.x, window.innerWidth - bounds.width - 4))}px`;
		node.style.top = `${Math.max(4, Math.min(menu.y, window.innerHeight - bounds.height - 4))}px`;
		node.querySelector("button")?.focus();
	}, [menu]);
	useEffect(() => {
		if (!menu) return;
		const close = () => setMenu(undefined);
		const pointer = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) close(); };
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape" || event.key === "Tab") { close(); menu.trigger.focus(); }
		};
		const scroll = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) close(); };
		window.addEventListener("pointerdown", pointer);
		window.addEventListener("keydown", key);
		window.addEventListener("resize", close);
		window.addEventListener("scroll", scroll, true);
		return () => {
			window.removeEventListener("pointerdown", pointer);
			window.removeEventListener("keydown", key);
			window.removeEventListener("resize", close);
			window.removeEventListener("scroll", scroll, true);
		};
	}, [menu]);
	const open = (event: MouseEvent<HTMLElement>, path: string) => {
		if (!root) return;
		event.preventDefault();
		event.stopPropagation();
		const bounds = event.currentTarget.getBoundingClientRect();
		const trigger = event.currentTarget.querySelector<HTMLElement>(".git-file") ?? event.currentTarget;
		setMenu({ x: event.clientX || bounds.left, y: event.clientY || bounds.bottom, path, trigger });
		setError(undefined);
	};
	const reveal = async () => {
		if (!root || !menu) return;
		const ticket = generation.current;
		setMenu(undefined);
		menu.trigger.focus();
		try { await revealFile(root, menu.path); }
		catch (reason) { if (generation.current === ticket) setError(`无法在资源管理器中显示：${String(reason)}`); }
	};
	return <FileContext.Provider value={open}>
		{error && <div className="workbench-banner error" role="alert">{error}</div>}
		{children}
		{menu && createPortal(<div ref={menuRef} className="sidebar-menu" role="menu" aria-label={menu.path} style={{ left: menu.x, top: menu.y }} onContextMenu={(event) => event.preventDefault()}>
			<button type="button" role="menuitem" onClick={() => void reveal()}><Icon name="folderOpen" size={14} />在资源管理器中显示</button>
		</div>, document.body)}
	</FileContext.Provider>;
}
