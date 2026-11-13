import { useEffect, useState, type ReactNode } from "react";
import { Dialog } from "./ui";

export function SidebarPresentation({ children, activityBar, onClose, label = "项目与聊天导航", active = true }: { children: ReactNode; activityBar?: ReactNode; onClose: () => void; label?: string; active?: boolean }) {
	const [narrow, setNarrow] = useState(() => window.innerWidth <= 760);
	useEffect(() => {
		const query = window.matchMedia("(max-width: 760px)");
		const change = () => setNarrow(query.matches);
		query.addEventListener("change", change);
		return () => query.removeEventListener("change", change);
	}, []);
	return narrow ? active ? <Dialog variant="drawer" onClose={onClose} returnFocusSelector=".titlebar-nav button[aria-label='展开侧栏']" aria-label={label}><div className="drawer-workbench">{activityBar}{children}</div></Dialog> : null : <>{children}</>;
}
